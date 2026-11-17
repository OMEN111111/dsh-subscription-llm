/**
 * Durable per-channel model catalog.
 *
 * The catalog is plugin-owned state, not a credential and not user config: it
 * records which models a channel currently exposes, the per-model edits the
 * user made, and the last discovery snapshot. It lives as one JSON document
 * under the harness home so it survives restarts.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Layout version; a different version is discarded rather than migrated. */
export const CATALOG_VERSION = 1

/** Folder name under the harness home. */
const FOLDER = 'subscription-channels'

/**
 * One empty catalog.
 * @returns the catalog skeleton.
 */
export function emptyCatalog() {
  return { version: CATALOG_VERSION, channels: {} }
}

/**
 * Locate the catalog document. `$DSH_HOME` wins; otherwise the profile path the
 * plugin module itself was loaded from identifies the home, and the default
 * home is the last resort.
 * @param ctx - plugin context (for `baseUrl`).
 * @returns the absolute document path.
 */
export function catalogPath(ctx) {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return join(fromEnv, FOLDER, 'catalog.json')
  const base = ctx.baseUrl
  if (typeof base === 'string' && base.startsWith('file:')) {
    try {
      const file = fileURLToPath(base)
      const match = /^(.*)[\\/]profiles[\\/][^\\/]+[\\/]/u.exec(file)
      if (match !== null) return join(match[1], FOLDER, 'catalog.json')
    } catch (_notAFileUrl) {
      /* fall through to the default home */
    }
  }
  return join(homedir(), '.dsh', FOLDER, 'catalog.json')
}

/**
 * Read the catalog, treating anything unreadable or of another layout as empty.
 * @param path - document path.
 * @returns the parsed catalog.
 */
export function readCatalog(path) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (_missingOrUnreadable) {
    return emptyCatalog()
  }
  if (parsed === null || typeof parsed !== 'object' || parsed.version !== CATALOG_VERSION) return emptyCatalog()
  const channels = {}
  const raw = parsed.channels
  if (raw !== null && typeof raw === 'object') {
    for (const [id, value] of Object.entries(raw)) {
      if (value === null || typeof value !== 'object') continue
      channels[id] = {
        deleted: Array.isArray(value.deleted) ? value.deleted.filter(entry => typeof entry === 'string') : [],
        overrides: value.overrides !== null && typeof value.overrides === 'object' && !Array.isArray(value.overrides)
          ? value.overrides
          : {},
        discovered: Array.isArray(value.discovered) ? value.discovered.filter(isModel) : [],
      }
    }
  }
  return { version: CATALOG_VERSION, channels }
}

/**
 * Replace the catalog document atomically.
 * @param path - document path.
 * @param catalog - catalog to persist.
 */
export function writeCatalog(path, catalog) {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

/**
 * Whether a value looks like one discovered model entry.
 * @param value - candidate.
 * @returns true for a usable entry.
 */
function isModel(value) {
  return value !== null && typeof value === 'object' && typeof value.id === 'string' && value.id.length > 0
}
