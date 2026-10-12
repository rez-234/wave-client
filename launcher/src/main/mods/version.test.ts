import { describe, expect, it } from 'vitest'

import { SemanticVersion, StringVersion, VersionParsingError, compareVersions, describePredicates, matchesAny, parsePredicate, parseVersion } from './version'

const semver = (s: string): SemanticVersion => SemanticVersion.parse(s, false)
const parses = (s: string, storeX: boolean): boolean => {
  try {
    SemanticVersion.parse(s, storeX)
    return true
  } catch (error) {
    expect(error).toBeInstanceOf(VersionParsingError)
    return false
  }
}

/** [predicate, versions that match, versions that don't]: Fabric Loader's VersionParsingTests. */
const FABRIC_PREDICATE_VECTORS: Array<[string, string[], string[]]> = [
  [
    '>=0.3.1-beta.2 <0.4.0',
    ['0.3.1-beta.2', '0.3.1-beta.2.1', '0.3.1-beta.3', '0.3.4+build.125', '0.3.7', '0.4.0-alpha.1', '0.3.4-beta.7', '0.3.1-beta.11'],
    ['0.3.0', '0.3.1-beta.1', '0.4.0']
  ],
  [
    '>=0.3.1-beta.2 <0.4.0-',
    ['0.3.1-beta.2', '0.3.1-beta.2.1', '0.3.1-beta.3', '0.3.4+build.125', '0.3.7', '0.3.4-beta.7', '0.3.1-beta.11'],
    ['0.3.0', '0.3.1-beta.1', '0.4.0-alpha.1', '0.4.0']
  ],
  ['>=1.4-', ['1.4-beta.2', '1.4+build.125', '1.4', '1.4.2'], ['1.3', '1.3.5', '1.3-alpha.1']],
  ['<1.4', ['1.3', '1.3.5', '1.3-alpha.1', '1.4-beta.2'], ['1.4+build.125', '1.4']],
  ['<1.4-', ['1.3', '1.3.5', '1.3-alpha.1'], ['1.4-beta.2', '1.4+build.125', '1.4']],
  [
    '>=0.3.1-beta.8.d.10',
    ['0.3.1-beta.9', '0.3.1-beta.11', '0.3.1-beta.8.e', '0.3.1-beta.8.d.10', '0.3.1-beta.9.d.5', '0.3.1-beta.final', '0.3.1-beta.-final-'],
    ['0.3.1-beta.7', '0.3.1-beta.8.d', '0.3.1-beta.8.a', '0.3.1-alpha.9', '0.3.1-beta.8.8']
  ],
  ['1.3.x', ['1.3.0', '1.3.0-alpha.1', '1.3.99'], ['1.4.0', '1.2.9', '1.2.9-rc.6', '1.4.0-alpha.1', '2.0.0']],
  ['2.x', ['2.0.0', '2.0.0-alpha.1', '2.9.0-beta.2', '2.2.4'], ['1.99.99', '3.0.0', '3.0.0-alpha.1']],
  ['~1.2.3', ['1.2.3', '1.2.4', '1.2.4-alpha.1'], ['1.2.2', '1.2.3-rc.7', '1.3.0', '2.2.0']],
  ['~1.2', ['1.2.0', '1.2.1-alpha.3', '1.2.6'], ['1.1.9', '1.3.0', '1.2.0-rc.2', '1.3.0-alpha.3']],
  ['~1.2-', ['1.2.0', '1.2.1-alpha.3', '1.2.6', '1.2.0-rc.2'], ['1.1.9', '1.3.0', '1.3.0-alpha.3']],
  ['~1', ['1.0.0', '1.0.4'], ['0.9.9', '1.1.5', '3.0.5']],
  [
    '~1.2.3-beta.2',
    ['1.2.3-beta.2', '1.2.3-beta.2.1', '1.2.3-beta.3', '1.2.3-beta.11', '1.2.3-rc.7', '1.2.3', '1.2.5', '1.2.4-alpha.4'],
    ['1.3.0', '1.2.2', '1.2.3-beta.1', '1.2.3-beta.1.9', '1.2.3-alpha.4']
  ],
  ['^1.2.3', ['1.2.3', '1.2.4', '1.3.0', '1.2.4-beta.2'], ['1.2.2', '1.2.3-beta.2', '2.0.0']],
  ['^0.2.3', ['0.2.3', '0.2.4', '0.2.8-beta.2', '0.3.0'], ['0.2.0', '0.2.3-rc.8', '1.2.0']],
  ['^1.2.3-beta.2', ['1.2.3-beta.2', '1.2.3-beta.3', '1.2.3-rc.7', '1.2.3', '1.2.5', '1.3.0', '1.2.4-alpha.4'], ['1.2.2', '2.0.0', '1.2.3-alpha.4']],
  ['^1', ['1.0.0', '1.2.4', '1.99.99', '1.2.4-beta.2'], ['0.9.6', '1.0.0-rc.5', '2.0.0', '2.0.0-beta.2']],
  ['^1-', ['1.0.0', '1.0.0-rc.5', '1.2.4', '1.99.99', '1.2.4-beta.2'], ['0.9.0', '0.9.0-rc.5', '2.0.0', '2.0.0-beta.2']],
  ['1.2.3.x', ['1.2.3', '1.2.3-', '1.2.3.4', '1.2.3.4.5'], ['1.2.2', '1.2.4', '1.2.4-', '1.2', '1.3', '1', '2']]
]

