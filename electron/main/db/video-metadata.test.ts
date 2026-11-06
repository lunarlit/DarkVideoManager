import Database from 'better-sqlite3'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSchemaVersion, runMigrations } from './migrator'
import { VideoRepository } from './repositories/VideoRepository'
import { SubtitleRepository } from './repositories/SubtitleRepository'

let db: SqliteDatabase
let videos: VideoRepository

beforeEach(() => {
  db = new Database(':memory:')
  runMigrations(db, ':memory:')
  videos = new VideoRepository(db)
  for (const [id, category, tags, rating] of [
    ['a', '야구', ' #선수명, PLAYER, 100%, tag_name ', 5],
    ['b', '야구', '선수명, player', 4],
    ['c', '야구', '선수명2, 타선수명, 100퍼센트, tagXname', 5],
    ['d', '축구', '#선수명', 5],
    ['e', '', 'PLAYER', 3],
    ['removed', '보관', '선수명, removed-only', 5],
  ] as const) {
    videos.insert({
      id,
      category,
      tags,
      rating,
      filePath: `/videos/${id}.mp4`,
      fileName: `${id} 결승.mp4`,
      memo: 'preserved',
      resumePosSec: 0,
    })
  }
  videos.markRemoved('removed', 'remove')
  new SubtitleRepository(db).insert({
    id: 'caption',
    videoId: 'a',
    filePath: '/a.srt',
    type: 'srt',
    isEmbedded: false,
  })
})

afterEach(() => db.close())

describe('video categories and exact tag filtering', () => {
  it('combines category, exact tags, text and existing filters before pagination', () => {
    const query = {
      category: '야구',
      q: '결승 #선수명',
      tag: '#player',
      sortBy: 'fileName' as const,
      sortDir: 'asc' as const,
      pageSize: 1,
    }
    expect(videos.search({ ...query, page: 1 })).toMatchObject({ total: 2, videos: [{ id: 'a' }] })
    expect(videos.search({ ...query, page: 2 })).toMatchObject({ total: 2, videos: [{ id: 'b' }] })
    expect(videos.search({ ...query, page: 3 })).toMatchObject({ total: 2, videos: [] })
    expect(videos.search({ ...query, rating: 5 })).toMatchObject({
      total: 1,
      videos: [{ id: 'a' }],
    })
    expect(videos.search({ ...query, hasSubtitles: false })).toMatchObject({
      total: 1,
      videos: [{ id: 'b' }],
    })
    expect(videos.search({ ...query, hasSubtitles: true })).toMatchObject({
      total: 1,
      videos: [{ id: 'a', hasSubtitles: true }],
    })
  })

  it('treats wildcard characters literally only for exact tags', () => {
    expect(videos.search({ tag: '100%' })).toMatchObject({ total: 1, videos: [{ id: 'a' }] })
    expect(videos.search({ q: '#tag_name' })).toMatchObject({ total: 1, videos: [{ id: 'a' }] })
    expect(videos.search({ tag: 'tag%' }).total).toBe(0)
    expect(videos.search({ q: 'tag_name' }).total).toBe(2)
    expect(videos.search({ tag: '선수' }).total).toBe(0)
    expect(videos.search({ q: '#선수명 #PLAYER' }).total).toBe(2)
  })

  it('distinguishes all categories, uncategorized videos and removed scope', () => {
    expect(videos.search({}).total).toBe(5)
    expect(videos.search({ category: '' })).toMatchObject({ total: 1, videos: [{ id: 'e' }] })
    expect(videos.search({ category: '야' }).total).toBe(0)
    expect(videos.search({ removed: true, tag: '선수명', category: '보관' })).toMatchObject({
      total: 1,
      videos: [{ id: 'removed' }],
    })
    expect(videos.metadataOptions(true)).toEqual({
      categories: ['보관'],
      tags: ['선수명', 'removed-only'],
      performers: [],
    })
    expect(videos.metadataOptions().categories).toEqual(['야구', '축구'])
    expect(videos.metadataOptions().tags).not.toContain('removed-only')
  })

  it('returns options beyond the first search page and updates them after metadata edits', () => {
    db.transaction(() => {
      for (let index = 0; index < 501; index++) {
        videos.insert({
          id: `extra-${index}`,
          filePath: `/extra/${index}.mp4`,
          fileName: `${index}.mp4`,
          category: index === 500 ? '마지막 분류' : '',
          tags: index === 500 ? '#마지막태그' : '',
          rating: 0,
          memo: '',
          resumePosSec: 0,
        })
      }
    })()
    expect(videos.search({ pageSize: 1 }).videos).toHaveLength(1)
    expect(videos.metadataOptions().categories).toContain('마지막 분류')
    expect(videos.metadataOptions().tags).toContain('마지막태그')
    videos.updateMeta('extra-500', {
      category: ' 새 분류 ',
      tags: '#New, new, #새태그',
      memo: 'edited',
    })
    expect(videos.findById('extra-500')).toMatchObject({
      category: '새 분류',
      tags: 'New, 새태그',
      memo: 'edited',
    })
    expect(videos.metadataOptions().categories).not.toContain('마지막 분류')
    expect(videos.metadataOptions().tags).not.toContain('마지막태그')
    expect(videos.search({ category: '새 분류', tag: 'new' })).toMatchObject({
      total: 1,
      videos: [{ id: 'extra-500' }],
    })
    videos.updateMeta('extra-500', { category: '', tags: '' })
    expect(videos.metadataOptions().categories).not.toContain('새 분류')
    expect(videos.findById('extra-500')?.memo).toBe('edited')
  })

  it('adds an uncategorized default without rewriting existing version-five metadata', () => {
    const legacy = new Database(':memory:')
    try {
      legacy.exec(`
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
        INSERT INTO schema_version VALUES (1), (2), (3), (4), (5);
        CREATE TABLE videos (id TEXT PRIMARY KEY, tags TEXT, memo TEXT, rating INTEGER,
          created_at TEXT, removal_mode TEXT);
        INSERT INTO videos VALUES ('old', ' #PLAYER, player, 선수명 ', 'keep memo', 5, '2026-01-01', NULL);
      `)
      runMigrations(legacy, ':memory:')
      expect(getSchemaVersion(legacy)).toBe(7)
      expect(legacy.prepare('SELECT id, tags, memo, rating, category FROM videos').get()).toEqual({
        id: 'old',
        tags: ' #PLAYER, player, 선수명 ',
        memo: 'keep memo',
        rating: 5,
        category: '',
      })
      runMigrations(legacy, ':memory:')
      expect(getSchemaVersion(legacy)).toBe(7)
    } finally {
      legacy.close()
    }
  })
})

