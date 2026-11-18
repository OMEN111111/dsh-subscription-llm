// Update checker and self-installer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { compareVersions, checkForUpdate, applyUpdate, parseTar } from '../src/update.js'

/** Build one tar entry with a regular file. */
function tarEntry(path, content) {
  const header = Buffer.alloc(512)
  header.write(path, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8)
  header.write('0000000\0', 108, 8)
  header.write('0000000\0', 116, 8)
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12)
  header.write('00000000000\0', 136, 12)
  header.fill(0x20, 148, 156)
  header.write('0', 156, 1)
  header.write('ustar\0', 257, 6)
  header.write('00', 263, 2)
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8)
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512)
  return Buffer.concat([header, content, padding])
}

test('versions compare numerically', () => {
  assert.ok(compareVersions('0.3.0', '0.2.11') > 0)
  assert.ok(compareVersions('v0.3.0', '0.3.0') === 0)
  assert.ok(compareVersions('0.2.9', '0.2.10') < 0)
})

test('the checker prefers the latest release and falls back to the manifest', async () => {
  const release = await checkForUpdate({
    currentVersion: '0.2.11',
    fetchImpl: async url => new Response(JSON.stringify({ tag_name: 'v0.3.0', html_url: 'https://example.test/release' }), { status: 200 }),
  })
  assert.equal(release.latest, '0.3.0')
  assert.equal(release.hasUpdate, true)

  const fallback = await checkForUpdate({
    currentVersion: '0.3.0',
    fetchImpl: async url => String(url).includes('releases')
      ? new Response('', { status: 404 })
      : new Response(JSON.stringify({ version: '0.3.0' }), { status: 200 }),
  })
  assert.equal(fallback.hasUpdate, false)
})

test('a branch tarball installs only package files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-update-test-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.1.0' }))
  const archive = gzipSync(Buffer.concat([
    tarEntry('repo-main/package.json', Buffer.from(JSON.stringify({ version: '9.9.9' }))),
    tarEntry('repo-main/index.js', Buffer.from('export const updated = true\n')),
    tarEntry('repo-main/src/app.js', Buffer.from('export const app = true\n')),
    tarEntry('repo-main/.agent/secret.txt', Buffer.from('skip me')),
    Buffer.alloc(1024),
  ]))
  const result = await applyUpdate({
    root,
    fetchImpl: async url => {
      if (String(url).includes('releases/latest')) {
        return new Response(JSON.stringify({ tag_name: 'v9.9.9' }), { status: 200 })
      }
      if (String(url).includes('codeload')) {
        return new Response(archive, { status: 200 })
      }
      return new Response('', { status: 404 })
    },
  })
  assert.equal(result.updated, true)
  assert.equal(result.version, '9.9.9')
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '9.9.9')
  assert.equal(readFileSync(join(root, 'src', 'app.js'), 'utf8'), 'export const app = true\n')
  assert.equal(readFileSync(join(root, 'index.js'), 'utf8'), 'export const updated = true\n')
  assert.throws(() => readFileSync(join(root, '.agent', 'secret.txt')))
})

test('tar parsing ignores directories and returns file bytes', () => {
  const entries = parseTar(Buffer.concat([
    tarEntry('root/a.txt', Buffer.from('hello')),
    Buffer.alloc(1024),
  ]))
  assert.equal(entries.length, 1)
  assert.equal(entries[0].path, 'root/a.txt')
  assert.equal(entries[0].data.toString('utf8'), 'hello')
})
