import { getDatabase } from '../db/connection'
import { ThumbnailRepository } from '../db/repositories/ThumbnailRepository'
import { Thumbnail } from '@shared/types'
import { assertLibraryWorkAllowed } from './LibraryWorkService'
import { assertThumbnailJobAllowed } from './ThumbnailJobService'
import { removeThumbnailFiles } from './thumbnailFiles'

export function getThumbnailsForVideo(libraryId: string, videoId: string): Thumbnail[] {
  const db = getDatabase(libraryId)
  if (!db) throw new Error('라이브러리가 열려 있지 않습니다')
  return new ThumbnailRepository(db).findByVideoId(videoId)
}

export function setPrimaryThumbnail(libraryId: string, thumbnailId: string, videoId: string): void {
  assertLibraryWorkAllowed(libraryId, 'thumbnails', videoId)
  assertThumbnailJobAllowed(libraryId, videoId)
  const db = getDatabase(libraryId)
  if (!db) throw new Error('라이브러리가 열려 있지 않습니다')
  new ThumbnailRepository(db).setPrimary(thumbnailId, videoId)
}

/** Delete every candidate except the primary thumbnail, rows and files. */
export async function pruneThumbnails(libraryId: string, videoId: string): Promise<number> {
  assertLibraryWorkAllowed(libraryId, 'thumbnails', videoId)
  assertThumbnailJobAllowed(libraryId, videoId)
  const db = getDatabase(libraryId)
  if (!db) throw new Error('라이브러리가 열려 있지 않습니다')
  const repository = new ThumbnailRepository(db)
  const all = repository.findByVideoId(videoId)
  if (!all.some((thumbnail) => thumbnail.isPrimary)) {
    throw new Error('대표 썸네일이 없어 정리할 수 없습니다.')
  }
  const extras = all.filter((thumbnail) => !thumbnail.isPrimary)
  if (!extras.length) return 0
  repository.deleteByIds(
    videoId,
    extras.map((thumbnail) => thumbnail.id),
  )
  await removeThumbnailFiles(libraryId, extras)
  return extras.length
}

export {
  ensureThumbnailForVideo,
  captureThumbnailAtTime,
  saveThumbnailImageCapture,
} from './ThumbnailCaptureService.js'

export { listThumbnailJobs, cancelThumbnailJob } from './ThumbnailJobService'