describe('rating filter and random pick', () => {
  beforeEach(() => {
    for (const [id, rating] of [
      ['r0', 0],
      ['r3', 3],
      ['r45', 4.5],
      ['r5', 5],
    ] as const)
      videos.insert({
        id,
        filePath: `/r/${id}.mp4`,
        fileName: id,
        rating,
        memo: '',
        resumePosSec: 0,
        category: 'r',
      })
  })
  const ids = (ratingOp: 'gte' | 'lte' | 'eq', rating: number) =>
    videos
      .search({ category: 'r', rating, ratingOp, pageSize: 100 })
      .videos.map((video) => video.id)
      .sort()

  it('compares ratings at least, at most and exactly, including half stars', () => {
    expect(ids('gte', 4.5)).toEqual(['r45', 'r5'])
    expect(ids('lte', 3)).toEqual(['r0', 'r3'])
    expect(ids('eq', 4.5)).toEqual(['r45'])
    expect(ids('eq', 0)).toEqual(['r0'])
    expect(videos.search({ category: 'r', rating: 4, pageSize: 100 }).total).toBe(2)
  })

  it('picks a random id only among the filtered matches', () => {
    for (let i = 0; i < 20; i++)
      expect(['r45', 'r5']).toContain(
        videos.randomId({ category: 'r', rating: 4.5, ratingOp: 'gte' }),
      )
    expect(
      videos.randomId({ category: 'r', rating: 5, ratingOp: 'eq', q: 'nothing-matches' }),
    ).toBeNull()
  })
})

describe('performer removal', () => {
  it('removes one performer from every video that has it and keeps the others', () => {
    videos.insert({
      id: 'p1',
      filePath: '/p/1.mp4',
      fileName: 'p1',
      rating: 0,
      memo: '',
      resumePosSec: 0,
      performers: '색기 고딩, 나기사 아이리',
    })
    videos.insert({
      id: 'p2',
      filePath: '/p/2.mp4',
      fileName: 'p2',
      rating: 0,
      memo: '',
      resumePosSec: 0,
      performers: '색기 고딩',
    })
    videos.insert({
      id: 'p3',
      filePath: '/p/3.mp4',
      fileName: 'p3',
      rating: 0,
      memo: '',
      resumePosSec: 0,
      performers: '미야시타 레나',
    })
    expect(videos.removePerformer(' 색기  고딩 ')).toBe(2)
    expect(videos.findById('p1')?.performers).toBe('나기사 아이리')
    expect(videos.findById('p2')?.performers).toBe('')
    expect(videos.findById('p3')?.performers).toBe('미야시타 레나')
    expect(videos.performerCounts().map((entry) => entry.name)).not.toContain('색기 고딩')
  })
})

describe('folder filtering', () => {
  it('matches videos inside a folder at any depth, case-insensitively, but not sibling prefixes', () => {
    for (const [id, filePath] of [
      ['f1', 'D:\\Media\\HoF\\a.mp4'],
      ['f2', 'D:\\Media\\HoF\\Sub\\b.mp4'],
      ['f3', 'D:\\Media\\HoF2\\c.mp4'],
      ['f4', 'D:\\Media\\other\\d.mp4'],
    ] as const) {
      videos.insert({ id, filePath, fileName: id, rating: 0, memo: '', resumePosSec: 0 })
    }
    const ids = (folder: string) =>
      videos
        .search({ folder, pageSize: 100 })
        .videos.map((video) => video.id)
        .sort()
    expect(ids('D:\\Media\\HoF')).toEqual(['f1', 'f2'])
    expect(ids('d:\\media\\hof\\')).toEqual(['f1', 'f2'])
    expect(ids('D:\\Media\\HoF\\Sub')).toEqual(['f2'])
  })

  it('sets the category of every non-removed video inside a folder only', () => {
    for (const [id, filePath] of [
      ['g1', 'D:\\Media\\HoF\\a.mp4'],
      ['g2', 'D:\\Media\\HoF\\Sub\\b.mp4'],
      ['g3', 'D:\\Media\\HoF2\\c.mp4'],
      ['g4', 'D:\\Media\\HoF\\gone.mp4'],
    ] as const) {
      videos.insert({ id, filePath, fileName: id, rating: 0, memo: '', resumePosSec: 0 })
    }
    videos.markRemoved('g4', 'remove')
    expect(videos.setCategoryForFolder('d:\\media\\hof', ' 명예의 전당 ')).toBe(2)
    expect(videos.findById('g1')?.category).toBe('명예의 전당')
    expect(videos.findById('g2')?.category).toBe('명예의 전당')
    expect(videos.findById('g3')?.category).toBe('')
    expect(videos.findById('g4')?.category).toBe('')
  })
})
