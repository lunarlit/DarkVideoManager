import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useLibraryStore } from '../store/libraryStore'
import { videosApi } from '../api'

function PerformerAvatar({ name }) {
  const { data: photo } = useQuery({
    queryKey: ['performer-photo', name],
    queryFn: async () => {
      const res = await window.api.videos.performerPhoto(name)
      return res.ok ? res.value : null
    },
    staleTime: 60 * 60_000,
    gcTime: 2 * 60 * 60_000,
    retry: false,
  })
  const initial = (name || '?').trim().charAt(0)
  return (
    <div className="h-24 w-24 overflow-hidden rounded-full bg-zinc-800">
      {photo ? (
        <img src={photo} alt={name} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-zinc-500">
          {initial}
        </div>
      )}
    </div>
  )
}

export default function PerformersPage() {
  const activeLibraryId = useLibraryStore((s) => s.activeLibraryId)
  const openedLibraryId = useLibraryStore((s) => s.openedLibraryId)
  const setMetadataFilters = useLibraryStore((s) => s.setMetadataFilters)
  const setSelectedVideoId = useLibraryStore((s) => s.setSelectedVideoId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [loggingIn, setLoggingIn] = React.useState(false)
  const ready = !!activeLibraryId && openedLibraryId === activeLibraryId

  async function loginToAvdbs() {
    if (loggingIn) return
    setLoggingIn(true)
    try {
      await videosApi.avdbsLogin()
      // Re-fetch photos now that the search is available.
      await queryClient.invalidateQueries({ queryKey: ['performer-photo'] })
    } finally {
      setLoggingIn(false)
    }
  }
  const {
    data: performers = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['performer-counts', activeLibraryId],
    queryFn: async () => {
      const res = await videosApi.performerCounts(activeLibraryId, false)
      if (!res.ok) throw new Error(res.error)
      return res.value
    },
    enabled: ready,
    staleTime: 30_000,
  })

  const [deleteMessage, setDeleteMessage] = React.useState(null)
  const deletePerformer = useMutation({
    mutationFn: async (name) => {
      const res = await videosApi.deletePerformer(activeLibraryId, name)
      if (!res.ok) throw new Error(res.error)
      return res.value
    },
    onSuccess: (count, name) => {
      setDeleteMessage(
        `'${name}'을(를) 영상 ${count}개에서 지웠습니다. 이후 가져오기에서도 배우로 인식하지 않습니다.`,
      )
      queryClient.invalidateQueries({ queryKey: ['performer-counts', activeLibraryId] })
      queryClient.invalidateQueries({ queryKey: ['videos', activeLibraryId] })
      queryClient.invalidateQueries({ queryKey: ['video', activeLibraryId] })
      queryClient.invalidateQueries({ queryKey: ['video-metadata-options', activeLibraryId] })
    },
    onError: (error) => setDeleteMessage(`삭제하지 못했습니다: ${error.message}`),
  })
  function confirmDelete(performer) {
    if (deletePerformer.isPending) return
    if (
      window.confirm(
        `'${performer.name}'을(를) 배우 목록에서 삭제할까요?\n\n영상 ${performer.count}개에서 이 배우 정보가 지워지고, 이후 가져오기에서도 배우로 인식하지 않습니다. 영상 파일은 그대로입니다.`,
      )
    )
      deletePerformer.mutate(performer.name)
  }

  function openPerformer(name) {
    if (!activeLibraryId) return
    setSelectedVideoId(null)
    setMetadataFilters(activeLibraryId, { performer: name })
    navigate('/')
  }

  if (!ready)
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-500">
        라이브러리를 여는 중입니다...
      </div>
    )
  if (isLoading)
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-500">
        배우 목록을 불러오는 중입니다...
      </div>
    )
  if (isError)
    return (
      <div className="flex flex-1 items-center justify-center gap-3 text-red-300">
        배우 목록을 불러오지 못했습니다.
        <button onClick={() => void refetch()} className="underline">
          다시 시도
        </button>
      </div>
    )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-950 p-4">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-zinc-100">배우</h2>
        <span className="text-sm text-zinc-500">{performers.length}명 · 영상 수 순</span>
        <button
          onClick={() => void loginToAvdbs()}
          disabled={loggingIn}
          title="avdbs에 로그인하면 더 많은 배우 사진을 가져옵니다"
          className="ml-auto rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          {loggingIn ? 'avdbs 로그인 처리 중...' : 'avdbs 로그인 (사진 더 가져오기)'}
        </button>
      </div>
      {deleteMessage && (
        <p role="status" className="mb-3 text-xs text-indigo-200">
          {deleteMessage}
        </p>
      )}
      {performers.length === 0 ? (
        <p className="text-sm text-zinc-500">
          배우 정보가 없습니다. 라이브러리에서 목록 업데이트로 가져오세요.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(116px,1fr))] gap-3">
          {performers.map((performer) => (
            <div key={performer.name} className="group relative">
              <button
                onClick={() => openPerformer(performer.name)}
                title={`${performer.name} (${performer.count}편)`}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-3 transition-colors hover:border-indigo-500"
              >
                <PerformerAvatar name={performer.name} />
                <span className="w-full truncate text-center text-sm font-medium text-zinc-100">
                  {performer.name}
                </span>
                <span className="rounded-full bg-indigo-600/20 px-2 py-0.5 text-[11px] font-medium text-indigo-300">
                  {performer.count}편
                </span>
              </button>
              <button
                type="button"
                aria-label={`${performer.name} 배우 삭제`}
                title="배우가 아닌 단어면 삭제"
                onClick={() => confirmDelete(performer)}
                disabled={deletePerformer.isPending}
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-950/80 text-xs text-zinc-400 opacity-0 hover:bg-red-900 hover:text-white focus:opacity-100 group-hover:opacity-100 disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
