import * as React from 'react'
import { normalizeVideoTag } from '@shared/videoMetadata'

const MAX_SUGGESTIONS = 8

/**
 * Tags as removable chips, plus an input whose existing-tag suggestions appear
 * below it. Clicking a suggestion adds it at once; typing and pressing Enter or
 * the add button adds the typed text (comma or # separated for several).
 */
export default function TagChipsInput({ tags, suggestions, onAdd, onRemove, disabled = false }) {
  const [text, setText] = React.useState('')
  const [focused, setFocused] = React.useState(false)
  const [highlight, setHighlight] = React.useState(-1)
  const inputId = React.useId()
  const listId = `${inputId}-suggestions`

  const current = React.useMemo(() => new Set(tags.map((tag) => tag.toLowerCase())), [tags])
  const query = normalizeVideoTag(text).toLowerCase()
  const matches = React.useMemo(() => {
    if (!query) return []
    const available = suggestions.filter((tag) => !current.has(tag.toLowerCase()))
    const starts = available.filter((tag) => tag.toLowerCase().startsWith(query))
    const contains = available.filter(
      (tag) => !tag.toLowerCase().startsWith(query) && tag.toLowerCase().includes(query),
    )
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS)
  }, [current, query, suggestions])
  const showSuggestions = focused && matches.length > 0

  React.useEffect(() => setHighlight(-1), [query])

  function addTyped() {
    const parts = text
      .split(/[,#\r\n]+/)
      .map((part) => normalizeVideoTag(part))
      .filter(Boolean)
    if (!parts.length) return
    onAdd(parts)
    setText('')
  }
  function pick(tag) {
    onAdd([tag])
    setText('')
  }
  function handleKeyDown(event) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' && matches.length) {
      event.preventDefault()
      setHighlight((index) => (index + 1) % matches.length)
    } else if (event.key === 'ArrowUp' && matches.length) {
      event.preventDefault()
      setHighlight((index) => (index <= 0 ? matches.length - 1 : index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (highlight >= 0 && matches[highlight]) pick(matches[highlight])
      else addTyped()
    } else if (event.key === 'Escape') {
      setHighlight(-1)
      setFocused(false)
    } else if (event.key === 'Backspace' && !text && tags.length) {
      onRemove(tags[tags.length - 1])
    }
  }

  return (
    <div className="space-y-1.5">
      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-0.5 rounded bg-zinc-800 py-0.5 pl-2 pr-0.5 text-xs text-zinc-200"
            >
              #{tag}
              <button
                type="button"
                aria-label={`${tag} 태그 삭제`}
                disabled={disabled}
                onClick={() => onRemove(tag)}
                className="flex h-4 w-4 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700 hover:text-white disabled:opacity-40"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-600">태그 없음</p>
      )}
      <div className="relative">
        <div className="flex gap-1.5">
          <input
            id={inputId}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setFocused(true)
            }}
            onFocus={() => setFocused(true)}
            // Delay so a click on a suggestion lands before the list closes.
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            autoComplete="off"
            role="combobox"
            aria-label="태그 추가"
            aria-expanded={showSuggestions}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder="태그 입력 (기존 태그가 아래에 표시됩니다)"
            className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-hidden focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={addTyped}
            disabled={disabled || !normalizeVideoTag(text.replace(/[,#]/g, ' '))}
            className="shrink-0 rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600 disabled:opacity-40"
          >
            추가
          </button>
        </div>
        {showSuggestions && (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
          >
            {matches.map((tag, index) => (
              <li key={tag} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(tag)}
                  onMouseEnter={() => setHighlight(index)}
                  className={`block w-full truncate px-2 py-1 text-left text-xs ${index === highlight ? 'bg-indigo-600/40 text-white' : 'text-zinc-200 hover:bg-zinc-800'}`}
                >
                  #{tag}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
