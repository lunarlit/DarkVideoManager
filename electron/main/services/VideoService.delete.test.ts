import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../db/migrator'
import { VideoRepository } from '../db/repositories/VideoRepository'
import { HighlightRepository } from '../db/repositories/HighlightRepository'
import { ThumbnailRepository } from '../db/repositories/ThumbnailRepository'
import { SubtitleRepository } from '../db/repositories/SubtitleRepository'
import { PlayHistoryRepository } from '../db/repositories/PlayHistoryRepository'

const state = vi.hoisted(() => ({
  db: null as SqliteDatabase | null,
  thumbs: '',
  trashItem: vi.fn(),
}))
vi.mock('electron', () => ({ shell: { trashItem: state.trashItem } }))
vi.mock('../db/connection', () => ({
  getDatabase: () => state.db,
  isDatabaseReadOnly: () => false,
}))
vi.mock('../infra/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}))
vi.mock('../infra/paths', () => ({
  getPlaybackProxyDir: vi.fn(),
  getThumbnailsDir: () => state.thumbs,
}))
vi.mock('./CacheService', () => ({
  purgeVideoPlaybackCache: vi.fn(async () => undefined),
  beginPlaybackCacheLease: vi.fn(),
  trimPlaybackCache: vi.fn(),
}))
vi.mock('../ffmpeg/playback.js', () => ({
  needsPlaybackProxy: vi.fn(),
  ensurePlaybackProxy: vi.fn(),
}))
vi.mock('./NativePlayerService', () => ({
  findNativePlayer: vi.fn(),
  openInNativePlayer: vi.fn(),
}))
vi.mock('./MpvSessionService.js', () => ({ openInMpv: vi.fn(), seekMpvSession: vi.fn() }))
vi.mock('./PlaybackService', () => ({ endPlayback: vi.fn() }))

import { deleteVideo } from './VideoService'
import { acquireSourceFile } from './SourceFileUsage'

let directory: string
let filePath: string
let subtitlePath: string
let thumbnailPath: string
let videos: VideoRepository

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dvm-perm-delete-'))
  state.thumbs = join(directory, 'thumbs')
  mkdirSync(state.thumbs)
  filePath = join(directory, 'movie.mp4')
  subtitlePath = join(directory, 'movie.ko.srt')
  thumbnailPath = join(state.thumbs, 'video_0.jpg')
  writeFileSync(filePath, 'disposable test media')
  writeFileSync(subtitlePath, '1\n00:00:01,000 --> 00:00:02,000\nhi\n')
  writeFileSync(thumbnailPath, 'image')
  state.db = new Database(':memory:')
  runMigrations(state.db, ':memory:')
  videos = new VideoRepository(state.db)
  videos.insert({
    id: 'video',
    filePath,
    fileName: 'movie.mp4',
    rating: 5,
    memo: 'memo',
    tags: 'tag',
    performers: '배우',
    resumePosSec: 0,
  })
  new HighlightRepository(state.db).insert({
    id: 'highlight',
    videoId: 'video',
    timeStart: 3,
    color: 'yellow',
    createdAt: new Date().toISOString(),
  })
  new ThumbnailRepository(state.db).insert({
    id: 'thumbnail',
    videoId: 'video',
    filePath: thumbnailPath,
    timeSec: 3,
    isPrimary: true,
  })
  new SubtitleRepository(state.db).insert({
    id: 'subtitle',
    videoId: 'video',
    filePath: subtitlePath,
    type: 'srt',
    isEmbedded: false,
  })
  new PlayHistoryRepository(state.db).insert({
    id: 'history',
    videoId: 'video',
    startedAt: new Date().toISOString(),
    posStartSec: 0,
  })
})

afterEach(() => {
  state.db?.close()
  state.db = null
  const target = resolve(directory)
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes('dvm-perm-delete-'))
    throw new Error('Unsafe cleanup path')
  rmSync(target, { recursive: true, force: true })
})

function rowCount(table: string): number {
  return (state.db!.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
}

describe('permanent video deletion', () => {
  it('deletes the file, its sidecar subtitles and thumbnails, and every record', async () => {
    await deleteVideo('lib', 'video', 'delete')
    expect(existsSync(filePath)).toBe(false)
    expect(existsSync(subtitlePath)).toBe(false)
    expect(existsSync(thumbnailPath)).toBe(false)
    expect(state.trashItem).not.toHaveBeenCalled()
    expect(videos.findById('video')).toBeNull()
    for (const table of ['thumbnails', 'subtitles', 'highlights', 'play_history'])
      expect(rowCount(table)).toBe(0)
  })

  it('still removes the records when the source file is already gone', async () => {
    rmSync(filePath)
    await deleteVideo('lib', 'video', 'delete')
    expect(videos.findById('video')).toBeNull()
  })

  it('refuses while the video is playing and changes nothing', async () => {
    const release = acquireSourceFile(filePath)
    try {
      await expect(deleteVideo('lib', 'video', 'delete')).rejects.toThrow('재생 중')
    } finally {
      release()
    }
    expect(existsSync(filePath)).toBe(true)
    expect(videos.findById('video')).not.toBeNull()
    expect(rowCount('highlights')).toBe(1)
  })
})
