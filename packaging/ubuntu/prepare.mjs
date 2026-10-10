/** Assemble Linux resources using unchanged upstream preparation and integrity APIs. */
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { adaptLinuxAccountPlatform } from './adapt-artifacts.mjs'

const [sourceArg, outputArg, cacheArg] = process.argv.slice(2)
if (!sourceArg || !outputArg || !cacheArg) throw new Error('Usage: prepare.mjs SOURCE OUTPUT CACHE')
const source = resolve(sourceArg)
const output = resolve(outputArg)
const cache = resolve(cacheArg)
const root = dirname(fileURLToPath(import.meta.url))
const load = path => import(pathToFileURL(join(source, path)).href)
const require = createRequire(join(source, 'apps/desktop/package.json'))
const { downloadArtifact } = await load('apps/desktop/node_modules/@electron/get/dist/index.js')
const extractZip = require('extract-zip')
const ts = require('typescript')
const { preparePrimaryRuntime } = await load('scripts/primary-runtime/prepare.ts')
const { readPrimaryRuntime } = await load('packages/skill/tool-workspace-dependencies/src/index.ts')
const { smokePrimaryRuntime } = await load('apps/desktop/scripts/prepare-primary-runtime.ts')
const { prepareDesktopPackageSet } = await load('apps/desktop/scripts/prepare-package-set.ts')
const { createRuntimeProjectMetadata } = await load('apps/desktop/src/project-manager.ts')
const { DESKTOP_HOST_PROTOCOL_VERSION } = await load('apps/desktop/src/host-protocol.ts')
const { readDesktopCorePackageSet, verifyDesktopCoreLockfile } = await load('apps/desktop/src/core-package-set.ts')
const { prepareRuntimePatches, verifyRuntimePatches } = await load('apps/desktop/scripts/prepare-runtime-patches.ts')
const { desktopRuntimeFileExclusion } = await load('apps/desktop/scripts/runtime-file-policy.ts')
const { selectOfficeEngine } = await load('scripts/libreoffice-packages.mjs')
const { prepareRuntimeManifests } = await load('apps/desktop/scripts/prepare-runtime-manifests.ts')
const { writeDesktopRuntime, verifyDesktopRuntime } = await load('apps/desktop/src/runtime-tree.ts')
const { smokePreparedRuntime } = await load('apps/desktop/scripts/smoke-prepared-runtime.ts')

const runtime = join(output, 'runtime')
const electron = join(output, 'electron')
const app = join(output, 'app')
const dsh = join(app, 'dsh')
const target = { platform: 'linux', arch: 'x64' }
const desktop = JSON.parse(readFileSync(join(source, 'apps/desktop/package.json'), 'utf8'))
for (const path of [runtime, electron, app]) rmSync(path, { recursive: true, force: true })
mkdirSync(runtime, { recursive: true })
mkdirSync(app, { recursive: true })
symlinkSync('../runtime', join(app, 'runtime'), 'dir')
const archive = await downloadArtifact({ version: require('electron/package.json').version,
  platform: 'linux', arch: 'x64', artifactName: 'electron', cacheRoot: cache })
await extractZip(archive, { dir: electron })
const node = join(electron, 'electron')
const nodeVersion = execFileSync(node, ['-p', 'process.versions.node'], {
  encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
}).trim()
await preparePrimaryRuntime({ target: 'linux-x64', output: runtime, cache, version: desktop.version })
const primary = await readPrimaryRuntime(join(runtime, 'primary-runtime'))
if (!primary.pnpm) throw new Error('Prepared runtime has no pnpm version')
const release = { schemaVersion: 1, version: desktop.version,
  hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION, nodeVersion, pnpmVersion: primary.pnpm }
cpSync(join(source, 'apps/desktop/scripts/node-bin'), join(runtime, 'bin'), { recursive: true })
chmodSync(join(runtime, 'bin/node'), 0o755)
mkdirSync(join(runtime, 'cli/bin'), { recursive: true })
cpSync(join(root, 'cli-dsh'), join(runtime, 'cli/bin/dsh'))
chmodSync(join(runtime, 'cli/bin/dsh'), 0o755)
cpSync(join(source, 'apps/desktop/lib/command-manager-entry.js'), join(runtime, 'cli/command-manager.js'))
cpSync(join(source, 'apps/desktop/scripts/command-path.ps1'), join(runtime, 'cli/command-path.ps1'))
writeFileSync(join(runtime, 'versions.json'), `${JSON.stringify({ schemaVersion: 1, node: nodeVersion, pnpm: primary.pnpm }, null, 2)}\n`)

