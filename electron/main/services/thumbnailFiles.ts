import { readdir, rm, rmdir } from 'node:fs/promises'
import { basename, dirname, relative, resolve, isAbsolute } from 'node:path'
import type { Thumbnail } from '@shared/types'
import { getThumbnailsDir } from '../infra/paths'
import { createLogger } from '../infra/logger'

const log = createLogger('thumbnailFiles')

/** A Stash cover ("표지") saved at import; regeneration keeps it. */
export function isStashCover(thumbnail: Pick<Thumbnail, 'filePath'>): boolean {
  return basename(thumbnail.filePath).endsWith('_stash_cover.jpg')
}

function insideDir(root: string, target: string): boolean {
  const rel = relative(root, target)
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Delete thumbnail image files from disk. Only files inside the library's
 * thumbnails folder are touched; a per-job `capture-*` folder left empty is
 * removed too. Failures are logged, never thrown — the DB rows are already gone.
 */
export async function removeThumbnailFiles(
  libraryId: string,
  thumbnails: Array<Pick<Thumbnail, 'filePath'>>,
): Promise<void> {
  const root = resolve(getThumbnailsDir(libraryId))
  const folders = new Set<string>()
  for (const thumbnail of thumbnails) {
    const file = resolve(thumbnail.filePath)
    if (!insideDir(root, file)) continue
    try {
      await rm(file, { force: true, maxRetries: 3, retryDelay: 50 })
    } catch (error) {
      log.warn({ err: error, file }, '썸네일 파일 삭제 실패')
    }
    const folder = dirname(file)
    if (folder !== root && basename(folder).startsWith('capture-')) folders.add(folder)
  }
  for (const folder of folders) {
    try {
      if ((await readdir(folder)).length === 0) await rmdir(folder)
    } catch {
      // Still in use or already gone.
    }
  }
}
