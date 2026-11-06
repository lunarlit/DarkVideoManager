import { basename, dirname } from 'node:path'
import { normalizeVideoTag } from '@shared/videoMetadata'
import { getStashMetadataService } from './StashMetadataService'
import { createLogger } from '../infra/logger'
import { loadConfig } from '../infra/config'

const log = createLogger('AutoTag')

/**
 * Folder-name → rating mapping. Matched case-insensitively against a folder name
 * as a whole. Edit this table to change the automatic rating rules.
 */
const FOLDER_RATING: Array<{ name: string; rating: number }> = [
  { name: 'hof', rating: 5 },
  { name: 'certified', rating: 4 },
  { name: 'sustainable', rating: 4.5 },
]

/**
 * Derive an automatic rating from the folders a file lives in. Ancestors are
 * checked nearest-first, so the closest matching folder wins. Returns undefined
 * when no ancestor folder matches a rule.
 */
export function ratingFromPath(filePath: string): number | undefined {
  let dir = dirname(filePath)
  let previous = ''
  while (dir && dir !== previous) {
    const name = basename(dir).toLowerCase()
    const match = FOLDER_RATING.find((entry) => entry.name === name)
    if (match) return match.rating
    previous = dir
    dir = dirname(dir)
  }
  return undefined
}

const HASHTAG = /#([^\s#,]+)/g

