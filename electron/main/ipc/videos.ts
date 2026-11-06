import { setMpvPlaybackRate } from '../services/MpvSessionService.js'
import { IPC } from '@shared/ipc'
import { registerIpcHandler } from './index'
import { ok, err } from '@shared/result'
import { SearchQuery, VideoMeta } from '@shared/types'
import {
  searchVideos,
  getVideoMetadataOptions,
  getPerformerCounts,
  getVideo,
  updateVideoMeta,
  setCategoryForFolder,
  deletePerformer,
  randomVideoId,
  deleteVideo,
  restoreVideo,
  getPlaybackSource,
  getNativePlayerInfo,
  openVideoInNativePlayer,
  seekActivePlayback,
} from '../services/VideoService'
import { createLogger } from '../infra/logger'
import { revealVideoSource } from '../services/VideoSourceLocationService'
import { getPerformerPhoto, openAvdbsLogin } from '../services/PerformerPhotoService'

const log = createLogger('ipc:videos')

export function registerVideoHandlers(): void {
  registerIpcHandler(
    IPC.VIDEOS.SET_ACTIVE_PLAYBACK_RATE,
    async (_event, libraryId, videoId, rate) => {
      if (!(await setMpvPlaybackRate(libraryId, videoId, rate)))
        throw new Error('실행 중인 mpv 플레이어를 찾을 수 없습니다.')
      return ok(rate)
    },
  )
  registerIpcHandler(IPC.VIDEOS.METADATA_OPTIONS, (_event, libraryId, removed = false) =>
    ok(getVideoMetadataOptions(libraryId, removed)),
  )
  registerIpcHandler(IPC.VIDEOS.PERFORMER_COUNTS, (_event, libraryId, removed = false) =>
    ok(getPerformerCounts(libraryId, removed)),
  )
  registerIpcHandler(IPC.VIDEOS.PERFORMER_PHOTO, async (_event, name) =>
    ok(await getPerformerPhoto(name)),
  )
  registerIpcHandler(IPC.VIDEOS.AVDBS_LOGIN, async () => ok(await openAvdbsLogin()))

  registerIpcHandler(IPC.VIDEOS.REVEAL_SOURCE, async (_event, libraryId, videoId) => {
    await revealVideoSource(libraryId, videoId)
    return ok(null)
  })
  registerIpcHandler(IPC.VIDEOS.RESTORE, async (_event, libraryId, videoId) => {
    await restoreVideo(libraryId, videoId)
    return ok(null)
  })
  registerIpcHandler(IPC.VIDEOS.GET_PLAYBACK_SOURCE, async (_event, libraryId, videoId) =>
    ok(await getPlaybackSource(libraryId, videoId)),
  )
  registerIpcHandler(IPC.VIDEOS.GET_NATIVE_PLAYER_INFO, async () => ok(await getNativePlayerInfo()))
  registerIpcHandler(
    IPC.VIDEOS.OPEN_IN_NATIVE_PLAYER,
    async (event, libraryId, videoId, options = {}) =>
      ok(await openVideoInNativePlayer(libraryId, videoId, event.sender, options)),
  )
  registerIpcHandler(IPC.VIDEOS.SEEK_ACTIVE_PLAYBACK, async (_event, libraryId, videoId, timeSec) =>
    ok(await seekActivePlayback(libraryId, videoId, timeSec)),
  )
  registerIpcHandler(IPC.VIDEOS.SEARCH, (_e, libraryId: string, query: SearchQuery) => {
    try {
      return ok(searchVideos(libraryId, query))
    } catch (e) {
      log.error({ err: e }, 'videos:search 오류')
      return err((e as Error).message)
    }
  })

  registerIpcHandler(IPC.VIDEOS.GET, (_e, libraryId: string, videoId: string) => {
    try {
      return ok(getVideo(libraryId, videoId))
    } catch (e) {
      log.error({ err: e }, 'videos:get 오류')
      return err((e as Error).message)
    }
  })

  registerIpcHandler(
    IPC.VIDEOS.UPDATE_META,
    (_e, libraryId: string, videoId: string, meta: VideoMeta) => {
      try {
        updateVideoMeta(libraryId, videoId, meta)
        return ok(null)
      } catch (e) {
        log.error({ err: e }, 'videos:updateMeta 오류')
        return err((e as Error).message)
      }
    },
  )

  registerIpcHandler(IPC.VIDEOS.RANDOM_ID, (_e, libraryId, query) => {
    try {
      return ok(randomVideoId(libraryId, query as SearchQuery))
    } catch (e) {
      return err((e as Error).message)
    }
  })

  registerIpcHandler(IPC.VIDEOS.DELETE_PERFORMER, (_e, libraryId, name) => {
    try {
      return ok(deletePerformer(libraryId, name))
    } catch (e) {
      log.error({ err: e }, 'videos:deletePerformer 오류')
      return err((e as Error).message)
    }
  })

  registerIpcHandler(IPC.VIDEOS.SET_FOLDER_CATEGORY, (_e, libraryId, folder, category) => {
    try {
      return ok(setCategoryForFolder(libraryId, folder, category))
    } catch (e) {
      log.error({ err: e }, 'videos:setFolderCategory 오류')
      return err((e as Error).message)
    }
  })

  registerIpcHandler(IPC.VIDEOS.DELETE, async (_e, libraryId: string, videoId: string, mode) => {
    try {
      await deleteVideo(libraryId, videoId, mode)
      return ok(null)
    } catch (e) {
      log.error({ err: e }, 'videos:delete 오류')
      return err((e as Error).message)
    }
  })
}
