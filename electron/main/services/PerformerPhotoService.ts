import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

// Performer profile photos are stored as files under userData/performer-photos,
// keyed by the normalized performer name, and never expire. A photo that is not
// on disk is looked up on avdbs: a hidden window loads the site (so its browser
// bot-check passes), then runs the same two calls the site's search box makes —
// mint a search `seq`, then load the actor results — and the matching image is
// downloaded. Names that avdbs does not know are remembered for MISS_TTL_MS so
// they are not searched again on every visit.
const AVDBS = 'https://www.avdbs.com/'
const MISS_TTL_MS = 14 * 24 * 60 * 60_000
const LOOKUP_GAP_MS = 1500
const WINDOW_IDLE_MS = 60_000

function normalizeName(name: string): string {
  return name.trim().normalize('NFC').replace(/\s+/g, ' ').toLowerCase()
}
function photoDir(): string {
  return join(app.getPath('userData'), 'performer-photos')
}
function photoFile(key: string): string {
  return join(photoDir(), `${encodeURIComponent(key)}.jpg`)
}
function missFile(): string {
  return join(photoDir(), 'misses.json')
}

const photoCache = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()

async function readDiskPhoto(key: string): Promise<string | null> {
  try {
    return `data:image/jpeg;base64,${(await readFile(photoFile(key))).toString('base64')}`
  } catch {
    return null
  }
}

// --- miss records -----------------------------------------------------------
let misses: Record<string, number> | null = null
async function loadMisses(): Promise<Record<string, number>> {
  if (misses) return misses
  try {
    misses = JSON.parse(await readFile(missFile(), 'utf8')) as Record<string, number>
  } catch {
    misses = {}
  }
  return misses
}
async function recordMiss(key: string): Promise<void> {
  const all = await loadMisses()
  all[key] = Date.now()
  await mkdir(photoDir(), { recursive: true })
  await writeFile(missFile(), JSON.stringify(all))
}
async function recentlyMissed(key: string): Promise<boolean> {
  const at = (await loadMisses())[key]
  return typeof at === 'number' && Date.now() - at < MISS_TTL_MS
}

// --- avdbs lookup window ----------------------------------------------------
let lookupWindow: BrowserWindow | null = null
let windowReady: Promise<BrowserWindow> | null = null
let idleTimer: NodeJS.Timeout | null = null

function closeLookupWindow(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  if (lookupWindow && !lookupWindow.isDestroyed()) lookupWindow.destroy()
  lookupWindow = null
  windowReady = null
}
function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(closeLookupWindow, WINDOW_IDLE_MS)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function openLookupWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { partition: 'persist:avdbs', sandbox: true, contextIsolation: true },
  })
  lookupWindow = win
  win.on('closed', () => {
    if (lookupWindow === win) {
      lookupWindow = null
      windowReady = null
    }
  })
  await win.loadURL(AVDBS)
  // The page script (search_log_move) only exists once the bot-check is passed.
  for (let i = 0; i < 30; i++) {
    if (win.isDestroyed()) break
    const ready = await win.webContents
      .executeJavaScript(`typeof search_log_move === 'function'`)
      .catch(() => false)
    if (ready) return win
    await sleep(500)
  }
  win.destroy()
  throw new Error('avdbs page did not become ready')
}
function getLookupWindow(): Promise<BrowserWindow> {
  if (lookupWindow && !lookupWindow.isDestroyed() && windowReady) return windowReady
  windowReady = openLookupWindow().catch((error) => {
    windowReady = null
    throw error
  })
  return windowReady
}

// Runs inside the avdbs page. Returns the image URL, null when avdbs has no such
// actor, or 'blocked' when the bot-check interrupted the request.
const LOOKUP_SCRIPT = (name: string): string => `(async () => {
  const kwd = ${JSON.stringify(name)};
  const norm = (s) => s.trim().normalize('NFC').replace(/\\s+/g, ' ').toLowerCase();
  const raw = await (await fetch('/w2017/api/iux_kwd_srch_log2.php?op=srch&kwd=' + encodeURIComponent(kwd))).text();
  let j; try { j = JSON.parse(raw) } catch { return 'blocked' }
  if (!(j.cd > 0) || !j.seq) return null;
  const html = await (await fetch('/w2017/page/search/search_actor.php?kwd=' + encodeURIComponent(kwd) + '&seq=' + j.seq)).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = [...doc.querySelectorAll('img')]
    .map((i) => ({ src: i.getAttribute('src') || i.getAttribute('data-src') || '', alt: (i.alt || '').trim() }))
    .filter((x) => /\\/actor\\/a\\d+\\//.test(x.src));
  if (!items.length && /보안 확인/.test(html)) return 'blocked';
  const t = norm(kwd);
  let hit = items.find((x) => norm(x.alt) === t || norm(x.alt).startsWith(t + ' '));
  if (!hit && items.length === 1) hit = items[0];
  return hit ? new URL(hit.src, location.href).href : null;
})()`

async function findPhotoUrl(name: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const win = await getLookupWindow()
    const result = (await win.webContents.executeJavaScript(LOOKUP_SCRIPT(name))) as string | null
    if (result !== 'blocked') return result
    // Bot-check kicked in: reload the page so it can pass again, then retry.
    closeLookupWindow()
    await sleep(4000 * (attempt + 1))
  }
  throw new Error('avdbs lookup blocked')
}

async function downloadImage(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { headers: { Referer: AVDBS } })
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8
  const isPng = buf[0] === 0x89 && buf[1] === 0x50
  return buf.length > 1000 && (isJpeg || isPng) ? buf : null
}

// Lookups run one at a time with a gap, so avdbs is not flooded.
let queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.then(
    () => sleep(LOOKUP_GAP_MS),
    () => sleep(LOOKUP_GAP_MS),
  )
  return run
}

async function fetchAndStore(name: string, key: string): Promise<string | null> {
  if (await recentlyMissed(key)) return null
  return enqueue(async () => {
    try {
      const url = await findPhotoUrl(name)
      const image = url ? await downloadImage(url) : null
      if (!image) {
        await recordMiss(key)
        return null
      }
      await mkdir(photoDir(), { recursive: true })
      await writeFile(photoFile(key), image)
      return `data:image/jpeg;base64,${image.toString('base64')}`
    } catch {
      // Network or bot-check failure: not a real miss, try again next time.
      return null
    } finally {
      scheduleIdleClose()
    }
  })
}

/** Return a performer photo as a data URL: from disk, or fetched from avdbs. */
export async function getPerformerPhoto(name: string): Promise<string | null> {
  const key = normalizeName(name)
  if (!key) return null
  if (photoCache.has(key)) return photoCache.get(key) ?? null
  const pending = inflight.get(key)
  if (pending) return pending
  const task = (async () => {
    const dataUrl = (await readDiskPhoto(key)) ?? (await fetchAndStore(name.trim(), key))
    if (dataUrl) photoCache.set(key, dataUrl)
    return dataUrl
  })().finally(() => inflight.delete(key))
  inflight.set(key, task)
  return task
}

/** Open avdbs in a window (e.g. to log in). Clears the photo cache on close so
 *  newly fetched photos are picked up. */
export function openAvdbsLogin(): Promise<boolean> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1000,
      height: 820,
      title: 'avdbs',
      autoHideMenuBar: true,
      webPreferences: { partition: 'persist:avdbs', sandbox: true, contextIsolation: true },
    })
    win.on('closed', () => {
      photoCache.clear()
      resolve(true)
    })
    win.loadURL('https://www.avdbs.com/menu/member/login.php').catch(() => undefined)
  })
}
