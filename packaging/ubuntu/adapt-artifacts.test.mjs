/** Guard upstream drift and verify Linux receives the existing web account identity. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { adaptLinuxAccountPlatform } from './adapt-artifacts.mjs'

const require = createRequire(resolve(process.env.DSH_UBUNTU_SOURCE ?? '.', 'package.json'))
const ts = require('typescript')
const input = 'new DesktopPlatformView("preload", () => "en_US", process.platform === "win32" ? "win32" : "darwin")'

test('account constructor preserves supported desktops and uses web on Linux', () => {
  const adapted = adaptLinuxAccountPlatform(input, ts)
  for (const [platform, expected] of [['linux', null], ['darwin', 'darwin'], ['win32', 'win32']]) {
    const result = runInNewContext(adapted, { process: { platform }, DesktopPlatformView:
      class { constructor(_preload, _locale, value) { this.platform = value } } })
    assert.equal(result.platform, expected)
  }
})

test('missing or duplicate constructors abort packaging', () => {
  assert.throws(() => adaptLinuxAccountPlatform('console.log("unrelated")', ts), /expected one constructor/u)
  assert.throws(() => adaptLinuxAccountPlatform(`${input};${input}`, ts), /found 2/u)
})

test('changed argument order and platform mapping require explicit review', () => {
  assert.throws(() => adaptLinuxAccountPlatform(input.replace('"darwin"', '"linux"'), ts), /expression changed/u)
  assert.throws(() => adaptLinuxAccountPlatform('new DesktopPlatformView("preload", "darwin")', ts), /expression changed/u)
  assert.throws(() => adaptLinuxAccountPlatform('new DesktopPlatformView', ts), /expression changed/u)
})
