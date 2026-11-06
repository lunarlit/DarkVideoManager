import * as React from 'react'

const STAR_COUNT = 5

/** Five stars with half-star steps; hover previews, click sets the value. */
export default function StarRating({
  value,
  onChange,
  disabled = false,
  label = '별점',
  size = 'md',
}) {
  const [hovered, setHovered] = React.useState(0)
  const displayValue = hovered || value
  const starClass = size === 'sm' ? 'text-base' : 'text-xl'
  return (
    <div
      className={'relative inline-flex'}
      onMouseLeave={() => setHovered(0)}
      role={'slider'}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={displayValue}
    >
      <div className={'flex gap-0.5'}>
        {Array.from({ length: STAR_COUNT }, (_, index) => {
          const star = index + 1
          return (
            <div className={`relative leading-none ${starClass}`} key={star}>
              <span className={'text-zinc-600'}>{'★'}</span>
              {displayValue >= star && (
                <span className={'absolute inset-0 text-yellow-400'}>{'★'}</span>
              )}
              {displayValue < star && displayValue >= star - 0.5 && (
                <span
                  className={'absolute inset-y-0 left-0 overflow-hidden text-yellow-400'}
                  style={{ width: '50%' }}
                >
                  {'★'}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className={'absolute inset-0 grid grid-cols-10'}>
        {Array.from({ length: STAR_COUNT * 2 }, (_, index) => {
          const nextValue = (index + 1) * 0.5
          return (
            <button
              type={'button'}
              aria-label={`${nextValue}점`}
              disabled={disabled}
              className={'h-full w-full'}
              onClick={() => onChange(nextValue)}
              onMouseEnter={() => setHovered(nextValue)}
              key={nextValue}
            />
          )
        })}
      </div>
    </div>
  )
}
