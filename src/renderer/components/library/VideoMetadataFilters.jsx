import * as React from 'react'
import { useVideoMetadataOptions } from '../../api/useVideos'
import StarRating from './StarRating'

const OP_SYMBOL = { gte: '≥', lte: '≤', eq: '=' }
const OP_LABEL = { gte: '이상', lte: '이하', eq: '같음' }
const NEXT_OP = { gte: 'lte', lte: 'eq', eq: 'gte' }

export default function VideoMetadataFilters({ libraryId, query, onChange, children }) {
  const options = useVideoMetadataOptions(libraryId, Boolean(query.removed))
  const categories = options.data?.categories ?? []
  const tags = options.data?.tags ?? []
  const selectClass =
    'max-w-56 min-w-0 rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-100'
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-2">
      {children}
      <label className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
        카테고리
        <select
          aria-label="카테고리 필터"
          className={selectClass}
          value={query.category === undefined ? '' : `category:${query.category}`}
          onChange={(event) =>
            onChange({ category: event.target.value ? event.target.value.slice(9) : undefined })
          }
        >
          <option value="">모든 카테고리</option>
          <option value="category:">미분류</option>
          {query.category && !categories.includes(query.category) && (
            <option value={`category:${query.category}`}>{query.category}</option>
          )}
          {categories.map((category) => (
            <option key={category} value={`category:${category}`}>
              {category}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
        태그
        <select
          aria-label="태그 필터"
          className={selectClass}
          value={query.tag ?? ''}
          onChange={(event) => onChange({ tag: event.target.value || undefined })}
        >
          <option value="">모든 태그</option>
          {query.tag && !tags.includes(query.tag) && (
            <option value={query.tag}>#{query.tag}</option>
          )}
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              #{tag}
            </option>
          ))}
        </select>
      </label>
      {query.performer && (
        <span className="flex items-center gap-1 rounded bg-indigo-600/25 px-2 py-1 text-xs text-indigo-200">
          배우: {query.performer}
          <button
            type="button"
            aria-label="배우 필터 해제"
            onClick={() => onChange({ performer: undefined })}
            className="px-0.5 text-indigo-300 hover:text-white"
          >
            ✕
          </button>
        </span>
      )}
      {query.folder && (
        <span
          className="flex min-w-0 max-w-96 items-center gap-1 rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-200"
          title={query.folder}
        >
          <span className="truncate">
            폴더: {query.folder.split(/[\\/]/).filter(Boolean).pop()}
          </span>
          <button
            type="button"
            aria-label="폴더 필터 해제"
            onClick={() => onChange({ folder: undefined })}
            className="px-0.5 text-amber-300 hover:text-white"
          >
            ✕
          </button>
        </span>
      )}
      <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
        별점
        <button
          type="button"
          onClick={() => onChange({ ratingOp: NEXT_OP[query.ratingOp ?? 'gte'] })}
          aria-label={`별점 비교: ${OP_LABEL[query.ratingOp ?? 'gte']} (눌러서 바꾸기)`}
          title={`${OP_LABEL[query.ratingOp ?? 'gte']} · 눌러서 바꾸기`}
          className="flex h-6 w-6 items-center justify-center rounded border border-zinc-700 bg-zinc-800 text-sm font-semibold text-zinc-100 hover:bg-zinc-700"
        >
          {OP_SYMBOL[query.ratingOp ?? 'gte']}
        </button>
        <StarRating
          size="sm"
          label="별점 필터"
          value={query.rating ?? 0}
          onChange={(value) =>
            // Clicking the selected value again clears the rating filter.
            onChange(
              value === query.rating
                ? { rating: undefined }
                : { rating: value, ratingOp: query.ratingOp ?? 'gte' },
            )
          }
        />
        {query.rating !== undefined && (
          <button
            type="button"
            aria-label="별점 필터 해제"
            onClick={() => onChange({ rating: undefined })}
            className="px-0.5 text-zinc-500 hover:text-zinc-100"
          >
            ✕
          </button>
        )}
      </div>
      {(query.category !== undefined ||
        query.tag ||
        query.performer ||
        query.folder ||
        query.rating !== undefined) && (
        <button
          type="button"
          onClick={() =>
            onChange({
              category: undefined,
              tag: undefined,
              performer: undefined,
              folder: undefined,
              rating: undefined,
              ratingOp: undefined,
            })
          }
          className="text-xs text-indigo-300 underline hover:text-indigo-200"
        >
          분류 필터 해제
        </button>
      )}
      {options.isError ? (
        <span role="alert" className="text-xs text-amber-200">
          분류 목록을 불러오지 못했습니다.{' '}
          <button
            type="button"
            className="underline"
            disabled={options.isFetching}
            onClick={() => void options.refetch()}
          >
            다시 시도
          </button>
        </span>
      ) : null}
    </div>
  )
}
