/**
 * Check the public GitHub repository for a newer release and install it.
 *
 * The updater is deliberately small: it reads the latest release (falling back
 * to the branch manifest), downloads the branch tarball, and copies regular
 * files over this package. A development checkout (one containing `.git`) is
 * never overwritten; a restart of DSH is required after an update.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'

/** Repository the plugin is published from. */
export const REPO = 'OMEN111111/dsh-subscription-llm'

/** Branch whose tarball is installed. */
export const BRANCH = 'main'

/** Directory names never copied over an installed package. */
const SKIP = new Set(['.git', '.agent', '.github', 'node_modules'])

/** Absolute path of this package. */
export const packageRoot = fileURLToPath(new URL('..', import.meta.url))

/**
 * Compare two dotted versions.
 * @param left - first version.
 * @param right - second version.
 * @returns negative, zero, or positive like a sort comparator.
 */
export function compareVersions(left, right) {
  const parse = value => String(value ?? '').replace(/^v/iu, '').split('.').map(part => Number.parseInt(part, 10) || 0)
  const a = parse(left)
  const b = parse(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * Read this package's version.
 * @param root - package directory.
 * @returns the version string.
 */
function installedVersion(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '0.0.0'
  } catch (_missingManifest) {
    return '0.0.0'
  }
}

/**
 * Ask GitHub for the newest published version.
 * @param options - fetch implementation and the current version.
 * @returns the comparison result.
 */
export async function checkForUpdate(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const current = options.currentVersion ?? installedVersion(options.root ?? packageRoot)
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-subscription-channels' }
  let latest
  let url
  let notes
  try {
    const release = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, { headers })
    if (release.ok) {
      const body = await release.json()
      latest = String(body.tag_name ?? body.name ?? '').replace(/^v/iu, '')
      url = typeof body.html_url === 'string' ? body.html_url : undefined
      notes = typeof body.body === 'string' ? body.body.slice(0, 4000) : undefined
    }
  } catch (_releaseUnavailable) {
    // A repository without releases still publishes a manifest on the branch.
  }
  if (latest === undefined || latest.length === 0) {
    const response = await fetchImpl(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/package.json`, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-subscription-channels' },
    })
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
    const body = await response.json()
    latest = String(body.version ?? '')
    url = `https://github.com/${REPO}`
  }
  return {
    current,
    latest,
    hasUpdate: latest.length > 0 && compareVersions(latest, current) > 0,
    url,
    notes,
  }
}

/**
 * Read one NUL-terminated field from a tar header.
 * @param header - 512-byte header.
 * @param offset - field start.
 * @param length - field width.
 * @returns the trimmed text.
 */
function tarField(header, offset, length) {
  const slice = header.subarray(offset, offset + length)
  const end = slice.indexOf(0)
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8').trim()
}

/**
 * Parse an uncompressed tar archive.
 * @param buffer - archive bytes.
 * @returns regular-file entries with their contents.
 */
export function parseTar(buffer) {
  const entries = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = tarField(header, 0, 100)
    if (name.length === 0) break
    const prefix = tarField(header, 345, 155)
    const size = Number.parseInt(tarField(header, 124, 12) || '0', 8)
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156])
    const dataStart = offset + 512
    const dataEnd = dataStart + (Number.isFinite(size) ? size : 0)
    if (type === '0') {
      entries.push({ path: prefix.length > 0 ? `${prefix}/${name}` : name, data: buffer.subarray(dataStart, dataEnd) })
    }
    offset = dataStart + Math.ceil((Number.isFinite(size) ? size : 0) / 512) * 512
  }
  return entries
}

/**
 * Resolve one archive path below the target directory, refusing traversal.
 * @param root - target directory.
 * @param relative - archive path without the repository prefix.
 * @returns the safe absolute path, or undefined for a skipped entry.
 */
function safeTarget(root, relative) {
  const parts = relative.split('/').filter(part => part.length > 0 && part !== '.')
  if (parts.length === 0 || SKIP.has(parts[0])) return undefined
  const target = resolve(root, ...parts)
  return target.startsWith(resolve(root) + sep) ? target : undefined
}

/**
 * Download and install the newest branch tarball.
 * @param options - fetch implementation, package root, and development override.
 * @returns the update outcome.
 */
export async function applyUpdate(options = {}) {
  const root = options.root ?? packageRoot
  const fetchImpl = options.fetchImpl ?? fetch
  if (existsSync(join(root, '.git'))) {
    try {
      const run = promisify(execFile)
      const { stdout, stderr } = await run('git', ['-C', root, 'pull', '--ff-only'], { timeout: 120_000, windowsHide: true })
      return { updated: true, version: installedVersion(root), method: 'git', detail: String(stdout || stderr).trim().slice(0, 400) }
    } catch (error) {
      return { updated: false, reason: 'git-failed', detail: String(error?.stderr ?? error?.message ?? error).trim().slice(0, 400) }
    }
  }
  const status = await checkForUpdate({ fetchImpl, currentVersion: installedVersion(root) })
  if (!status.hasUpdate) return { updated: false, reason: 'latest', current: status.current, latest: status.latest }
  const response = await fetchImpl(`https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`, {
    headers: { 'user-agent': 'dsh-subscription-channels' },
  })
  if (!response.ok) throw new Error(`the download answered ${response.status}`)
  const archive = gunzipSync(Buffer.from(await response.arrayBuffer()))
  const entries = parseTar(archive)
  const prefix = entries.length > 0 ? entries[0].path.split('/')[0] : ''
  const files = entries
    .map(entry => ({ ...entry, relative: prefix.length > 0 && entry.path.startsWith(`${prefix}/`) ? entry.path.slice(prefix.length + 1) : entry.path }))
    .filter(entry => entry.relative === 'package.json' || entry.relative.startsWith('src/') || [
      'index.js',
      'client.js',
      'cordis.patch.yml',
      'icon.svg',
      'README.md',
      'LICENSE',
      'CHANGELOG.md',
    ].includes(entry.relative) || entry.relative.startsWith('locale/') || entry.relative.startsWith('docs/'))
  if (files.length === 0) throw new Error('the archive contained no installable files')
  const manifest = files.find(entry => entry.relative === 'package.json')
  const version = manifest === undefined ? status.latest : JSON.parse(manifest.data.toString('utf8')).version
  if (compareVersions(version, status.latest) < 0) throw new Error('the archive is older than the announced release')
  const staging = join(tmpdir(), `dsh-subscription-channels-${Date.now()}`)
  try {
    for (const entry of files) {
      const target = safeTarget(staging, entry.relative)
      if (target === undefined) continue
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, entry.data)
    }
    for (const entry of files) {
      const target = safeTarget(root, entry.relative)
      if (target === undefined) continue
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, readFileSync(join(staging, entry.relative)))
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  return { updated: true, version, previous: status.current }
}


