/** Package and check the ordinary-filesystem Ubuntu carrier, preserving runtime verification. */
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [sourceArg, outputArg] = process.argv.slice(2)
if (!sourceArg || !outputArg) throw new Error('Usage: package.mjs SOURCE OUTPUT')
const source = resolve(sourceArg)
const output = resolve(outputArg)
const require = createRequire(join(source, 'apps/desktop/package.json'))
const { build, Platform, Arch } = require('electron-builder')
const { verifyDesktopRuntime } = await import(pathToFileURL(join(source, 'apps/desktop/src/runtime-tree.ts')).href)
const { smokePreparedRuntime } = await import(pathToFileURL(join(source, 'apps/desktop/scripts/smoke-prepared-runtime.ts')).href)
const version = JSON.parse(readFileSync(join(output, 'app/package.json'), 'utf8')).version
rmSync(join(output, 'artifacts'), { recursive: true, force: true })
const files = await build({
  targets: Platform.LINUX.createTarget('deb', Arch.x64),
  publish: 'never', projectDir: join(output, 'app'),
  config: {
    appId: 'com.deepseek.harness', productName: 'DeepSeek Harness',
    directories: { output: join(output, 'artifacts') },
    artifactName: 'deepseek-harness-${version}-linux-amd64-unsigned.deb',
    protocols: [{ name: 'DeepSeek Harness', schemes: ['dsh'] }],
    asar: false, npmRebuild: false, electronDist: join(output, 'electron'),
    electronVersion: require('electron/package.json').version,
    electronFuses: { runAsNode: true },
    files: ['lib/**/*', 'renderer/**/*', 'package.json',
      { from: join(output, 'app/dsh'), to: 'dsh', filter: ['**/*'] },
      { from: join(output, 'app/dsh/node_modules'), to: 'dsh/node_modules', filter: ['**/*'] }],
    extraResources: [{ from: join(output, 'runtime'), to: 'runtime' },
      { from: join(source, 'apps/desktop/resources/icon-windows.png'), to: 'icon.png' }],
    linux: { target: ['deb'], executableName: 'deepseek-harness', category: 'Development',
      icon: join(source, 'apps/desktop/resources/icon-windows.png'), maintainer: 'DeepSeek Harness contributors' },
    publish: null,
    afterPack: async context => {
      const resources = join(context.appOutDir, 'resources')
      // Shell imports share the integrity-recorded dependencies without copying a second tree.
      rmSync(join(resources, 'app/node_modules'), { recursive: true, force: true })
      symlinkSync('dsh/node_modules', join(resources, 'app/node_modules'), 'dir')
      symlinkSync('../runtime', join(resources, 'app/runtime'), 'dir')
      const runtime = join(resources, 'app/dsh')
      const descriptor = await verifyDesktopRuntime(runtime, version, { platform: 'linux', arch: 'x64' })
      await smokePreparedRuntime(runtime, join(context.appOutDir, 'deepseek-harness'), join(resources, 'runtime'), descriptor)
    },
  },
})
const deb = files.find(file => file.endsWith('.deb'))
if (!deb) throw new Error('electron-builder did not produce a Debian installer')
const sha256 = createHash('sha256').update(readFileSync(deb)).digest('hex')
writeFileSync(`${deb}.sha256`, `${sha256}  ${deb.split('/').at(-1)}\n`)
console.log(`ubuntu package: ${deb}\nsha256: ${sha256}`)
