import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PINS } from './pins'

describe('PINS', () => {
  it('match the versions the mod is built against', () => {
    const properties = Object.fromEntries(
      readFileSync(join(__dirname, '../../../../mod/gradle.properties'), 'utf8')
        .split(/\r?\n/)
        .filter((line) => /^\w+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()])
    )

    expect(PINS.minecraft).toBe(properties.minecraft_version)
    expect(PINS.fabricLoader).toBe(properties.loader_version)
    expect(PINS.fabricApi).toBe(properties.fabric_api_version)
  })
})
