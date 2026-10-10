/** Build an independently owned Ubuntu carrier from a locked, unchanged upstream checkout. */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = dirname(fileURLToPath(import.meta.url))
const lock = JSON.parse(readFileSync(join(root, 'upstream.lock.json'), 'utf8'))
const { values } = parseArgs({ options: {
  source: { type: 'string' }, output: { type: 'string' }, cache: { type: 'string' },
  'check-source': { type: 'boolean' },
} })
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Ubuntu packaging requires a Linux x64 build host')
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 19) || major === 23) throw new Error('Use Node.js 22.19+ or 24+')
const output = resolve(values.output ?? join(root, '.cache'))
const source = resolve(values.source ?? join(output, 'upstream'))
const cache = resolve(values.cache ?? join(output, 'downloads'))
mkdirSync(output, { recursive: true })

function git(args) {
  return execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim()
}

async function run(command, args, cwd = source, extraEnvironment = {}) {
  console.log(`ubuntu build: ${command} ${args.join(' ')}`)
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !/^DSH_DESKTOP_/u.test(name) && !/^CSC_/u.test(name)))
  const child = spawn(command, args, { cwd, stdio: 'inherit', env: { ...environment, ...extraEnvironment } })
  await new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`${command} failed: ${code ?? signal}`)))
  })
}

if (!existsSync(source)) {
  mkdirSync(source, { recursive: true })
  await run('git', ['init'], source)
  await run('git', ['remote', 'add', 'origin', lock.repository])
  await run('git', ['fetch', '--depth=1', 'origin', `refs/tags/${lock.ref}:refs/tags/${lock.ref}`])
  await run('git', ['checkout', '--detach', lock.ref])
}
function checkSource() {
  if (git(['rev-parse', 'HEAD']) !== git(['rev-parse', `${lock.ref}^{commit}`])
    || git(['rev-parse', 'HEAD^{tree}']) !== lock.tree) throw new Error(`Upstream checkout must match ${lock.ref} and its locked source tree`)
  if (git(['status', '--porcelain', '--untracked-files=no']) !== '') throw new Error('Upstream tracked files must remain unchanged')
  const version = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version
  if (version !== lock.version) throw new Error('Upstream package version differs from upstream.lock.json')
}
checkSource()
if (values['check-source']) {
  console.log(`ubuntu source: ${lock.ref}, locked source tree verified, tracked files unchanged`)
  process.exit(0)
}
const record = join(output, 'build-record.json')
rmSync(record, { force: true })
try {
  await run('pnpm', ['install', '--frozen-lockfile', '--registry=https://registry.npmjs.org'])
  await run('pnpm', ['run', 'build:official'])
  for (const family of ['dsh', 'vendor']) {
    await run('pnpm', ['run', 'release:pack', '--family', family, '--out', join(output, 'packed', family), '--concurrency', '4'])
  }
  await run('pnpm', ['--dir', 'apps/desktop-host', 'pack', '--pack-destination', join(output, 'packed', 'dsh')])
  await run('pnpm', ['--dir', 'native/system', 'run', 'build:ts'])
  await run('pnpm', ['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', join(output, 'packed', 'native')])
  await run('pnpm', ['exec', 'tsx', join(root, 'prepare.mjs'), source, output, cache])
  await run('pnpm', ['exec', 'tsx', join(root, 'package.mjs'), source, output])
  checkSource()
  writeFileSync(record, `${JSON.stringify({
    upstream: { ...lock, commit: git(['rev-parse', 'HEAD']) }, target: 'linux-x64', asar: false, sourceUnchanged: true,
  }, null, 2)}\n`)
} finally {
  try { checkSource() } catch (error) {
    rmSync(record, { force: true })
    throw error
  }
}
