import { z } from 'zod'

export const DEFAULT_SEEK_STEP_SEC = 1
export const MIN_SEEK_STEP_SEC = 1
export const MAX_SEEK_STEP_SEC = 600

export const SeekStepSecZ = z.number().finite().int().min(MIN_SEEK_STEP_SEC).max(MAX_SEEK_STEP_SEC)

/** Which player opens when a video is played: the built-in one or the configured external one. */
export const DefaultPlayerZ = z.enum(['inApp', 'native'])
export type DefaultPlayer = z.infer<typeof DefaultPlayerZ>
export const DEFAULT_PLAYER: DefaultPlayer = 'inApp'
