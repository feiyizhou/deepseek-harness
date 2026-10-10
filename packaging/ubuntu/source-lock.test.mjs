/** Check that packaging refuses tracked edits and release drift before any build starts. */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('source verification accepts the locked release and rejects edits, tag drift and tree drift', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-ubuntu-source-test-'))
  try {
    const source = join(temporary, 'source')
    mkdirSync(source)
    const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim()
    git(['init', '--quiet'])
    git(['config', 'user.name', 'Packaging fixture'])
    git(['config', 'user.email', 'packaging@example.invalid'])
    const manifest = '{"version":"0.2.1-alpha.2"}\n'
    writeFileSync(join(source, 'package.json'), manifest)
    git(['add', 'package.json'])
    git(['commit', '--quiet', '-m', 'Release fixture'])
    git(['tag', 'dsh-v0.2.1-alpha.2'])
    const release = git(['rev-parse', 'HEAD'])
    const tree = git(['rev-parse', 'HEAD^{tree}'])
    const script = join(temporary, 'build.mjs')
    cpSync(fileURLToPath(new URL('./build.mjs', import.meta.url)), script)
    writeFileSync(join(temporary, 'upstream.lock.json'), JSON.stringify({
      repository: 'https://example.invalid/upstream.git', ref: 'dsh-v0.2.1-alpha.2',
      tree, version: '0.2.1-alpha.2',
    }))
    const check = () => spawnSync(process.execPath, [script, '--source', source,
      '--output', join(temporary, 'output'), '--check-source'], { encoding: 'utf8' })
    assert.equal(check().status, 0)
    writeFileSync(join(source, 'package.json'), '{"version":"changed"}\n')
    assert.match(check().stderr, /tracked files must remain unchanged/u)
    writeFileSync(join(source, 'package.json'), manifest)
    git(['commit', '--quiet', '--allow-empty', '-m', 'Different commit with the same tree'])
    assert.match(check().stderr, /must match.*locked source tree/u)
    git(['checkout', '--quiet', '--detach', release])
    writeFileSync(join(source, 'package.json'), '{"version":"0.2.1-alpha.2","changed":true}\n')
    git(['add', 'package.json'])
    git(['commit', '--quiet', '-m', 'Changed release files'])
    git(['tag', '--force', 'dsh-v0.2.1-alpha.2'])
    assert.match(check().stderr, /must match.*locked source tree/u)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
