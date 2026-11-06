import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '', isPackaged: false } }))
vi.mock('../infra/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}))

import { buildCaptureTimes, THUMBNAIL_CANDIDATE_COUNT } from './thumbnail'

describe('buildCaptureTimes', () => {
  it('spreads one point per segment and skips the first and last 5%', () => {
    for (const r of [0, 0.5, 1]) {
      const times = buildCaptureTimes(1000, THUMBNAIL_CANDIDATE_COUNT, () => r)
      expect(times).toHaveLength(8)
      expect(Math.min(...times)).toBeGreaterThanOrEqual(50)
      expect(Math.max(...times)).toBeLessThanOrEqual(950)
      for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1])
    }
  })

  it('picks different scenes on each call', () => {
    expect(buildCaptureTimes(1000)).not.toEqual(buildCaptureTimes(1000))
  })
})
