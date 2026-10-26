/**
 * Release preflight for dsh-bili-fav.
 *
 * Runs locally (`npm run check`) and in both GitHub workflows before a release
 * can be cut. It verifies the files the package claims to ship, the DSH bundle
 * and client contract, locale metadata, the icon, and that no credential-like
 * text is committed.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const notes = []

function fail(message) {
  failures.push(message)
}

function note(message) {
  notes.push(message)
}

function read(relative) {
  return readFileSync(join(root, relative), 'utf8')
}

function has(relative) {
  return existsSync(join(root, relative))
}

function isDirectory(relative) {
  try {
    return statSync(join(root, relative)).isDirectory()
  } catch {
    return false
  }
}

const manifest = JSON.parse(read('package.json'))

// #region manifest shape
if (manifest.name !== 'dsh-bili-fav') fail(`package.json: name must be dsh-bili-fav, got ${manifest.name}`)
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(String(manifest.version))) {
  fail(`package.json: invalid version ${manifest.version}`)
}
if (manifest.private === true) fail('package.json: private must not be true when preparing a release')
if (manifest.type !== 'module') fail('package.json: type must be "module"')
if (typeof manifest.description !== 'string' || manifest.description.trim() === '') {
  fail('package.json: missing description')
}
if (manifest.license !== 'MIT') fail('package.json: license must be MIT')
if (manifest.main !== 'index.js') fail('package.json: main must be index.js')
if (typeof manifest.repository?.url !== 'string' || !manifest.repository.url.includes('github.com/mswinandmc/dsh-bili-fav')) {
  fail('package.json: repository.url must point at github.com/mswinandmc/dsh-bili-fav')
}
if (typeof manifest.homepage !== 'string' || !manifest.homepage.includes('github.com/mswinandmc/dsh-bili-fav')) {
  fail('package.json: homepage must point at the GitHub repository')
}
note(`${manifest.name}@${manifest.version}`)
// #endregion

// #region Harness contract
const dsh = manifest.dsh ?? {}
const patchPath = dsh?.bundle?.patch
if (typeof patchPath !== 'string') fail('package.json: missing dsh.bundle.patch')
else if (!has(patchPath)) fail(`package.json: dsh.bundle.patch "${patchPath}" does not exist`)

const client = dsh?.client
if (client === undefined || typeof client !== 'object') fail('package.json: missing dsh.client')
else {
  if (client.platform !== 'web') fail('package.json: dsh.client.platform must be "web"')
  if (!Array.isArray(client.inject) || client.inject.some((entry) => typeof entry !== 'string')) {
    fail('package.json: dsh.client.inject must be an array of package names')
  }
}
// #endregion

// #region exports
const exportsMap = manifest.exports ?? {}
for (const subpath of ['.', './client', './locale/*.json', './icon', './cordis.patch.yml', './package.json']) {
  if (exportsMap[subpath] === undefined) fail(`package.json: exports["${subpath}"] is required`)
}
// #endregion

// #region published files
for (const entry of manifest.files ?? []) {
  if (entry.includes('*')) {
    const base = entry.slice(0, entry.indexOf('*')).replace(/\/$/u, '')
    if (base === '') continue
    if (!has(base)) fail(`package.json: files glob "${entry}" has no "${base}" directory`)
    else if (!isDirectory(base)) fail(`package.json: files glob "${entry}" expects "${base}" to be a directory`)
    continue
  }
  if (!has(entry)) fail(`package.json: files entry "${entry}" does not exist`)
}
for (const required of [
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'icon.svg',
  'locale/en.json',
  'locale/zh.json',
  'README.md',
  'LICENSE',
  'NOTICE.md',
  'lib/bili.js',
  'lib/judge.js',
  'lib/qr.js',
  'lib/store.js',
  'lib/util.js',
  'vendor/qrcode.cjs',
]) {
  if (!has(required)) fail(`missing required file: ${required}`)
}
for (const required of ['lib', 'vendor', 'locale']) {
  if (!(manifest.files ?? []).some((entry) => entry === required || entry.startsWith(`${required}/`))) {
    fail(`package.json: files must include ${required}`)
  }
}
// #endregion

// #region bundle patch
if (typeof patchPath === 'string' && has(patchPath)) {
  const patch = read(patchPath)
  if (!patch.includes('name: dsh-bili-fav') && !patch.includes("name: 'dsh-bili-fav'")) {
    fail(`${patchPath}: must insert a row named "dsh-bili-fav"`)
  }
  if (!/^\s*-\s*insert:/mu.test(patch)) fail(`${patchPath}: must contain an insert list`)
}
// #endregion

// #region host entry
const hostSource = read('index.js')
if (!/export\s+function\s+apply\s*\(/u.test(hostSource)) fail('index.js: must export function apply(ctx, config)')
if (!/export\s+const\s+inject\s*=/u.test(hostSource)) fail('index.js: must export const inject')
// #endregion

// #region client bundle
const clientSource = read('client.js')
const idMatch = /__ModuleLoader__\.load\(\s*\{\s*id:\s*'([^']+)'/u.exec(clientSource)
if (idMatch === null) fail("client.js: must call window.__ModuleLoader__.load({ id: '<package name>', ... })")
else if (idMatch[1] !== manifest.name) fail(`client.js: module id "${idMatch[1]}" != package name "${manifest.name}"`)
if (/\brequire\(['"]@deepseek-ai\//u.test(clientSource)) {
  fail('client.js: must not require a Harness Client package (plain-JS plugins own their primitives)')
}
// #endregion

// #region locale metadata
for (const locale of ['en', 'zh']) {
  const file = `locale/${locale}.json`
  if (!has(file)) continue
  let dict
  try {
    dict = JSON.parse(read(file))
  } catch (error) {
    fail(`${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`)
    continue
  }
  if (typeof dict?.meta?.title !== 'string' || dict.meta.title.trim() === '') fail(`${file}: meta.title is required`)
  if (typeof dict?.meta?.description !== 'string' || dict.meta.description.trim() === '') {
    fail(`${file}: meta.description is required`)
  }
}
// #endregion

// #region icon
if (has('icon.svg')) {
  const icon = read('icon.svg')
  if (!/^\s*<svg[\s>]/u.test(icon)) fail('icon.svg: does not start with an <svg> root')
  if (statSync(join(root, 'icon.svg')).size > 256 * 1024) fail('icon.svg: exceeds the 256 KiB icon limit')
}
// #endregion

// #region credential hygiene
const LEAK_PATTERNS = [
  [/\b_authToken\b/u, 'npm auth token field'],
  [/\bnpm_[A-Za-z0-9]{30,}\b/u, 'npm access token'],
  [/\bghp_[A-Za-z0-9]{30,}\b/u, 'GitHub personal access token'],
  [/\bgho_[A-Za-z0-9]{30,}\b/u, 'GitHub OAuth token'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}\b/u, 'GitHub fine-grained token'],
]
const textFiles = [
  'index.js',
  'client.js',
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'NOTICE.md',
  ...(manifest.files ?? []).filter((entry) => entry.startsWith('lib')),
]
for (const relative of textFiles) {
  if (!has(relative)) continue
  let text
  try {
    text = read(relative)
  } catch {
    continue
  }
  for (const [pattern, label] of LEAK_PATTERNS) {
    if (pattern.test(text)) fail(`${relative}: contains what looks like a ${label}`)
  }
}
if (has('.npmrc')) fail('.npmrc must never be committed; the release uses npm trusted publishing (OIDC)')
// #endregion

// #region report
for (const line of notes) console.log(`ok: ${line}`)
if (failures.length > 0) {
  console.error(`\n${failures.length} release preflight check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`release preflight passed: ${manifest.name}@${manifest.version} is shippable`)
// #endregion