/** Extract explicit "#tag" tokens from a file name (extension stripped). */
export function hashtagsFromName(fileName: string): string[] {
  const stem = fileName.replace(/\.[^.]+$/, '')
  const out: string[] = []
  let match: RegExpExecArray | null
  HASHTAG.lastIndex = 0
  while ((match = HASHTAG.exec(stem))) {
    const tag = normalizeVideoTag(match[1])
    if (tag) out.push(tag)
  }
  return out
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Return the known tags that appear in the file name as a whole token, even when
 * they are not prefixed with "#". Matching is case-insensitive and bounded by
 * non letter/number characters so a short tag does not match inside a longer word.
 */
export function matchKnownTags(fileName: string, knownTags: string[]): string[] {
  const stem = fileName.replace(/\.[^.]+$/, '').normalize('NFC')
  const out: string[] = []
  for (const candidate of knownTags) {
    const tag = normalizeVideoTag(candidate)
    if (!tag) continue
    let boundaryMatch = false
    try {
      boundaryMatch = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(tag)}(?![\\p{L}\\p{N}])`,
        'iu',
      ).test(stem)
    } catch {
      boundaryMatch = stem.toLowerCase().includes(tag.toLowerCase())
    }
    if (boundaryMatch) out.push(tag)
  }
  return out
}

/**
 * Extract a release code (e.g. "MIDV-932", "SONE-465", "FC2-PPV-4560698") from a
 * file name. A long free-text query matches nothing in Stash, but the code does,
 * so the code is the reliable key for a Stash lookup. Returns undefined when no
 * code-like token is present.
 */
export function extractStashCode(fileName: string): string | undefined {
  const stem = fileName.replace(/\.[^.]+$/, '')
  // FC2 is more specific and uses long numbers, so match it first.
  const fc2 = stem.match(/FC2[-_ ]?PPV[-_ ]?(\d{5,})/i)
  if (fc2) return `FC2-PPV-${fc2[1]}`
  // Standard studio codes: 2-6 letters, separator, 2-5 digits. The real code sits
  // near the end of the name, so take the last occurrence.
  const matches = [...stem.matchAll(/([A-Za-z]{2,6})[-_ ](\d{2,5})/g)]
  if (matches.length) {
    const last = matches[matches.length - 1]
    return `${last[1].toUpperCase()}-${last[2]}`
  }
  return undefined
}

export interface StashScene {
  id: string
  people: string[]
}

/**
 * Find the Stash scene that matches a file via the configured server, returning
 * its id and performer names. Best-effort: returns null when Stash is disabled or
 * the lookup fails. Prefers searching by the file's release code (far more
 * reliable than the full name); falls back to the name when no code is present.
 * Results are cached per query for the lifetime of the passed cache.
 */
export async function stashSceneForFile(
  fileName: string,
  cache: Map<string, StashScene | null>,
): Promise<StashScene | null> {
  const stem = fileName.replace(/\.[^.]+$/, '').trim()
  if (!stem) return null
  const code = extractStashCode(fileName)
  const query = (code ?? stem).slice(0, 200)
  if (!query) return null
  if (cache.has(query)) return cache.get(query) ?? null
  let scene: StashScene | null = null
  try {
    const result = await getStashMetadataService().search(query, 'text')
    // A code query returns the exact scene first. For a name fallback, prefer a
    // candidate whose title is contained in the file name.
    const lower = stem.toLowerCase()
    const best = code
      ? result.candidates[0]
      : (result.candidates.find((candidate) =>
          candidate.title ? lower.includes(candidate.title.toLowerCase()) : false,
        ) ?? result.candidates[0])
    if (best)
      scene = {
        id: best.id,
        people: (best.people ?? []).map((person) => normalizeVideoTag(person)).filter(Boolean),
      }
  } catch (error) {
    log.warn({ err: error }, 'Stash 조회 실패')
    scene = null
  }
  cache.set(query, scene)
  return scene
}

/**
 * Extract Korean performer name(s) from a file name, given how many performers the
 * scene actually has (determined from Stash). Names sit at the very start of the
 * file name as "성 이름" (two tokens), and multiple performers are separated by
 * "X"/"×" or ",". Returns at most `count` names; returns [] when count <= 0 or the
 * name region does not start with Hangul (e.g. code-prefixed amateur titles).
 * Best-effort — the performers field is user-editable to correct any mis-parse.
 */
// Words that open filenames as descriptions, never as performer names. A
// candidate containing any of these tokens is rejected.
const NON_PERFORMER_TOKENS = new Set(['색기', '색기고딩', '고딩', '골방', '갱뱅', '오지상', '유부녀', '아마추어', '노모', '무수정'])
export function normalizePerformerKey(name: string): string {
  return name.trim().normalize('NFC').replace(/\s+/g, ' ').toLowerCase()
}
/** Names the user deleted from the performer list (stored in the app config). */
export function userBlockedPerformers(): Set<string> {
  try {
    return new Set(loadConfig().performerBlocklist ?? [])
  } catch {
    return new Set()
  }
}
function isNonPerformerName(name: string): boolean {
  return name.split(/\s+/).some((token) => NON_PERFORMER_TOKENS.has(token))
}

export function leadingKoreanNames(fileName: string): string[] {
  const stem = fileName.replace(/\.[^.]+$/, '')
  // Drop leading decorations (★, brackets, spaces) that precede the name.
  const head = stem
    .split('#')[0]
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim()
  // A real performer name starts with a Hangul character.
  if (!head || !/^[가-힣]/.test(head)) return []
  const firstTwo = (text: string): string =>
    text.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(' ')
  const groups = head
    .split(/\s*[,xX×]\s*/)
    .map((group) => firstTwo(group))
    .filter(Boolean)
  const names = groups.length > 1 ? groups : firstTwo(head) ? [firstTwo(head)] : []
  const seen = new Set<string>()
  const unique: string[] = []
  for (const name of names) {
    const key = name.toLowerCase()
    if (name && !seen.has(key) && !isNonPerformerName(name)) {
      seen.add(key)
      unique.push(name)
    }
  }
  return unique
}

export function koreanPerformersFromName(fileName: string, count: number): string[] {
  if (count <= 0) return []
  return leadingKoreanNames(fileName).slice(0, count)
}

/** Whether automatic actor lookups should run (Stash connection enabled). */
export function isStashEnabled(): boolean {
  try {
    return getStashMetadataService().getSettings().enabled
  } catch {
    return false
  }
}
