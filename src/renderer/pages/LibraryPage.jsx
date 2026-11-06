// Restored application logic from the packaged 0.1.0 release; vendor code is imported from npm.
import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useLibraryStore } from '../store/libraryStore'
import { useVideos } from '../api/useVideos'
import { useLibrarySubtitleJobs } from '../api/useLibrarySubtitleJobs'
import { useThumbnailJobs } from '../api/useThumbnailJobs'
import { libraryApi } from '../api'
import VideoGrid from '../components/library/VideoGrid'
import DetailPanel from '../components/library/DetailPanel'
import ImportDialog, { useLibraryWorkProgress } from '../components/library/ImportDialog'
import VideoMetadataFilters from '../components/library/VideoMetadataFilters'
import { requestPrivacyExit } from '../components/privacy/PrivacyBoundary'
function LibraryPage() {
  const {
    activeLibraryId,
    openedLibraryId,
    selectedVideoId,
    setSelectedVideoId,
    getSortPreference,
    setSortPreference,
    getSearchText,
    setSearchText,
    getWithoutSubtitles,
    setWithoutSubtitles,
    getMetadataFilters,
    setMetadataFilters,
    getScrollTop,
    setScrollTop,
  } = useLibraryStore()
  const navigate = useNavigate()
  const qc2 = useQueryClient()
  const initialSort = getSortPreference(activeLibraryId)
  const initialSearchText = getSearchText(activeLibraryId)
  const initialScrollTop = getScrollTop(activeLibraryId)
  const [queryLibraryId, setQueryLibraryId] = React.useState(activeLibraryId)
  const isLibraryReady =
    !!activeLibraryId && openedLibraryId === activeLibraryId && queryLibraryId === activeLibraryId
  const subtitleJobs = useLibrarySubtitleJobs(activeLibraryId, isLibraryReady)
  const thumbnailJobs = useThumbnailJobs(activeLibraryId, isLibraryReady)
  const [query, setQuery] = React.useState({
    ...getMetadataFilters(activeLibraryId),
    q: initialSearchText.trim() ? initialSearchText : void 0,
    sortBy: initialSort.sortBy,
    sortDir: initialSort.sortDir,
    page: 1,
    pageSize: 500,
    removed: false,
    hasSubtitles: getWithoutSubtitles(activeLibraryId) ? false : undefined,
  })
  const [searchInput, setSearchInput] = React.useState(initialSearchText)
  const [isComposingSearch, setIsComposingSearch] = React.useState(false)
  const [showImport, setShowImport] = React.useState(false)
  const refreshWork = useLibraryWorkProgress(activeLibraryId)
  const [detailCollapsed, setDetailCollapsedState] = React.useState(() => {
    try {
      return localStorage.getItem(DETAIL_COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })
  function setDetailCollapsed(value) {
    setDetailCollapsedState(value)
    try {
      localStorage.setItem(DETAIL_COLLAPSED_KEY, value ? '1' : '0')
    } catch {
      /* the panel still toggles; it just won't be remembered */
    }
  }
  const [refreshMessage, setRefreshMessage] = React.useState(null)
  const [refreshError, setRefreshError] = React.useState(null)
  const [refreshResult, setRefreshResult] = React.useState(null)
  const activeLibraryRef = React.useRef(activeLibraryId)
  activeLibraryRef.current = activeLibraryId
  React.useEffect(() => {
    setRefreshMessage(null)
    setRefreshError(null)
    setRefreshResult(null)
  }, [activeLibraryId])
  // A finished refresh shows a one-line result that disappears on its own;
  // results with errors stay until dismissed.
  React.useEffect(() => {
    if (!refreshMessage || refreshResult?.errors?.length) return
    const timer = setTimeout(() => {
      setRefreshMessage(null)
      setRefreshResult(null)
    }, 5000)
    return () => clearTimeout(timer)
  }, [refreshMessage, refreshResult])
  const refreshLibrary = useMutation({
    mutationFn: async (libraryId) => {
      if (!libraryId) throw new Error('Library is not selected')
      const res = await libraryApi.refresh(libraryId)
      if (!res.ok) throw new Error(res.error)
      return res.value
    },
    onSuccess: (result, libraryId) => {
      if (activeLibraryRef.current === libraryId) {
        setRefreshResult(result)
        setRefreshMessage(
          result.cancelled
            ? '목록 업데이트가 취소되었습니다. 처리된 항목은 반영되었습니다.'
            : result.errors.length
              ? '목록 업데이트 결과를 확인해 주세요. 일부 항목을 처리하지 못했습니다.'
              : '목록 업데이트가 완료되었습니다.',
        )
      }
      qc2.invalidateQueries({
        queryKey: ['videos', libraryId],
      })
      qc2.invalidateQueries({
        queryKey: ['video', libraryId],
      })
      qc2.invalidateQueries({
        queryKey: ['thumbnails', libraryId],
      })
      qc2.invalidateQueries({
        queryKey: ['highlights', libraryId],
      })
      qc2.invalidateQueries({ queryKey: ['video-metadata-options', libraryId] })
    },
    onError: (error, libraryId) => {
      if (activeLibraryRef.current === libraryId)
        setRefreshError(error instanceof Error ? error.message : '목록 업데이트에 실패했습니다.')
    },
    onSettled: (_data, _error, libraryId) => refreshWork.finish(libraryId),
  })
  const isRefreshingCurrent =
    refreshLibrary.isPending && refreshLibrary.variables === activeLibraryId
  const {
    data,
    isLoading,
    isError,
    isPlaceholderData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useVideos(activeLibraryId ?? '', query, isLibraryReady)
  const { data: selectedVideo } = useQuery({
    queryKey: ['video', activeLibraryId, selectedVideoId],
    queryFn: async () => {
      if (!activeLibraryId || !selectedVideoId) return null
      const res = await window.api.videos.get(activeLibraryId, selectedVideoId)
      return res.ok ? res.value : null
    },
    enabled: isLibraryReady && !!selectedVideoId,
  })
  React.useEffect(() => {
    const sort = getSortPreference(activeLibraryId)
    setQueryLibraryId(activeLibraryId)
    const savedSearchText = getSearchText(activeLibraryId)
    setSearchInput(savedSearchText)
    setQuery((prev) => ({
      ...prev,
      q: savedSearchText.trim() ? savedSearchText : void 0,
      category: getMetadataFilters(activeLibraryId).category,
      tag: getMetadataFilters(activeLibraryId).tag,
      performer: getMetadataFilters(activeLibraryId).performer,
      folder: getMetadataFilters(activeLibraryId).folder,
      rating: getMetadataFilters(activeLibraryId).rating,
      ratingOp: getMetadataFilters(activeLibraryId).ratingOp,
      sortBy: sort.sortBy,
      sortDir: sort.sortDir,
      page: 1,
      removed: false,
      hasSubtitles: getWithoutSubtitles(activeLibraryId) ? false : undefined,
    }))
  }, [activeLibraryId, getSearchText, getSortPreference, getWithoutSubtitles, getMetadataFilters])
  React.useEffect(() => {
    if (!activeLibraryId || queryLibraryId !== activeLibraryId) return
    setSortPreference(activeLibraryId, {
      sortBy: query.sortBy ?? 'createdAt',
      sortDir: query.sortDir ?? 'desc',
    })
  }, [activeLibraryId, queryLibraryId, query.sortBy, query.sortDir, setSortPreference])
  React.useEffect(() => {
    let thumbnailsStarted = false
    return window.api.on.importProgress((progress) => {
      if (!activeLibraryId || (progress.libraryId && progress.libraryId !== activeLibraryId)) return
      if (progress.phase === 'thumbnails' && !thumbnailsStarted) {
        void qc2.invalidateQueries({ queryKey: ['videos', activeLibraryId] })
        void qc2.invalidateQueries({ queryKey: ['thumbnail-jobs', activeLibraryId] })
      }
      thumbnailsStarted = progress.phase === 'thumbnails'
      if (progress.phase === 'done') {
        void qc2.invalidateQueries({ queryKey: ['video-metadata-options', activeLibraryId] })
      }
    })
  }, [activeLibraryId, qc2])
  React.useEffect(() => {
    return window.api.on.thumbnailReady(({ videoId }) => {
      if (!activeLibraryId) return
      qc2.invalidateQueries({
        queryKey: ['thumbnails', activeLibraryId, videoId],
      })
      qc2.invalidateQueries({
        queryKey: ['video', activeLibraryId, videoId],
      })
      qc2.invalidateQueries({
        queryKey: ['videos', activeLibraryId],
      })
    })
  }, [activeLibraryId, qc2])
  React.useEffect(() => {
    return window.api.on.highlightChanged(({ videoId }) => {
      if (!activeLibraryId) return
      qc2.invalidateQueries({
        queryKey: ['highlights', activeLibraryId, videoId],
      })
      qc2.invalidateQueries({
        queryKey: ['video', activeLibraryId, videoId],
      })
    })
  }, [activeLibraryId, qc2])
  React.useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      if (refreshLibrary.isPending) return
      if (event.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]'))
        return
      if (!activeLibraryId) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return
      }
      event.preventDefault()
      requestPrivacyExit()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeLibraryId, refreshLibrary.isPending])
  React.useEffect(() => {
    if (isComposingSearch) return
    const timer = setTimeout(() => {
      setQuery((prev) => ({
        ...prev,
        q: searchInput.trim() ? searchInput : void 0,
        page: 1,
      }))
    }, 350)
    return () => clearTimeout(timer)
  }, [activeLibraryId, isComposingSearch, searchInput])
  function handleVideoClick(video) {
    setSelectedVideoId(video.id)
  }
  function handleRefreshLibrary() {
    if (refreshLibrary.isPending) return
    setRefreshMessage(null)
    setRefreshError(null)
    setRefreshResult(null)
    refreshWork.begin('scanning')
    refreshLibrary.mutate(activeLibraryId)
  }
  function handleVideoDoubleClick(video) {
    if (query.removed || video.removalMode) {
      setSelectedVideoId(video.id)
      return
    }
    navigate(`/player/${activeLibraryId}/${video.id}`)
  }
  function toggleRemovedItems() {
    setSelectedVideoId(null)
    setSearchInput('')
    setIsComposingSearch(false)
    if (activeLibraryId) {
      setSearchText(activeLibraryId, '')
      setScrollTop(activeLibraryId, 0)
    }
    setQuery((prev) => ({ ...prev, removed: !prev.removed, q: undefined, page: 1 }))
  }
  function handleWithoutSubtitlesChange(event) {
    const checked = event.target.checked
    setSelectedVideoId(null)
    if (activeLibraryId) {
      setWithoutSubtitles(activeLibraryId, checked)
      setScrollTop(activeLibraryId, 0)
    }
    setQuery((prev) => ({ ...prev, hasSubtitles: checked ? false : undefined, page: 1 }))
  }
  const [isPickingRandom, setIsPickingRandom] = React.useState(false)
  async function pickRandomVideo() {
    if (!activeLibraryId || isPickingRandom) return
    setIsPickingRandom(true)
    try {
      // Filters only: paging and sort do not affect which videos match.
      const filters = { ...query }
      delete filters.page
      delete filters.pageSize
      delete filters.sortBy
      delete filters.sortDir
      const res = await window.api.videos.randomId(activeLibraryId, filters)
      if (res.ok && res.value) {
        setSelectedVideoId(res.value)
        setDetailCollapsed(false)
      }
    } finally {
      setIsPickingRandom(false)
    }
  }
  function handleMetadataFiltersChange(patch) {
    const filters = {
      category: query.category,
      tag: query.tag,
      performer: query.performer,
      folder: query.folder,
      rating: query.rating,
      ratingOp: query.ratingOp,
      ...patch,
    }
    setSelectedVideoId(null)
    if (activeLibraryId) {
      setMetadataFilters(activeLibraryId, filters)
      setScrollTop(activeLibraryId, 0)
    }
    setQuery((prev) => ({ ...prev, ...filters, page: 1 }))
  }
  function handleSearchChange(event) {
    const nextValue = event.target.value
    setSearchInput(nextValue)
    // Persist input immediately; navigating before the query debounce must not discard it.
    if (activeLibraryId) setSearchText(activeLibraryId, nextValue)
  }
  function handleSearchCompositionStart(_event) {
    setIsComposingSearch(true)
  }
  function handleSearchCompositionEnd(event) {
    const nextValue = event.currentTarget.value
    setIsComposingSearch(false)
    setSearchInput(nextValue)
    if (activeLibraryId) {
      setSearchText(activeLibraryId, nextValue)
    }
    setQuery((prev) => ({
      ...prev,
      q: nextValue.trim() ? nextValue : void 0,
      page: 1,
    }))
  }
  if (!isLibraryReady) {
    return (
      <div className={'flex flex-1 items-center justify-center text-zinc-500'}>
        <p>{'라이브러리를 여는 중입니다...'}</p>
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className={'flex flex-1 items-center justify-center text-zinc-500'}>
        <p>{'영상 목록을 불러오는 중입니다...'}</p>
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className={'flex flex-1 items-center justify-center text-red-400'}>
        <p>{'영상 라이브러리를 불러오지 못했습니다.'}</p>
      </div>
    )
  }
  return (
    <div className={'flex min-h-0 min-w-0 flex-1 overflow-hidden'}>
      <div className={'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'}>
        <div
          className={
            'flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3'
          }
        >
          <input
            type={'text'}
            placeholder={'영상 검색...'}
            aria-label="영상 검색"
            title="제목·파일명·태그 검색. #선수명으로 태그만 검색할 수 있습니다."
            className={
              'min-w-40 flex-1 rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-hidden focus:ring-1 focus:ring-zinc-600'
            }
            value={searchInput}
            onChange={handleSearchChange}
            onCompositionStart={handleSearchCompositionStart}
            onCompositionEnd={handleSearchCompositionEnd}
          />
          <select
            aria-label="영상 정렬 기준"
            value={query.sortBy ?? 'createdAt'}
            onChange={(event) =>
              setQuery((prev) => ({
                ...prev,
                sortBy: event.target.value,
                page: 1,
              }))
            }
            className={
              'rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 outline-hidden focus:ring-1 focus:ring-zinc-600'
            }
          >
            <option value={'rating'}>{'별점순'}</option>
            <option value={'title'}>{'제목순'}</option>
            <option value={'createdAt'}>{'추가된 순'}</option>
            <option value={'playCount'}>{'많이 시청한 순'}</option>
          </select>
          <button
            type="button"
            aria-label={
              (query.sortDir ?? 'desc') === 'asc'
                ? '오름차순 정렬 (눌러서 내림차순)'
                : '내림차순 정렬 (눌러서 오름차순)'
            }
            title={(query.sortDir ?? 'desc') === 'asc' ? '오름차순' : '내림차순'}
            onClick={() =>
              setQuery((prev) => ({
                ...prev,
                sortDir: (prev.sortDir ?? 'desc') === 'asc' ? 'desc' : 'asc',
                page: 1,
              }))
            }
            className={
              'flex h-[30px] w-[30px] items-center justify-center rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100'
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 transition-transform ${(query.sortDir ?? 'desc') === 'asc' ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
          </button>
          <span className={'text-xs text-zinc-500'}>
            {isPlaceholderData ? '검색 중...' : `${data.total}개 영상`}
          </span>
          <button
            type="button"
            onClick={() => void pickRandomVideo()}
            disabled={!data.total || isPickingRandom}
            title="지금 필터에 맞는 영상 중 하나를 무작위로 골라 상세에 보여 줍니다"
            className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
            랜덤 선택
          </button>
          <button
            type="button"
            onClick={toggleRemovedItems}
            aria-pressed={Boolean(query.removed)}
            className={`rounded border px-3 py-1.5 text-xs ${query.removed ? 'border-amber-700 bg-amber-950/40 text-amber-200' : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
          >
            제거한 항목
          </button>
          <button
            onClick={handleRefreshLibrary}
            disabled={refreshLibrary.isPending}
            className={
              'rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50'
            }
          >
            {isRefreshingCurrent ? '목록 갱신 중...' : '목록 업데이트'}
          </button>
          <button
            onClick={() => setShowImport('files')}
            disabled={refreshLibrary.isPending}
            className={'rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500'}
          >
            영상 파일 추가
          </button>
        </div>
        <VideoMetadataFilters
          libraryId={activeLibraryId}
          query={query}
          onChange={handleMetadataFiltersChange}
        >
          <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-zinc-400 hover:text-zinc-200">
            <input
              type="checkbox"
              checked={query.hasSubtitles === false}
              onChange={handleWithoutSubtitlesChange}
              className="h-3.5 w-3.5 accent-indigo-500"
            />
            자막 없는 영상만
          </label>
        </VideoMetadataFilters>
        {refreshLibrary.isPending && !isRefreshingCurrent && (
          <p role="status" className="px-4 py-2 text-xs text-zinc-400">
            다른 라이브러리의 목록 업데이트가 진행 중입니다. 해당 라이브러리로 전환하면 진행 상태를
            확인하거나 취소할 수 있습니다.
          </p>
        )}
        {isRefreshingCurrent && <CompactWorkProgress work={refreshWork} />}
        {!isRefreshingCurrent && (refreshMessage || refreshResult) && (
          <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-1.5 text-xs">
            <p role="status" className="min-w-0 flex-1 truncate text-indigo-200">
              {refreshMessage}
              {refreshResult && (
                <span className="ml-2 text-zinc-400">
                  추가 {refreshResult.added} · 기존 {refreshResult.skipped} · 제거{' '}
                  {refreshResult.removed} · 오류 {refreshResult.errors.length}
                </span>
              )}
            </p>
            <button
              type="button"
              aria-label="결과 닫기"
              onClick={() => {
                setRefreshMessage(null)
                setRefreshResult(null)
              }}
              className="shrink-0 px-1 text-zinc-500 hover:text-zinc-200"
            >
              ✕
            </button>
          </div>
        )}
        {refreshResult?.errors.length > 0 && (
          <ul
            role="alert"
            className="max-h-32 overflow-y-auto break-words px-4 pb-2 text-xs text-amber-300"
          >
            {refreshResult.errors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        )}
        {refreshError && (
          <p role="alert" className="px-4 py-2 text-xs text-red-300">
            {refreshError}
          </p>
        )}
        {query.removed && (
          <p role="status" className="border-b border-zinc-800 px-4 py-2 text-xs text-amber-200">
            제거한 항목입니다. 영상을 선택하여 원본 위치를 확인하고 목록을 복구할 수 있습니다.
          </p>
        )}
        {subtitleJobs.error && (
          <div role="alert" className="flex items-center gap-3 px-4 py-2 text-xs text-amber-200">
            <span>자막 진행 상태를 갱신하지 못했습니다.</span>
            <button
              type="button"
              onClick={() => void subtitleJobs.refetch()}
              disabled={subtitleJobs.isFetching}
              className="underline disabled:opacity-50"
            >
              다시 확인
            </button>
          </div>
        )}
        {thumbnailJobs.error && (
          <div role="alert" className="flex items-center gap-3 px-4 py-2 text-xs text-amber-200">
            <span>썸네일 진행 상태를 갱신하지 못했습니다.</span>
            <button
              type="button"
              onClick={() => void thumbnailJobs.refetch()}
              disabled={thumbnailJobs.isFetching}
              className="underline disabled:opacity-50"
            >
              다시 확인
            </button>
          </div>
        )}
        {isPlaceholderData ? (
          <div
            role="status"
            className="flex min-h-0 flex-1 items-center justify-center text-sm text-zinc-500"
          >
            조건에 맞는 영상을 찾고 있습니다...
          </div>
        ) : (
          <VideoGrid
            key={JSON.stringify([
              activeLibraryId,
              Boolean(query.removed),
              query.hasSubtitles === false,
              query.category,
              query.tag,
              query.performer,
              query.folder,
              query.rating,
              query.ratingOp,
            ])}
            videos={data.videos.filter(
              (video) =>
                Boolean(video.removalMode) === Boolean(query.removed) &&
                (query.hasSubtitles !== false || !video.hasSubtitles),
            )}
            selectedVideoId={selectedVideoId}
            subtitleJobs={subtitleJobs.jobsByVideo}
            thumbnailJobs={thumbnailJobs}
            initialScrollTop={initialScrollTop}
            onScrollTopChange={(value) => setScrollTop(activeLibraryId, value)}
            onVideoClick={handleVideoClick}
            onVideoDoubleClick={handleVideoDoubleClick}
          />
        )}
        {!isPlaceholderData && hasNextPage && (
          <button
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="border-t border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-indigo-300 disabled:opacity-50"
          >
            {isFetchingNextPage
              ? '불러오는 중...'
              : `더 불러오기 (${data.videos.length} / ${data.total})`}
          </button>
        )}
      </div>
      {detailCollapsed ? (
        <aside
          className={
            'flex w-9 shrink-0 flex-col items-center border-l border-zinc-800 bg-zinc-900 pt-2'
          }
        >
          <button
            type="button"
            aria-label="상세 패널 펼치기"
            title="상세 패널 펼치기"
            onClick={() => setDetailCollapsed(false)}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <PanelChevron direction="left" />
          </button>
        </aside>
      ) : (
        <aside className={'relative w-80 shrink-0 border-l border-zinc-800 bg-zinc-900'}>
          <button
            type="button"
            aria-label="상세 패널 접기"
            title="상세 패널 접기"
            onClick={() => setDetailCollapsed(true)}
            className="absolute -left-3 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-400 shadow hover:bg-zinc-800 hover:text-zinc-100"
          >
            <PanelChevron direction="right" />
          </button>
          {selectedVideo ? (
            <DetailPanel
              key={selectedVideo.id}
              video={selectedVideo}
              libraryId={activeLibraryId}
              thumbnailJobs={thumbnailJobs}
              onClose={() => setSelectedVideoId(null)}
              onVideoDeleted={() => setSelectedVideoId(null)}
              onVideoRestored={() => setSelectedVideoId(null)}
              showCloseButton={false}
            onPlay={() => handleVideoDoubleClick(selectedVideo)}
            />
          ) : (
            <div
              className={
                'flex h-full items-center justify-center px-6 text-center text-sm text-zinc-500'
              }
            >
              {'영상을 선택하면 오른쪽에 상세 정보가 표시됩니다.'}
            </div>
          )}
        </aside>
      )}
      {showImport && (
        <ImportDialog
          libraryId={activeLibraryId}
          thumbnailJobs={thumbnailJobs}
          mode={showImport}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  )
}
export default LibraryPage

const REFRESH_PHASE_NAMES = {
  preparing: '준비 중',
  scanning: '파일 검색 중',
  probing: '영상 정보 분석 중',
  thumbnails: '썸네일 생성 중',
  applying: '변경 적용 중',
  done: '마무리 중',
  cancelled: '취소 정리 중',
}
function CompactWorkProgress({ work }) {
  const { progress, isCancelling, cancelError } = work
  const total = progress?.total ?? 0
  const current = progress?.current ?? 0
  const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((current / total) * 100))) : 0
  const label = isCancelling ? '취소 요청 중' : (REFRESH_PHASE_NAMES[progress?.phase] ?? '진행 중')
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-b border-zinc-800 px-4 text-xs">
      <span role="status" className="shrink-0 text-indigo-200">
        목록 업데이트 · {label}
      </span>
      <div
        role="progressbar"
        aria-label="목록 업데이트 진행률"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={total > 0 ? percent : undefined}
        className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-zinc-800"
      >
        <div
          className={`h-full bg-indigo-500 transition-all ${total > 0 ? '' : 'w-1/3 motion-safe:animate-pulse'}`}
          style={total > 0 ? { width: `${percent}%` } : undefined}
        />
      </div>
      <span className="shrink-0 tabular-nums text-zinc-400">
        {total > 0 ? `${current} / ${total}` : ''}
      </span>
      {cancelError && (
        <span role="alert" className="max-w-48 truncate text-amber-300" title={cancelError}>
          {cancelError}
        </span>
      )}
      <button
        type="button"
        onClick={() => void work.cancel()}
        disabled={isCancelling}
        className="shrink-0 text-zinc-400 underline hover:text-zinc-100 disabled:opacity-50"
      >
        취소
      </button>
    </div>
  )
}

const DETAIL_COLLAPSED_KEY = 'dvm:detail-panel-collapsed'
function PanelChevron({ direction }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d={direction === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
    </svg>
  )
}