const project = mkdtempSync(join(tmpdir(), 'dsh-ubuntu-project-'))
try {
  prepareDesktopPackageSet(['dsh', 'vendor', 'native'].map(family => join(output, 'packed', family)), project)
  createRuntimeProjectMetadata(project, release)
  const projectManifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'))
  for (const [name, spec] of Object.entries(desktop.dependencies)) {
    if (!projectManifest.dependencies[name]) {
      if (spec.startsWith('workspace:')) throw new Error(`Desktop dependency absent from official closure: ${name}`)
      projectManifest.dependencies[name] = spec
    }
  }
  writeFileSync(join(project, 'package.json'), `${JSON.stringify(projectManifest, null, 2)}\n`)
  const patches = prepareRuntimePatches(project, source)
  const registry = process.env.DSH_UBUNTU_NPM_REGISTRY ?? 'https://registry.npmjs.org'
  const npmrc = join(project, '.npmrc')
  writeFileSync(npmrc, '')
  const pnpm = join(runtime, 'primary-runtime/dependencies/pnpm/bin/pnpm.mjs')
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    name !== 'NODE_OPTIONS' && name !== 'NODE_PATH' && !/^DSH_DESKTOP_/u.test(name) && !/^(?:npm|pnpm|corepack)_/iu.test(name)))
  const runPnpm = args => execFileSync(node, ['--expose-internals', pnpm,
    `--config.registry=${registry}`, `--config.store-dir=${join(output, 'store')}`,
    '--config.enable-global-virtual-store=false', `--config.userconfig=${npmrc}`, ...args], {
    cwd: project, stdio: 'inherit', env: { ...environment, ELECTRON_RUN_AS_NODE: '1',
      DSH_DESKTOP_NODE_EXECUTABLE: node, PATH: `${join(runtime, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      XDG_CACHE_HOME: join(project, 'cache'), XDG_CONFIG_HOME: join(project, 'config'), XDG_STATE_HOME: join(project, 'state') },
  })
  runPnpm(['install', '--lockfile-only'])
  verifyRuntimePatches(project, patches)
  const packageSet = readDesktopCorePackageSet(project, release.version)
  verifyDesktopCoreLockfile(readFileSync(join(project, 'pnpm-lock.yaml'), 'utf8'), packageSet)
  runPnpm(['install', '--prod', '--frozen-lockfile', '--trust-lockfile'])
  const modules = join(project, 'node_modules')
  const officeEngine = selectOfficeEngine(JSON.parse(readFileSync(join(modules, '@deepseek-ai/libreoffice-kit/package.json'), 'utf8')), target)
  mkdirSync(dsh, { recursive: true })
  cpSync(modules, join(dsh, 'node_modules'), { recursive: true, dereference: true,
    filter: path => desktopRuntimeFileExclusion(relative(modules, path), target, officeEngine) === undefined })
  writeFileSync(join(dsh, 'package.json'), `${JSON.stringify({ private: true, dependencies:
    Object.fromEntries(packageSet.packages.map(record => [record.name, record.version])) }, null, 2)}\n`)
  await prepareRuntimeManifests(dsh)
  const descriptor = writeDesktopRuntime(dsh, release, packageSet.packages.map(record => record.name), target)
  await verifyDesktopRuntime(dsh, release.version, target)
  smokePrimaryRuntime(join(runtime, 'primary-runtime'))
  await smokePreparedRuntime(dsh, node, runtime, descriptor)
} finally {
  rmSync(project, { recursive: true, force: true })
}

cpSync(join(source, 'apps/desktop/lib'), join(app, 'lib'), { recursive: true })
cpSync(join(source, 'apps/desktop/renderer'), join(app, 'renderer'), { recursive: true })
const main = join(app, 'lib/main.js')
writeFileSync(main, adaptLinuxAccountPlatform(readFileSync(main, 'utf8'), ts))
writeFileSync(join(app, 'package.json'), `${JSON.stringify({
  name: desktop.name, description: desktop.description, version: desktop.version, license: desktop.license,
  type: 'module', main: desktop.main, private: true, dependencies: {},
  homepage: 'https://github.com/deepseek-ai/deepseek-harness', dshDesktopAppId: 'com.deepseek.harness',
}, null, 2)}\n`)
console.log('ubuntu preparation: runtime verified, upstream source unchanged')
