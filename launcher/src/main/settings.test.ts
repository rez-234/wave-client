import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '@shared/ipc'

import { SettingsStore, riskyJvmArgs, sanitizeSettings, splitJvmArgs } from './settings'

describe('sanitizeSettings', () => {
  it('fills defaults and drops unknown keys (memory and JVM arguments now belong to profiles)', () => {
    expect(sanitizeSettings({ evil: true, memoryMb: 8192, jvmArgs: '-Xss2M' })).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps sizes to sane ranges', () => {
    expect(sanitizeSettings({ width: -5, height: 1e9 })).toMatchObject({ width: 320, height: 16384 })
    expect(sanitizeSettings({ afterLaunch: 'explode' })).toMatchObject({ afterLaunch: 'keep-open' })
  })

  it('accepts clearing the Java path', () => {
    expect(sanitizeSettings({ javaPath: ' /usr/bin/java ' }).javaPath).toBe('/usr/bin/java')
    expect(sanitizeSettings({ javaPath: null }, { ...DEFAULT_SETTINGS, javaPath: '/x' }).javaPath).toBeNull()
    expect(sanitizeSettings({ javaPath: '   ' }, { ...DEFAULT_SETTINGS, javaPath: '/x' }).javaPath).toBe('/x')
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
    const store = new SettingsStore(file)
    await store.load()
    await store.set({ width: 1600, fullscreen: true })
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ width: 1600, fullscreen: true })

    const again = new SettingsStore(file)
    expect((await again.load()).width).toBe(1600)

    await writeFile(file, '{not json')
    expect(await new SettingsStore(file).load()).toEqual(DEFAULT_SETTINGS)
  })
})
