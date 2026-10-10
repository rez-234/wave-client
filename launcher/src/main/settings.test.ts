import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '@shared/ipc'

import { SettingsStore, riskyJvmArgs, sanitizeSettings, splitJvmArgs } from './settings'

describe('sanitizeSettings', () => {
  it('fills defaults and drops unknown keys', () => {
    expect(sanitizeSettings({ evil: true }, 16384)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings(null, 16384)).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps memory to three quarters of the machine and sizes to sane ranges', () => {
    expect(sanitizeSettings({ memoryMb: 999_999 }, 8192).memoryMb).toBe(6144)
    expect(sanitizeSettings({ memoryMb: 10 }, 8192).memoryMb).toBe(1024)
    expect(sanitizeSettings({}, 4096).memoryMb).toBe(3072)
    expect(sanitizeSettings({ width: -5, height: 1e9 }, 8192)).toMatchObject({ width: 320, height: 16384 })
    expect(sanitizeSettings({ memoryMb: Number.NaN, afterLaunch: 'explode' }, 8192)).toMatchObject({ memoryMb: 4096, afterLaunch: 'keep-open' })
  })

  it('accepts clearing the Java path', () => {
    expect(sanitizeSettings({ javaPath: ' /usr/bin/java ' }, 8192).javaPath).toBe('/usr/bin/java')
    expect(sanitizeSettings({ javaPath: null }, 8192, { ...DEFAULT_SETTINGS, javaPath: '/x' }).javaPath).toBeNull()
    expect(sanitizeSettings({ javaPath: '   ' }, 8192, { ...DEFAULT_SETTINGS, javaPath: '/x' }).javaPath).toBe('/x')
  })
})

describe('riskyJvmArgs', () => {
  it('lets common tuning flags through without asking', () => {
    const tuning =
      '-Xmx6G -Xms2G -Xss4M -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:G1HeapRegionSize=8M ' +
      '-XX:+UseZGC -XX:+ZGenerational -XX:-UseCompressedOops -Xshare:auto -Xlog:gc* -server -Dsodium.checks.issue2561=false -Dlog4j2.formatMsgNoLookups=true ' +
      '-Dfile.encoding=UTF-8 -Djava.net.preferIPv4Stack=true -Dfml.ignoreInvalidMinecraftCertificates=true'
    expect(riskyJvmArgs(splitJvmArgs(tuning))).toEqual([])
  })

  it('asks about anything that runs or loads code, in every spelling', () => {
    const risky = [
      '-XX:OnOutOfMemoryError=cmd /c calc',
      '-XX:OnError=calc',
      '-javaagent:\\\\h\\a.jar',
      '-agentlib:jdwp=transport=dt_socket',
      '-Xrunjdwp:transport=dt_socket,server=y,address=*:5005',
      '-Xbootclasspath/a:x',
      '-cp',
      '/evil',
      '-p',
      '-m',
      'evil/evil.Main',
      '--module-path=/x',
      '@args.txt',
      '-Dfabric.addMods=x',
      '-Dlog4j2.configurationFile=http://x',
      '-Djava.library.path=x',
      '-Djava.system.class.loader=Evil',
      '-Dorg.lwjgl.librarypath=x',
      '-Djna.library.path=x',
      '-Dcom.sun.management.jmxremote.port=9010',
      '-Dsome.plugin.dir=/tmp/x',
      '-Xlog:gc*:file=gc.log',
      '-XX:VMOptionsFile=x'
    ]
    expect(riskyJvmArgs(risky)).toEqual(risky)
  })
})

describe('splitJvmArgs', () => {
  it('splits on whitespace and keeps quoted parts together', () => {
    expect(splitJvmArgs('  -XX:+UseZGC   -Dname="a b" \'-Dx=$HOME\' ""')).toEqual(['-XX:+UseZGC', '-Dname=a b', '-Dx=$HOME'])
    expect(splitJvmArgs('"" \'\' -Xss2M ""')).toEqual(['-Xss2M'])
    expect(splitJvmArgs('')).toEqual([])
  })
})

describe('SettingsStore', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-settings-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('persists changes and survives a corrupt file', async () => {
    const file = join(dir, 'launcher.json')
    const store = new SettingsStore(file, 16384)
    await store.load()
    await store.set({ memoryMb: 6000, fullscreen: true })
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ memoryMb: 6000, fullscreen: true })

    const again = new SettingsStore(file, 16384)
    expect((await again.load()).memoryMb).toBe(6000)

    await writeFile(file, '{not json')
    expect(await new SettingsStore(file, 16384).load()).toEqual(DEFAULT_SETTINGS)
  })
})