describe('SemanticVersion (Fabric VersionParsingTests)', () => {
  it('parses what Fabric parses and refuses what it refuses', () => {
    for (const ok of ['0.3.5', '0.3.5-beta.2', '0.3.5-alpha.6+build.120', '0.3.5+build.3000', '1.0.0-0.3.7', '1.0.0-x.7.z.92', '1.0.0+20130313144700', '1.0.0-beta+exp.sha.5114f85']) {
      expect(parses(ok, false), ok).toBe(true)
    }

    for (const bad of ['0.0.-1', `0.${2 ** 31}.0`, '0.-1.0', '-1.0.0', '', '0.0.a', '0.a.0', 'a.0.0', '2.x', '2.X', '2.*']) {
      expect(parses(bad, false), bad).toBe(false)
    }

    for (const ok of ['2.x', '2.x.x', '2.X', '2.*']) {
      expect(parses(ok, true), ok).toBe(true)
    }

    for (const bad of ['x', '2.x.1', '2.*.1', '2.x-alpha.1', '2.*-alpha.1', '*-alpha.1']) {
      expect(parses(bad, true), bad).toBe(false)
    }
  })

  it.each(FABRIC_PREDICATE_VECTORS)('%s', (predicate, yes, no) => {
    const parsed = parsePredicate(predicate)

    for (const version of yes) {
      expect(parsed.test(semver(version)), `${predicate} should match ${version}`).toBe(true)
    }

    for (const version of no) {
      expect(parsed.test(semver(version)), `${predicate} should not match ${version}`).toBe(false)
    }
  })
})

