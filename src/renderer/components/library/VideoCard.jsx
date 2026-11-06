// Restored application logic from the packaged 0.1.0 release; vendor code is imported from npm.
import * as React from 'react'
import { toLocalMediaUrl } from '../../utils/media'
import ThumbnailJobStatus from './ThumbnailJobStatus'
import ProtectedThumbnail from '../privacy/ProtectedThumbnail'
const SUBTITLE_PHASE_LABELS = {
  queued: '자막 생성 대기',
  preparing: '자막 생성 준비 중',
  loading: '음성 모델 로딩 중',
  transcribing: '자막 생성 중',
  translating: '한국어 번역 중',
  saving: '자막 저장 중',
  pausing: '자막 일시정지 중',
  paused: '자막 일시정지',
  removing: '자막 작업 삭제 중',
  failed: '자막 생성 실패',
}
const RUNNING_SUBTITLE_PHASES = new Set([
  'preparing',
  'loading',
  'transcribing',
  'translating',
  'saving',
  'pausing',
  'removing',
])
function VideoCard({
  video,
  subtitleJob,
  thumbnailJob,
  onCancelThumbnail,
  thumbnailCancelError,
  isCancellingThumbnail,
  isSelected,
  onClick,
  onDoubleClick,
}) {
  const primary = video.primaryThumbnailPath
  const hasSubtitles = Boolean(video.hasSubtitles)
  const displayTitle = video.title?.trim() || video.fileName
  const subtitleLabel = SUBTITLE_PHASE_LABELS[subtitleJob?.phase]
  const isSubtitleRunning = RUNNING_SUBTITLE_PHASES.has(subtitleJob?.phase)
  const subtitlePercent = Math.round(
    Math.min(100, Math.max(0, Number.isFinite(subtitleJob?.percent) ? subtitleJob.percent : 0)),
  )
  const subtitleTone =
    subtitleJob?.phase === 'failed'
      ? 'border-red-400/40 text-red-200'
      : subtitleJob?.phase === 'paused' || subtitleJob?.phase === 'pausing'
        ? 'border-amber-400/40 text-amber-200'
        : isSubtitleRunning
          ? 'border-cyan-400/40 text-cyan-200'
          : 'border-indigo-400/40 text-indigo-200'
  const ratingLabel = formatRating(video.rating)
  const performerNames = splitList(video.performers)
  const tagNames = splitList(video.tags)
  const playSummary =
    video.playCount > 0
      ? `재생 ${video.playCount.toLocaleString()}회 · 총 ${formatDuration(video.playTimeSec)} · ${formatDateTime(video.lastPlayedAt)}`
      : '재생 기록 없음'
  return (
    <div
      className="relative h-full w-full min-w-0"
      role="group"
      aria-label={`${displayTitle} 영상 카드`}
    >
      <button
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        aria-label={`${displayTitle} 영상 카드`}
        className={`group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-zinc-900 text-left transition-colors ${isSelected ? 'border-indigo-500 ring-1 ring-indigo-500/40' : isSubtitleRunning ? 'border-cyan-500/70 hover:border-cyan-400' : 'border-zinc-800 hover:border-zinc-500'}`}
      >
        <div className={'relative aspect-video w-full flex-none overflow-hidden bg-zinc-800'}>
          {primary ? (
            <ProtectedThumbnail
              src={toLocalMediaUrl(primary, video.id)}
              alt={displayTitle}
              className={
                'h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]'
              }
            />
          ) : (
            <div className={'flex h-full items-center justify-center text-zinc-600'}>
              <svg
                xmlns={'http://www.w3.org/2000/svg'}
                className={'h-8 w-8'}
                fill={'none'}
                viewBox={'0 0 24 24'}
                stroke={'currentColor'}
              >
                <path
                  strokeLinecap={'round'}
                  strokeLinejoin={'round'}
                  strokeWidth={1.5}
                  d={
                    'M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.89L15 14M4 8a2 2 0 012-2h9a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V8z'
                  }
                />
              </svg>
            </div>
          )}
          {subtitleLabel && (
            <div
              role="status"
              aria-label={`${displayTitle} 자막 작업`}
              aria-live="off"
              title={subtitleJob.message || subtitleLabel}
              className={`absolute inset-x-0 bottom-0 border-t bg-zinc-950/95 ${subtitleTone}`}
            >
              <div className="flex min-w-0 items-center gap-2 px-2.5 py-2">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full bg-current ${isSubtitleRunning ? 'motion-safe:animate-pulse' : ''}`}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                  {subtitleLabel}
                </span>
                {isSubtitleRunning && (
                  <span className="shrink-0 text-[11px] font-medium tabular-nums">
                    {subtitlePercent}%
                  </span>
                )}
              </div>
              {isSubtitleRunning && (
                <div
                  role="progressbar"
                  aria-label={`${displayTitle} 자막 생성 단계 진행률`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={subtitlePercent}
                  aria-valuetext={`${subtitleLabel}, 현재 단계 ${subtitlePercent}%`}
                  className="h-1 bg-white/10"
                >
                  <div
                    className="h-full bg-current transition-[width] duration-300 motion-reduce:transition-none"
                    style={{ width: `${subtitlePercent}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        <div className={'flex min-h-0 w-full min-w-0 flex-1 flex-col gap-1.5 p-3'}>
          <div className={'flex h-4 items-center gap-0.5'} aria-label={`별점 ${ratingLabel}`}>
            {Array.from({ length: 5 }, (_, index) => {
              const starIndex = index + 1
              const isFilled = video.rating >= starIndex
              const isHalfFilled = !isFilled && video.rating >= starIndex - 0.5
              return (
                <span
                  className={`text-sm leading-none ${isFilled || isHalfFilled ? 'text-yellow-400' : 'text-zinc-700'}`}
                  key={starIndex}
                >
                  {isHalfFilled ? '⯨' : '★'}
                </span>
              )
            })}
          </div>
          <p
            className={
              'line-clamp-2 h-9 min-w-0 flex-none overflow-hidden text-sm font-semibold leading-[1.125rem] text-zinc-100 [overflow-wrap:anywhere]'
            }
            title={video.fileName}
          >
            {displayTitle}
          </p>
          <ChipRow
            items={performerNames}
            empty="배우 정보 없음"
            chipClassName="bg-indigo-600/25 text-indigo-200"
          />
          <ChipRow
            items={tagNames}
            empty="태그 없음"
            chipClassName="bg-zinc-800 text-zinc-300"
          />
          <p className={'mt-auto h-4 truncate text-[11px] leading-4 text-zinc-400'} title={playSummary}>
            {playSummary}
          </p>
          <div
            className={
              'flex h-4 min-w-0 items-center justify-between gap-2 text-[11px] leading-4 text-zinc-500'
            }
          >
            <span className="truncate">
              {'이어보기 '}
              {formatDuration(video.resumePosSec)}
            </span>
            <span className={`shrink-0 ${hasSubtitles ? 'text-sky-300' : ''}`}>
              {hasSubtitles ? '자막 준비됨' : '자막 없음'}
            </span>
          </div>
        </div>
      </button>
      {thumbnailJob && thumbnailJob.phase !== 'completed' && (
        <div className="absolute inset-x-2 top-11">
          <ThumbnailJobStatus
            job={thumbnailJob}
            label={`${displayTitle} 썸네일 작업`}
            onCancel={onCancelThumbnail}
            isCancelling={isCancellingThumbnail}
            cancelError={thumbnailCancelError}
            compact
          />
        </div>
      )}
    </div>
  )
}
const VideoCard$1 = React.memo(VideoCard)
function formatDuration(sec) {
  const safeSec = Math.max(0, Math.floor(sec))
  const hours = Math.floor(safeSec / 3600)
  const minutes = Math.floor((safeSec % 3600) / 60)
  const seconds = Math.floor(safeSec % 60)
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
function formatDateTime(value) {
  if (!value) return '없음'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString()
}
function splitList(value) {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
function ChipRow({ items, empty, chipClassName }) {
  return (
    <div
      className={'flex h-5 min-w-0 flex-none flex-wrap gap-1 overflow-hidden'}
      title={items.join(', ')}
    >
      {items.length ? (
        items.map((item) => (
          <span
            className={`max-w-full truncate rounded px-1.5 py-0.5 text-[10px] leading-4 ${chipClassName}`}
            key={item}
          >
            {item}
          </span>
        ))
      ) : (
        <span className={'text-[10px] leading-5 text-zinc-600'}>{empty}</span>
      )}
    </div>
  )
}
function formatRating(rating) {
  return `${Number(rating || 0).toFixed(1)}/5`
}
export default VideoCard$1
