import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { inside, instanceDir, launcherPaths, versionFiles } from './paths'

describe('paths', () => {
  const root = resolve('/data/WaveClient')
  const paths = launcherPaths(root)

  it('lays out shared game files apart from instances', () => {
    expect(paths.libraries).toBe(join(root, 'shared', 'libraries'))
    expect(versionFiles(paths, '1.21.11').jar).toBe(join(root, 'shared', 'versions', '1.21.11', '1.21.11.jar'))
    expect(instanceDir(paths, 'default')).toBe(join(root, 'instances', 'default'))
  })

  it('refuses paths from metadata that escape their folder', () => {
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\Windows', 'C:x', '', '.', 'a\0b']) {
      expect(() => inside(paths.libraries, bad), JSON.stringify(bad)).toThrow()
    }

    expect(inside(paths.libraries, 'org/lwjgl/lwjgl.jar')).toBe(join(paths.libraries, 'org', 'lwjgl', 'lwjgl.jar'))
    expect(() => versionFiles(paths, '../evil')).toThrow()
  })

  it('accepts only safe profile ids', () => {
    for (const bad of ['', 'Default', '../x', 'a b', 'x'.repeat(65), '-x']) {
      expect(() => instanceDir(paths, bad), bad).toThrow()
    }
  })
})