describe('Fabric behaviour checked against its own classes (FABRIC-13)', () => {
  it('matches Minecraft versions the way mods write them', () => {
    expect(matchesAny(['~1.21.10'], '1.21.11')).toBe(true)
    expect(matchesAny(['1.21'], '1.21.11')).toBe(false)
    expect(matchesAny(['1.21.x'], '1.21.11')).toBe(true)
    expect(matchesAny(['>=1.21.11- <1.21.12-'], '1.21.11')).toBe(true)
    expect(matchesAny(['>=1.21.11- <1.21.12-'], '1.21.12')).toBe(false)
    expect(matchesAny(['>=1.21.9 <1.22'], '1.21.11')).toBe(true)
    expect(matchesAny(['>=1.21.11-'], '1.21.11-rc1')).toBe(true)
    expect(matchesAny(['=1.21.11+foo'], '1.21.11')).toBe(true)
    expect(matchesAny(['1.21.11.x'], '1.21.11.3')).toBe(true)
  })

  it('accepts an empty pre-release and allows x only in predicates', () => {
    expect(parseVersion('1.21.11-')).toBeInstanceOf(SemanticVersion)
    expect(parseVersion('1.21.x')).toBeInstanceOf(StringVersion)
    expect(parseVersion('1.21.x', true)).toBeInstanceOf(SemanticVersion)
  })

  it('never matches a bare x', () => {
    expect(matchesAny(['x'], '1.0.0')).toBe(false)
    expect(matchesAny(['x'], 'x')).toBe(true)
  })

  it('compares non-semantic mod versions only as equal strings', () => {
    expect(parseVersion('mc1.21.11-0.21.4-fabric')).toBeInstanceOf(StringVersion)
    expect(matchesAny(['>=0.21'], 'mc1.21.11-0.21.4-fabric')).toBe(false)
    expect(matchesAny(['mc1.21.11-0.21.4-fabric'], 'mc1.21.11-0.21.4-fabric')).toBe(true)
    expect(matchesAny(['>=mc1.21.11-0.21.4-fabric'], 'mc1.21.11-0.21.4-fabric')).toBe(true)
  })

  it('throws where Fabric refuses to load the mod', () => {
    expect(() => parsePredicate('>= 1.21')).toThrow(/non-empty/)
    expect(() => parsePredicate('<abc')).toThrow(/Invalid predicate/)
    expect(() => parsePredicate('>abc')).toThrow(/Invalid predicate/)
    expect(() => parsePredicate('>=1.x')).toThrow(/wildcards/)
    expect(() => parsePredicate('<=abc')).not.toThrow()
  })

  it('matches everything with "*" or an empty predicate, and nothing with an empty list', () => {
    expect(matchesAny(['*'], 'anything')).toBe(true)
    expect(matchesAny([''], '1.0')).toBe(true)
    expect(matchesAny(['* '], '1.0')).toBe(true)
    expect(matchesAny([], '1.0')).toBe(false)
  })

  it('compares numeric pre-release parts by length first, and ignores build metadata', () => {
    expect(compareVersions(semver('1.0.0-beta.11'), semver('1.0.0-beta.9'))).toBe(1)
    expect(compareVersions(semver('1.0.0-alpha'), semver('1.0.0'))).toBe(-1)
    expect(compareVersions(semver('1.0.0+a'), semver('1.0.0+b'))).toBe(0)
    expect(compareVersions(semver('1.0'), semver('1.0.0'))).toBe(0)
    expect(compareVersions(semver('0.6.13'), semver('0.6.12'))).toBe(1)
    expect(compareVersions(new StringVersion('b'), semver('1.0'))).toBe(1)
  })
})

describe('describePredicates', () => {
  it('says what a requirement allows, in plain words', () => {
    expect(describePredicates(['1.21.11'])).toBe('1.21.11')
    expect(describePredicates(['>=0.6'])).toBe('0.6 or later')
    expect(describePredicates(['>0.6'])).toBe('newer than 0.6')
    expect(describePredicates(['<2.0'])).toBe('older than 2.0')
    expect(describePredicates(['<=2.0'])).toBe('2.0 or older')
    expect(describePredicates(['1.21.x'])).toBe('1.21.x')
    expect(describePredicates(['~1.21.10'])).toBe('1.21.10 or later, older than 1.22')
    expect(describePredicates(['~1.21-'])).toBe('1.21.x')
    expect(describePredicates(['^2-'])).toBe('2.x')
    expect(describePredicates(['>=1.21.11- <1.21.12-'])).toBe('1.21.11')
    expect(describePredicates(['>=1.20 <=1.21.4'])).toBe('between 1.20 and 1.21.4')
    expect(describePredicates(['>=1.21.9 <1.22'])).toBe('1.21.9 or later, older than 1.22')
    expect(describePredicates(['mc1.21-1.0'])).toBe('mc1.21-1.0')
  })

  it('gives up on several ranges, impossible ranges, "any" and broken predicates', () => {
    expect(describePredicates(['1.20.1', '1.21.1'])).toBeNull()
    expect(describePredicates(['>2 <1'])).toBeNull()
    expect(describePredicates(['*'])).toBeNull()
    expect(describePredicates(['<abc'])).toBeNull()
    expect(describePredicates([])).toBeNull()
    expect(describePredicates(['1.21.x', '~1.21-'])).toBe('1.21.x')
  })
})
