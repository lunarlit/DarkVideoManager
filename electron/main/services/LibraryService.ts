import { randomUUID } from 'crypto'
import { basename, dirname, extname, join, resolve, relative, isAbsolute } from 'path'
import { stat, lstat, readdir, writeFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import type { Database } from 'better-sqlite3'
import { BrowserWindow, shell } from 'electron'
import {
  FolderTree,
  Library,
  ImportProgress,
  ImportResult,
  ProbeData,
  VideoMeta,
} from '@shared/types'
import { loadConfig, saveConfig, updateConfig } from '../infra/config'
import { getLibDbPath, getThumbnailsDir } from '../infra/paths'
import { openDatabase, closeDatabase, getDatabase } from '../db/connection'
import { runMigrations } from '../db/migrator'
import { VideoRepository } from '../db/repositories/VideoRepository'
import { ThumbnailRepository } from '../db/repositories/ThumbnailRepository'
import { finishPlaybackSessions } from './PlaybackService'
import { closeManagedNativePlayers } from './NativePlayerService'
import { closeAllMpvSessions } from './MpvSessionService.js'
import { FsScanner } from './FsScanner'
import {
  matchSidecarSubtitle,
  subtitleExtensions,
  subtitleVideoKey,
  syncSidecarSubtitleSnapshot,
  type SidecarSubtitle,
} from './SubtitleService'
import {
  withLibraryWork,
  isLibraryBusy,
  throwIfWorkCancelled,
  yieldLibraryWork,
} from './LibraryWorkService'
import { probeVideo } from '../ffmpeg/ffprobe'
import { isAbortError } from '../ffmpeg/queue'
import { clearThumbnailJobHistory } from './ThumbnailJobService'
import { IPC } from '@shared/ipc'
import { createLogger } from '../infra/logger'
import { isVideoFile } from '../infra/fs'
import { serializeVideoTags, serializeVideoPerformers } from '@shared/videoMetadata'
import {
  ratingFromPath,
  hashtagsFromName,
  matchKnownTags,
  stashSceneForFile,
  koreanPerformersFromName,
  normalizePerformerKey,
  userBlockedPerformers,
  leadingKoreanNames,
  isStashEnabled,
  type StashScene,
} from './AutoTagService'
import { getStashMetadataService } from './StashMetadataService'

const log = createLogger('LibraryService')

export function listLibraries(): Library[] {
  return loadConfig().libraries
}

export function openLibrary(libraryId: string): Library {
  const config = loadConfig()
  const lib = config.libraries.find((l) => l.id === libraryId)
  if (!lib) throw new Error(`라이브러리를 찾을 수 없습니다: ${libraryId}`)

  const alreadyOpen = Boolean(getDatabase(libraryId))
  try {
    const db = openDatabase(libraryId, lib.dbPath)
    runMigrations(db, lib.dbPath)
    if (config.lastActiveLibraryId !== libraryId) stopPreviousLibraryPlayback()
    updateConfig((c) => ({
      ...c,
      libraries: c.libraries.map((l) =>
        l.id === libraryId ? { ...l, lastOpenedAt: new Date().toISOString() } : l,
      ),
      lastActiveLibraryId: libraryId,
    }))
  } catch (error) {
    if (!alreadyOpen) closeDatabase(libraryId)
    throw error
  }

  return lib
}

export function createLibrary(name: string, folders: string | string[]): Library {
  const requested = typeof folders === 'string' ? [folders] : folders
  if (!requested.length || requested.length > 100 || requested.some((folder) => !folder.trim()))
    throw new Error('라이브러리에 등록할 폴더를 1~100개 선택해 주세요.')
  // Validate every root before touching the registry or creating a database.
  for (const folder of requested)
    if (!statSync(folder).isDirectory()) throw new Error('폴더 또는 드라이브를 선택해 주세요.')
  const folderPaths = uniqueRoots(requested)
  const folderPath = folderPaths[0]
  // Establish a recoverable registry before creating the first database.
  saveConfig(loadConfig())
  const id = randomUUID()
  const dbPath = getLibDbPath(id)

  const lib: Library = {
    id,
    name,
    dbPath,
    folderPath,
    folderPaths,
    createdAt: new Date().toISOString(),
  }

  try {
    const db = openDatabase(id, dbPath)
    runMigrations(db, dbPath)
    stopPreviousLibraryPlayback()
    updateConfig((c) => ({
      ...c,
      libraries: [...c.libraries, lib],
      lastActiveLibraryId: id,
    }))
  } catch (error) {
    closeDatabase(id)
    throw error
  }

  log.info({ id, name, folderPath }, '라이브러리 생성')
  return lib
}

/**
 * Create a library with no registered folders yet. Used by the single-library
 * bootstrap so the app can start with an empty library the user fills by
 * importing folders. Unlike createLibrary, this does not require a folder up front.
 */
export function createEmptyLibrary(name: string): Library {
  saveConfig(loadConfig())
  const id = randomUUID()
  const dbPath = getLibDbPath(id)
  const lib: Library = {
    id,
    name,
    dbPath,
    folderPath: '',
    folderPaths: [],
    createdAt: new Date().toISOString(),
  }
  try {
    const db = openDatabase(id, dbPath)
    runMigrations(db, dbPath)
    updateConfig((c) => ({
      ...c,
      libraries: [...c.libraries, lib],
      lastActiveLibraryId: id,
    }))
  } catch (error) {
    closeDatabase(id)
    throw error
  }
  log.info({ id, name }, '기본 라이브러리 생성')
  return lib
}

/**
 * Guarantee exactly one usable library exists. The app runs as a single library:
 * if the user already has libraries, the most recently active one is kept as the
 * single library; otherwise an empty default library is created. Returns it.
 */
export function ensureSingleLibrary(): Library {
  const config = loadConfig()
  if (config.libraries.length > 0)
    return (
      config.libraries.find((entry) => entry.id === config.lastActiveLibraryId) ??
      config.libraries[0]
    )
  return createEmptyLibrary('내 라이브러리')
}

function stopPreviousLibraryPlayback(): void {
  // Stop managed processes first: failure must leave mpv's tracking and the
  // selected library intact so the user can recover from the visible error.
  closeManagedNativePlayers()
  closeAllMpvSessions()
  finishPlaybackSessions()
}

export function closeLibrary(libraryId: string): void {
  assertLibraryIdle(libraryId)
  finishPlaybackSessions(libraryId)
  closeDatabase(libraryId)
  clearThumbnailJobHistory(libraryId)
}

export function deleteLibrary(libraryId: string): void {
  assertLibraryIdle(libraryId)
  finishPlaybackSessions(libraryId)
  closeDatabase(libraryId)
  clearThumbnailJobHistory(libraryId)
  updateConfig((c) => ({
    ...c,
    libraries: c.libraries.filter((l) => l.id !== libraryId),
    lastActiveLibraryId: c.lastActiveLibraryId === libraryId ? undefined : c.lastActiveLibraryId,
  }))
}

function assertLibraryIdle(libraryId: string): void {
  if (isLibraryBusy(libraryId))
    throw new Error('라이브러리 작업이 진행 중입니다. 작업을 취소하고 완료될 때까지 기다려 주세요.')
}

type Sidecars = Map<string, SidecarSubtitle[]>
type ProgressEmitter = (progress: Omit<ImportProgress, 'libraryId'>) => void

function pathKey(filePath: string): string {
  const normalized = resolve(filePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
function insideFolder(filePath: string, folderPath: string): boolean {
  const child = relative(resolve(folderPath), resolve(filePath))
  return (
    child !== '..' && !child.startsWith('..\\') && !child.startsWith('../') && !isAbsolute(child)
  )
}
function uniqueRoots(roots: string[]): string[] {
  const unique = [...new Map(roots.map((root) => [pathKey(root), resolve(root)])).values()]
  return unique.filter(
    (root, index) =>
      !unique.some((other, otherIndex) => otherIndex !== index && insideFolder(root, other)),
  )
}
function createEmitter(libraryId: string, win: BrowserWindow): ProgressEmitter {
  let lastSentAt = 0
  let lastPhase: ImportProgress['phase'] | undefined
  let lastFile: string | undefined
  return (progress) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    const now = Date.now()
    if (
      progress.phase === lastPhase &&
      progress.currentFile === lastFile &&
      progress.current !== progress.total &&
      now - lastSentAt < 100
    )
      return
    lastPhase = progress.phase
    lastFile = progress.currentFile
    lastSentAt = now
    win.webContents.send(IPC.EVENTS.IMPORT_PROGRESS, {
      ...progress,
      errors: [...progress.errors],
      libraryId,
    })
  }
}
function createYieldBudget(signal: AbortSignal): () => Promise<void> | undefined {
  let count = 0,
    lastYield = Date.now()
  return () => {
    throwIfWorkCancelled(signal)
    if (++count < 64 && Date.now() - lastYield < 8) return undefined
    count = 0
    lastYield = Date.now()
    return yieldLibraryWork(signal)
  }
}

async function scanFolders(
  roots: string[],
  signal: AbortSignal,
  emit: ProgressEmitter,
): Promise<{ files: string[]; sidecars: Sidecars }> {
  const scanner = new FsScanner()
  const files = new Map<string, string>()
  const sidecars: Sidecars = new Map()
  const subtitleFiles = new Map<string, string>()
  let previousFiles = 0
  for (const root of roots) {
    let rootFileCount = 0
    const scanned = await scanner.scan(root, {
      signal,
      onFile: (filePath) => {
        const extension = extname(filePath).toLowerCase()
        if (!subtitleExtensions.has(extension)) return
        subtitleFiles.set(pathKey(filePath), filePath)
      },
      onProgress: (progress) => {
        rootFileCount = progress.files
        emit({
          phase: 'scanning',
          total: 0,
          current: previousFiles + progress.files,
          currentFile: progress.currentPath,
          errors: [],
        })
      },
    })
    for (const file of scanned) files.set(pathKey(file), file)
    previousFiles += rootFileCount
  }
  throwIfWorkCancelled(signal)
  // Match after scanning so exact video stems always win, regardless of traversal order.
  const videoKeys = new Set([...files.values()].map(subtitleVideoKey))
  for (const filePath of subtitleFiles.values()) {
    const match = matchSidecarSubtitle(filePath, videoKeys)
    if (!match) continue
    const related = sidecars.get(match.videoKey) ?? []
    related.push(match.subtitle)
    sidecars.set(match.videoKey, related)
  }
  return { files: [...files.values()], sidecars }
}

async function importScannedFiles(
  libraryId: string,
  db: Database,
  files: string[],
  sidecars: Sidecars,
  signal: AbortSignal,
  result: ImportResult,
  emit: ProgressEmitter,
): Promise<void> {
  const repository = new VideoRepository(db)
  const thumbnails = new ThumbnailRepository(db)
  const cooperate = createYieldBudget(signal)
  // Snapshot the existing tag vocabulary once so filename words can be matched
  // against tags that already exist in the library.
  const knownTags = repository.metadataOptions(false).tags
  const stashEnabled = isStashEnabled()
  const stashCache = new Map<string, StashScene | null>()
  // Tags come from the file name only (hashtags + already-known tags).
  const deriveTags = (fileName: string): string[] => [
    ...hashtagsFromName(fileName),
    ...matchKnownTags(fileName, knownTags),
  ]
  const lookupScene = (fileName: string): Promise<StashScene | null> =>
    stashEnabled ? stashSceneForFile(fileName, stashCache) : Promise.resolve(null)
  // Build a dictionary of real performer names so we can still tag films that Stash
  // did not match (R18 rate-limits bulk identify, leaving many major-label scenes
  // without performers even though the name is in the file name). A name is trusted
  // when Stash confirmed it on some scene, or when it leads ≥2 file names (an
  // actress recurs across releases; a one-off description phrase does not).
  const knownPerformers = new Set<string>()
  if (stashEnabled) {
    try {
      for (const entry of await getStashMetadataService().listPerformerSceneFiles())
        for (const name of koreanPerformersFromName(entry.basename, entry.count))
          knownPerformers.add(name.toLowerCase())
    } catch (error) {
      log.warn({ err: error }, '배우 사전 구성 실패')
    }
  }
  const leadingFrequency = new Map<string, number>()
  for (const filePath of files)
    for (const name of leadingKoreanNames(basename(filePath))) {
      const key = name.toLowerCase()
      leadingFrequency.set(key, (leadingFrequency.get(key) ?? 0) + 1)
    }
  const isLikelyPerformer = (name: string): boolean => {
    const key = name.toLowerCase()
    return knownPerformers.has(key) || (leadingFrequency.get(key) ?? 0) >= 2
  }
  // Performers are a separate field. When Stash matched the scene, its performer
  // count decides how many leading names to take; otherwise fall back to leading
  // file-name names that the dictionary confirms are real performers.
  const blockedPerformers = userBlockedPerformers()
  const notBlocked = (name: string) => !blockedPerformers.has(normalizePerformerKey(name))
  const derivePerformers = (fileName: string, scene: StashScene | null): string[] => {
    if (scene && scene.people.length > 0) {
      const names = koreanPerformersFromName(fileName, scene.people.length).filter(notBlocked)
      for (const name of names) knownPerformers.add(name.toLowerCase())
      return names
    }
    return leadingKoreanNames(fileName).filter(isLikelyPerformer).filter(notBlocked)
  }
  for (const [index, filePath] of files.entries()) {
    await cooperate()
    emit({
      phase: 'probing',
      total: files.length,
      current: index + 1,
      currentFile: basename(filePath),
      errors: result.errors,
    })
    try {
      throwIfWorkCancelled(signal)
      const existing = repository.findByPath(filePath)
      if (existing) {
        // A refresh must not restore a deliberately removed video or mutate its subtitles.
        if (!existing.removalMode) {
          db.transaction(() =>
            syncSidecarSubtitleSnapshot(
              db,
              existing.id,
              sidecars.get(subtitleVideoKey(filePath)) ?? [],
            ),
          )()
          // Re-scan: merge newly derived tags and performers into the existing ones.
          // Ratings and other manual edits are left untouched.
          const fileName = basename(filePath)
          const patch: VideoMeta = {}
          const derivedTags = deriveTags(fileName)
          if (derivedTags.length) {
            const mergedTags = serializeVideoTags([existing.tags, ...derivedTags].join(', '))
            if (mergedTags !== serializeVideoTags(existing.tags)) patch.tags = mergedTags
          }
          const scene = await lookupScene(fileName)
          const derivedPerformers = derivePerformers(fileName, scene)
          if (derivedPerformers.length) {
            const mergedPerformers = serializeVideoPerformers(
              [existing.performers, ...derivedPerformers].join(', '),
            )
            if (mergedPerformers !== serializeVideoPerformers(existing.performers))
              patch.performers = mergedPerformers
          }
          if (patch.tags !== undefined || patch.performers !== undefined)
            repository.updateMeta(existing.id, patch)
          // Fill in media info that an earlier import could not read (e.g. ffprobe
          // was unavailable at the time).
          if (!existing.durationSec) {
            try {
              const probeData = await probeVideo(filePath, signal)
              if (Object.keys(probeData).length) repository.updateProbeData(existing.id, probeData)
            } catch (error) {
              if (isAbortError(error) || signal.aborted) throw error
              log.warn({ filePath, err: error }, 'ffprobe 재시도 실패')
            }
          }
        }
        result.skipped++
        continue
      }
      const info = await stat(filePath)
      throwIfWorkCancelled(signal)
      let probeData: ProbeData = {}
      try {
        probeData = await probeVideo(filePath, signal)
      } catch (error) {
        if (isAbortError(error) || signal.aborted) throw error
        log.warn({ filePath, err: error }, 'ffprobe 실패, 메타 없이 저장')
      }
      throwIfWorkCancelled(signal)
      const fileName = basename(filePath)
      const scene = await lookupScene(fileName)
      const tags = serializeVideoTags(deriveTags(fileName).join(', '))
      const performers = serializeVideoPerformers(derivePerformers(fileName, scene).join(', '))
      const rating = ratingFromPath(filePath) ?? 0
      const videoId = randomUUID()
      // Fetch the Stash cover ("표지") before the write so the file is on disk first.
      let coverPath: string | null = null
      if (scene) {
        const cover = await getStashMetadataService().fetchSceneCover(scene.id)
        if (cover) {
          const target = join(getThumbnailsDir(libraryId), `${videoId}_stash_cover.jpg`)
          try {
            await writeFile(target, cover)
            coverPath = target
          } catch (error) {
            log.warn({ videoId, err: error }, 'Stash 표지 저장 실패')
          }
        }
      }
      throwIfWorkCancelled(signal)
      db.transaction(() => {
        repository.insert({
          id: videoId,
          filePath,
          fileName,
          sizeBytes: info.size,
          rating,
          memo: '',
          resumePosSec: 0,
          tags,
          performers,
          ...probeData,
        })
        if (coverPath)
          thumbnails.insert({
            id: randomUUID(),
            videoId,
            filePath: coverPath,
            timeSec: 0,
            isPrimary: true,
          })
        syncSidecarSubtitleSnapshot(db, videoId, sidecars.get(subtitleVideoKey(filePath)) ?? [])
      })()
      result.added++
    } catch (error) {
      if (isAbortError(error) || signal.aborted) throw error
      result.errors.push(basename(filePath) + ': ' + (error as Error).message)
      log.warn({ filePath, err: error }, '가져오기 오류')
    }
  }
}

async function markMissingVideos(
  db: Database,
  roots: string[],
  scannedFiles: string[],
  signal: AbortSignal,
  result: ImportResult,
): Promise<void> {
  if (result.errors.length) return
  const scanned = new Set(scannedFiles.map(pathKey))
  const videos = db
    .prepare('SELECT id, file_path FROM videos WHERE removal_mode IS NULL')
    .all() as Array<{ id: string; file_path: string }>
  const missing: string[] = []
  const cooperate = createYieldBudget(signal)
  for (const video of videos) {
    await cooperate()
    if (
      scanned.has(pathKey(video.file_path)) ||
      !roots.some((root) => insideFolder(video.file_path, root))
    )
      continue
    try {
      await lstat(video.file_path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing.push(video.id)
      else result.errors.push((error as Error).message)
    }
  }
  // Recheck the roots immediately before committing absence information. A disk
  // disconnected during a long thumbnail job must not hide all of its entries.
  for (const root of roots) {
    await stat(root)
    throwIfWorkCancelled(signal)
  }
  if (result.errors.length) return
  throwIfWorkCancelled(signal)
  const repository = new VideoRepository(db)
  db.transaction(() => {
    for (const id of missing) repository.delete(id)
    result.removed = missing.length
  })()
}

async function runFolderWork(
  libraryId: string,
  requestedFolders: string[] | undefined,
  win: BrowserWindow,
  signal: AbortSignal,
): Promise<ImportResult> {
  const db = getDatabase(libraryId)
  if (!db) throw new Error('라이브러리가 열려 있지 않습니다')
  const library = loadConfig().libraries.find((entry) => entry.id === libraryId)
  if (!library) throw new Error('라이브러리를 찾을 수 없습니다')
  const roots = uniqueRoots(
    (requestedFolders ?? [library.folderPath, ...(library.folderPaths ?? [])]).filter((folder) =>
      Boolean(folder && folder.trim()),
    ),
  )
  const emit = createEmitter(libraryId, win)
  const result: ImportResult = { added: 0, skipped: 0, removed: 0, errors: [] }
  let files: string[] = []
  emit({ phase: 'scanning', total: 0, current: 0, errors: [] })
  try {
    // Selection is one operation: an inaccessible root must not register or import
    // earlier roots. Scanning all roots also completes before any database write.
    for (const folder of requestedFolders ?? roots) {
      if (!(await stat(folder)).isDirectory())
        throw new Error('폴더 또는 드라이브를 선택해 주세요.')
      throwIfWorkCancelled(signal)
    }
    const snapshot = await scanFolders(roots, signal, emit)
    files = snapshot.files
    throwIfWorkCancelled(signal)
    if (requestedFolders)
      updateConfig((config) => ({
        ...config,
        libraries: config.libraries.map((entry) => {
          if (entry.id !== libraryId) return entry
          const folderPaths = uniqueRoots(
            [entry.folderPath, ...(entry.folderPaths ?? []), ...requestedFolders].filter((folder) =>
              Boolean(folder && folder.trim()),
            ),
          )
          return {
            ...entry,
            // A library bootstrapped without folders adopts the first imported root.
            folderPath: entry.folderPath?.trim() ? entry.folderPath : (folderPaths[0] ?? ''),
            folderPaths,
          }
        }),
      }))
    await importScannedFiles(libraryId, db, files, snapshot.sidecars, signal, result, emit)
    throwIfWorkCancelled(signal)
    if (!requestedFolders) await markMissingVideos(db, roots, files, signal, result)
    emit({ phase: 'done', total: files.length, current: files.length, errors: result.errors })
    return result
  } catch (error) {
    if (isAbortError(error) || signal.aborted) {
      result.cancelled = true
      emit({
        phase: 'cancelled',
        total: files.length,
        current: result.added + result.skipped,
        errors: result.errors,
      })
      return result
    }
    if (requestedFolders) throw error
    result.errors.push('폴더에 접근할 수 없어 새로고침을 중단했습니다: ' + (error as Error).message)
    emit({
      phase: 'done',
      total: files.length,
      current: result.added + result.skipped,
      errors: result.errors,
    })
    return result
  }
}

export function importFolder(
  libraryId: string,
  folderPath: string,
  win: BrowserWindow,
): Promise<ImportResult> {
  return importFolders(libraryId, [folderPath], win)
}
export function importFolders(
  libraryId: string,
  folderPaths: string[],
  win: BrowserWindow,
): Promise<ImportResult> {
  if (
    !folderPaths.length ||
    folderPaths.length > 100 ||
    folderPaths.some((folder) => !folder.trim())
  )
    return Promise.reject(new Error('가져올 폴더를 1~100개 선택해 주세요.'))
  return withLibraryWork(libraryId, (signal) => runFolderWork(libraryId, folderPaths, win, signal))
}
export function refreshLibrary(libraryId: string, win: BrowserWindow): Promise<ImportResult> {
  return withLibraryWork(libraryId, (signal) => runFolderWork(libraryId, undefined, win, signal))
}

/** Import exactly the selected files, without scanning or registering their parent folders. */
export function importFiles(
  libraryId: string,
  filePaths: string[],
  win: BrowserWindow,
): Promise<ImportResult> {
  return withLibraryWork(libraryId, async (signal) => {
    const db = getDatabase(libraryId)
    if (!db) throw new Error('라이브러리가 열려 있지 않습니다')
    const emit = createEmitter(libraryId, win)
    const result: ImportResult = { added: 0, skipped: 0, removed: 0, errors: [] }
    const requested = [...new Map(filePaths.map((file) => [pathKey(file), resolve(file)])).values()]
    const files: string[] = []
    try {
      for (const [index, file] of requested.entries()) {
        throwIfWorkCancelled(signal)
        emit({
          phase: 'scanning',
          total: requested.length,
          current: index + 1,
          currentFile: basename(file),
          errors: result.errors,
        })
        try {
          if (!isVideoFile(file) || !(await stat(file)).isFile())
            throw new Error('지원하는 영상 파일을 선택해 주세요.')
          files.push(file)
        } catch (error) {
          result.errors.push(basename(file) + ': ' + (error as Error).message)
        }
        await yieldLibraryWork(signal)
      }
      const sidecars: Sidecars = new Map()
      // Read only immediate siblings for sidecar matching; never walk the whole folder tree.
      for (const folder of new Set(files.map(dirname))) {
        throwIfWorkCancelled(signal)
        const entries = await readdir(folder, { withFileTypes: true })
        const videoKeys = new Set(
          entries
            .filter((entry) => entry.isFile() && isVideoFile(entry.name))
            .map((entry) => subtitleVideoKey(join(folder, entry.name))),
        )
        const selectedKeys = new Set(
          files.filter((file) => dirname(file) === folder).map(subtitleVideoKey),
        )
        for (const entry of entries) {
          if (!entry.isFile() || !subtitleExtensions.has(extname(entry.name).toLowerCase()))
            continue
          const match = matchSidecarSubtitle(join(folder, entry.name), videoKeys)
          if (!match || !selectedKeys.has(match.videoKey)) continue
          const related = sidecars.get(match.videoKey) ?? []
          related.push(match.subtitle)
          sidecars.set(match.videoKey, related)
        }
        await yieldLibraryWork(signal)
      }
      await importScannedFiles(libraryId, db, files, sidecars, signal, result, emit)
      throwIfWorkCancelled(signal)
      emit({ phase: 'done', total: files.length, current: files.length, errors: result.errors })
      return result
    } catch (error) {
      if (!isAbortError(error) && !signal.aborted) throw error
      result.cancelled = true
      emit({
        phase: 'cancelled',
        total: files.length,
        current: result.added + result.skipped,
        errors: result.errors,
      })
      return result
    }
  })
}

function libraryRoots(libraryId: string): string[] {
  const library = listLibraries().find((entry) => entry.id === libraryId)
  if (!library) throw new Error('라이브러리를 찾을 수 없습니다')
  return uniqueRoots([library.folderPath, ...(library.folderPaths ?? [])].filter(Boolean))
}

/** Registered folders plus every folder holding library videos (with counts). */
export function getFolderTree(libraryId: string): FolderTree {
  const db = getDatabase(libraryId)
  if (!db) throw new Error('라이브러리가 열려 있지 않습니다')
  const counts = new Map<string, { path: string; count: number }>()
  const rows = db
    .prepare('SELECT file_path FROM videos WHERE removal_mode IS NULL')
    .all() as Array<{ file_path: string }>
  for (const row of rows) {
    const dir = dirname(row.file_path)
    const key = pathKey(dir)
    const entry = counts.get(key)
    if (entry) entry.count++
    else counts.set(key, { path: dir, count: 1 })
  }
  return { roots: libraryRoots(libraryId), dirs: [...counts.values()] }
}

/** Open a library folder in Explorer. Only registered folders, their
 *  subfolders, and folders that hold library videos may be opened. */
export async function openLibraryFolder(libraryId: string, folder: string): Promise<void> {
  const target = resolve(folder)
  const allowed =
    libraryRoots(libraryId).some((root) => insideFolder(target, root)) ||
    getFolderTree(libraryId).dirs.some((dir) => pathKey(dir.path) === pathKey(target))
  if (!allowed) throw new Error('라이브러리에 등록된 폴더가 아닙니다')
  const message = await shell.openPath(target)
  if (message) throw new Error(message)
}
