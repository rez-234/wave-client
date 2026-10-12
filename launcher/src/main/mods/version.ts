/**
 * Fabric Loader's version rules, ported from net.fabricmc.loader.impl.util.version
 * (SemanticVersionImpl, StringVersion, VersionParser, VersionPredicateParser, VersionIntervalImpl)
 * and api.metadata.version.VersionComparisonOperator, so a mod's requirements are judged exactly
 * as the game will judge them. Wording for players follows ResultAnalyzer's version messages.
 */

export class VersionParsingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VersionParsingError'
  }
}

/** The x in "1.21.x": Fabric uses Integer.MIN_VALUE. */
const WILDCARD = -2147483648
const INT_MAX = 2147483647
const DOT_SEPARATED_ID = /^(|[-0-9A-Za-z]+(\.[-0-9A-Za-z]+)*)$/
const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/

export class SemanticVersion {
  readonly components: readonly number[]
  readonly prerelease: string | null
  readonly build: string | null
  readonly friendly: string

  /** `fromText`: SemanticVersionImpl(String) keeps a leading x ("x.x"); building one from numbers refuses it. */
  constructor(components: readonly number[], prerelease: string | null, build: string | null, fromText = false) {
    if (components.length === 0 || (components[0] === WILDCARD && !fromText)) {
      throw new VersionParsingError(`Invalid components: ${components.join('.')}`)
    }

    this.components = components
    this.prerelease = prerelease
    this.build = build
    this.friendly =
      components.map((c) => (c === WILDCARD ? 'x' : String(c))).join('.') + (prerelease !== null ? `-${prerelease}` : '') + (build !== null ? `+${build}` : '')
  }

  /** SemanticVersionImpl(String, boolean storeX). */
  static parse(text: string, storeX: boolean): SemanticVersion {
    let version = text
    let build: string | null = null
    let prerelease: string | null = null
    const plus = version.indexOf('+')

    if (plus >= 0) {
      build = version.slice(plus + 1)
      version = version.slice(0, plus)
    }

    const dash = version.indexOf('-')

    if (dash >= 0) {
      prerelease = version.slice(dash + 1)
      version = version.slice(0, dash)
    }

    if (prerelease !== null && !DOT_SEPARATED_ID.test(prerelease)) {
      throw new VersionParsingError(`Invalid prerelease string '${prerelease}'!`)
    }

    if (version.endsWith('.')) {
      throw new VersionParsingError('Negative version number component found!')
    } else if (version.startsWith('.')) {
      throw new VersionParsingError('Missing version component!')
    }

    const parts = version.split('.')
    let components: number[] = []
    let firstWildcard = -1

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!

      if (storeX) {
        if (part === 'x' || part === 'X' || part === '*') {
          if (prerelease !== null) {
            throw new VersionParsingError('Pre-release versions are not allowed to use X-ranges!')
          }

          components.push(WILDCARD)
          if (firstWildcard < 0) firstWildcard = i
          continue
        } else if (i > 0 && components[i - 1] === WILDCARD) {
          throw new VersionParsingError('Interjacent wildcard (1.x.2) are disallowed!')
        }
      }

      if (javaTrim(part).length === 0) {
        throw new VersionParsingError('Missing version number component!')
      }

      // Integer.parseInt: optional sign, decimal digits, int range. A '-' or '+' can't reach here.
      if (!/^[0-9]+$/.test(part) || Number(part) > INT_MAX) {
        throw new VersionParsingError(`Could not parse version number component '${part}'!`)
      }

      components.push(Number(part))
    }

    if (storeX && components.length === 1 && components[0] === WILDCARD) {
      throw new VersionParsingError("Versions of form 'x' or 'X' not allowed!")
    }

    // 1.x.x -> 1.x
    if (firstWildcard > 0 && components.length > firstWildcard + 1) {
      components = components.slice(0, firstWildcard + 1)
    }

    // "x.x" parses; a predicate built from it then fails (in Fabric, an exception that fails the jar).
    return new SemanticVersion(components, prerelease, build, true)
  }

  /** Past the end: x repeats after an x, otherwise 0. */
  component(pos: number): number {
    if (pos >= this.components.length) {
      return this.components[this.components.length - 1] === WILDCARD ? WILDCARD : 0
    }

    return this.components[pos]!
  }

  get hasWildcard(): boolean {
    return this.components.some((c) => c < 0)
  }

  equals(other: Version): boolean {
    if (!(other instanceof SemanticVersion)) {
      return false
    }

    for (let i = 0; i < Math.max(this.components.length, other.components.length); i++) {
      if (this.component(i) !== other.component(i)) return false
    }

    return this.prerelease === other.prerelease && this.build === other.build
  }

  compareTo(other: Version): number {
    if (!(other instanceof SemanticVersion)) {
      return compareStrings(this.friendly, other.friendly)
    }

    for (let i = 0; i < Math.max(this.components.length, other.components.length); i++) {
      const first = this.component(i)
      const second = other.component(i)

      if (first === WILDCARD || second === WILDCARD) {
        continue
      }

      if (first !== second) return first < second ? -1 : 1
    }

    const a = this.prerelease
    const b = other.prerelease

    if (a === null && b === null) {
      return 0
    } else if (a !== null && b !== null) {
      // StringTokenizer skips empty tokens.
      const partsA = a.split('.').filter((p) => p.length > 0)
      const partsB = b.split('.').filter((p) => p.length > 0)

      for (let i = 0; i < partsA.length; i++) {
        if (i >= partsB.length) return 1

        const partA = partsA[i]!
        const partB = partsB[i]!

        if (UNSIGNED_INTEGER.test(partA)) {
          if (UNSIGNED_INTEGER.test(partB)) {
            if (partA.length !== partB.length) return partA.length < partB.length ? -1 : 1
          } else {
            return -1
          }
        } else if (UNSIGNED_INTEGER.test(partB)) {
          return 1
        }

        const compare = compareStrings(partA, partB)
        if (compare !== 0) return compare
      }

      return partsB.length > partsA.length ? -1 : 0
    } else if (a !== null) {
      return other.hasWildcard ? 0 : -1
    } else {
      return this.hasWildcard ? 0 : 1
    }
  }

  toString(): string {
    return this.friendly
  }
}

/** A version that isn't semantic: it only ever equals the same string. */
export class StringVersion {
  constructor(readonly friendly: string) {}

  equals(other: Version): boolean {
    return other instanceof StringVersion && other.friendly === this.friendly
  }

  compareTo(other: Version): number {
    return compareStrings(this.friendly, other.friendly)
  }

  toString(): string {
    return this.friendly
  }
}

export type Version = SemanticVersion | StringVersion

/** VersionParser.parse: semantic if possible, else a plain string. Mod versions use storeX = false. */
export function parseVersion(text: string, storeX = false): Version {
  if (text.length === 0) {
    throw new VersionParsingError('Version must be a non-empty string!')
  }

  try {
    return SemanticVersion.parse(text, storeX)
  } catch (error) {
    if (error instanceof VersionParsingError) {
      return new StringVersion(text)
    }

    throw error
  }
}

/** Version.compareTo (used to pick the newest of several copies of a mod). */
export function compareVersions(a: Version, b: Version): number {
  return a.compareTo(b)
}

interface Operator {
  serialized: string
  minInclusive: boolean
  maxInclusive: boolean
  test(a: SemanticVersion, b: SemanticVersion): boolean
  min(v: SemanticVersion): SemanticVersion | null
  max(v: SemanticVersion): SemanticVersion | null
}

const same = (v: SemanticVersion): SemanticVersion => v
const none = (): null => null

const GREATER_EQUAL: Operator = { serialized: '>=', minInclusive: true, maxInclusive: false, test: (a, b) => a.compareTo(b) >= 0, min: same, max: none }
const LESS_EQUAL: Operator = { serialized: '<=', minInclusive: false, maxInclusive: true, test: (a, b) => a.compareTo(b) <= 0, min: none, max: same }
const GREATER: Operator = { serialized: '>', minInclusive: false, maxInclusive: false, test: (a, b) => a.compareTo(b) > 0, min: same, max: none }
const LESS: Operator = { serialized: '<', minInclusive: false, maxInclusive: false, test: (a, b) => a.compareTo(b) < 0, min: none, max: same }
const EQUAL: Operator = { serialized: '=', minInclusive: true, maxInclusive: true, test: (a, b) => a.compareTo(b) === 0, min: same, max: same }
const SAME_TO_NEXT_MINOR: Operator = {
  serialized: '~',
  minInclusive: true,
  maxInclusive: false,
  test: (a, b) => a.compareTo(b) >= 0 && a.component(0) === b.component(0) && a.component(1) === b.component(1),
  min: same,
  max: (v) => new SemanticVersion([v.component(0), v.component(1) + 1], '', null)
}
const SAME_TO_NEXT_MAJOR: Operator = {
  serialized: '^',
  minInclusive: true,
  maxInclusive: false,
  test: (a, b) => a.compareTo(b) >= 0 && a.component(0) === b.component(0),
  min: same,
  max: (v) => new SemanticVersion([v.component(0) + 1], '', null)
}

/** In this order, so '>=' is tried before '>'. */
const OPERATORS = [GREATER_EQUAL, LESS_EQUAL, GREATER, LESS, EQUAL, SAME_TO_NEXT_MINOR, SAME_TO_NEXT_MAJOR]

function testOperator(operator: Operator, a: Version, b: Version): boolean {
  if (a instanceof SemanticVersion && b instanceof SemanticVersion) {
    return operator.test(a, b)
  } else if (operator.minInclusive || operator.maxInclusive) {
    return a.friendly === b.friendly
  }

  return false
}

/** [min, max] with open or closed ends; null bounds are infinite. */
export interface VersionInterval {
  min: Version | null
  minInclusive: boolean
  max: Version | null
  maxInclusive: boolean
}

const INFINITE: VersionInterval = { min: null, minInclusive: false, max: null, maxInclusive: false }

function interval(min: Version | null, minInclusive: boolean, max: Version | null, maxInclusive: boolean): VersionInterval {
  return { min, minInclusive: min !== null && minInclusive, max, maxInclusive: max !== null && maxInclusive }
}

interface Term {
  operator: Operator
  version: Version
}

/** A parsed predicate: all terms must match (space-separated terms are an AND). */
export class VersionPredicate {
  constructor(
    readonly raw: string,
    private readonly terms: readonly Term[]
  ) {}

  test(version: Version): boolean {
    return this.terms.every((term) => testOperator(term.operator, version, term.version))
  }

  /** The versions it matches as one interval, or null when none match. */
  interval(): VersionInterval | null {
    let result: VersionInterval | null = INFINITE

    for (const term of this.terms) {
      const own: VersionInterval =
        term.version instanceof SemanticVersion
          ? interval(term.operator.min(term.version), term.operator.minInclusive, term.operator.max(term.version), term.operator.maxInclusive)
          : interval(term.version, true, term.version, true)
      result = result === INFINITE ? own : andIntervals(result, own)

      if (!result) return null
    }

    return result
  }
}

/** VersionPredicateParser.parse: throws VersionParsingError where Fabric fails to load the mod. */
export function parsePredicate(predicate: string): VersionPredicate {
  if (predicate.length === 0 || predicate === '*') {
    return new VersionPredicate(predicate, [])
  }

  const terms: Term[] = []

  for (let part of predicate.split(' ')) {
    part = javaTrim(part)

    if (part.length === 0 || part === '*') {
      continue
    }

    let operator = EQUAL

    for (const op of OPERATORS) {
      if (part.startsWith(op.serialized)) {
        operator = op
        part = part.slice(op.serialized.length)
        break
      }
    }

    let version = parseVersion(part, true)

    if (version instanceof SemanticVersion) {
      if (version.hasWildcard) {
        // a.x -> ^a-, a.b.x -> ~a.b-, a.b.c.x -> >=a.b.c- <a.b.(c+1)-
        if (operator !== EQUAL) {
          throw new VersionParsingError(`Invalid predicate: ${predicate}, version ranges with wildcards (.X) require using the equality operator or no operator at all!`)
        }

        const count = version.components.length
        let components = version.components.slice(0, count - 1)
        version = new SemanticVersion(components, '', version.build)

        if (count <= 3) {
          operator = count === 2 ? SAME_TO_NEXT_MAJOR : SAME_TO_NEXT_MINOR
        } else {
          terms.push({ operator: GREATER_EQUAL, version })
          components = [...components]
          components[components.length - 1]!++
          version = new SemanticVersion(components, '', null)
          operator = LESS
        }
      }
    } else if (!operator.minInclusive && !operator.maxInclusive) {
      throw new VersionParsingError(`Invalid predicate: ${predicate}, version ranges need to be semantic version compatible to use operators that exclude the bound!`)
    } else {
      operator = EQUAL
    }

    terms.push({ operator, version })
  }

  return new VersionPredicate(predicate, terms)
}

/** Whether a version (as written in a fabric.mod.json) matches any of the predicates; none never matches. */
export function matchesAny(predicates: readonly (string | VersionPredicate)[], version: string | Version): boolean {
  const parsed = typeof version === 'string' ? parseVersion(version) : version
  return predicates.some((p) => (typeof p === 'string' ? parsePredicate(p) : p).test(parsed))
}

/**
 * The versions a requirement allows, in words for players: "1.21.11", "0.6 or later", "1.21.x",
 * "older than 2.0", "between 1.20 and 1.21.4". Null when it can't be said simply (several ranges,
 * nothing matches, or any version), so the caller words it generally and shows the raw text.
 */
export function describePredicates(predicates: readonly string[]): string | null {
  const intervals: VersionInterval[] = []

  for (const raw of predicates) {
    let found: VersionInterval | null

    try {
      found = parsePredicate(raw).interval()
    } catch {
      return null
    }

    if (found && !intervals.some((i) => sameInterval(i, found!))) {
      intervals.push(found)
    }
  }

  return intervals.length === 1 ? describeInterval(intervals[0]!) : null
}

export function describeInterval(range: VersionInterval): string | null {
  const { min, max } = range

  if (!min) {
    if (!max) return null
    return range.maxInclusive ? `${show(max)} or older` : `older than ${show(max)}`
  }

  if (!max) {
    return range.minInclusive ? `${show(min)} or later` : `newer than ${show(min)}`
  }

  if (min.equals(max)) {
    return range.minInclusive && range.maxInclusive ? show(min) : null
  }

  if (min instanceof SemanticVersion && max instanceof SemanticVersion) {
    // [a.b-, a.(b+1)-) is "a.b.x"; [a.b.c-, a.b.(c+1)-) is just "a.b.c" (and its pre-releases).
    for (let k = 0; k < Math.max(min.components.length, max.components.length); k++) {
      if (isWildcard(range, min, max, k)) {
        return k < 2 ? [...min.components.slice(0, k + 1), 'x'].join('.') : min.components.slice(0, k + 1).join('.')
      }
    }
  }

  if (range.minInclusive && range.maxInclusive) return `between ${show(min)} and ${show(max)}`
  if (range.minInclusive) return `${show(min)} or later, older than ${show(max)}`
  if (range.maxInclusive) return `newer than ${show(min)}, up to ${show(max)}`
  return `newer than ${show(min)}, older than ${show(max)}`
}

/** ResultAnalyzer.isWildcard, for any component. */
function isWildcard(range: VersionInterval, min: SemanticVersion, max: SemanticVersion, k: number): boolean {
  if (!range.minInclusive || range.maxInclusive || min.prerelease !== '' || max.prerelease !== '') {
    return false
  }

  for (let i = 0; i < k; i++) {
    if (min.component(i) !== max.component(i)) return false
  }

  if (max.component(k) !== min.component(k) + 1) {
    return false
  }

  for (let i = k + 1; i < Math.max(min.components.length, max.components.length); i++) {
    if (min.component(i) !== 0 || max.component(i) !== 0) return false
  }

  return true
}

/** A version for players: without the empty pre-release marker ("1.22-" is how ranges say "1.22 and its pre-releases"). */
function show(version: Version): string {
  if (version instanceof SemanticVersion && version.prerelease === '') {
    return version.components.join('.') + (version.build !== null ? `+${version.build}` : '')
  }

  return version.friendly
}

function sameInterval(a: VersionInterval, b: VersionInterval): boolean {
  const eq = (x: Version | null, y: Version | null): boolean => (x === null ? y === null : y !== null && x.equals(y))
  return eq(a.min, b.min) && a.minInclusive === b.minInclusive && eq(a.max, b.max) && a.maxInclusive === b.maxInclusive
}

/** VersionIntervalImpl.and. */
export function andIntervals(a: VersionInterval, b: VersionInterval): VersionInterval | null {
  const semantic = (i: VersionInterval): boolean => (i.min === null || i.min instanceof SemanticVersion) && (i.max === null || i.max instanceof SemanticVersion)
  return semantic(a) && semantic(b) ? andSemantic(a, b) : andPlain(a, b)
}

function andPlain(a: VersionInterval, b: VersionInterval): VersionInterval | null {
  const { min: aMin, max: aMax } = a
  const { min: bMin, max: bMax } = b

  if (aMin) {
    if ((bMin && !aMin.equals(bMin)) || (bMax && !aMin.equals(bMax))) {
      return null
    }

    return aMax || !bMax ? a : interval(aMin, true, bMax, b.maxInclusive)
  } else if (aMax) {
    if ((bMin && !aMax.equals(bMin)) || (bMax && !aMax.equals(bMax))) {
      return null
    }

    if (!bMin) return a
    if (bMax) return b
    return interval(bMin, true, aMax, true)
  }

  return b
}

function andSemantic(a: VersionInterval, b: VersionInterval): VersionInterval | null {
  const minCmp = compareMin(a, b)
  const maxCmp = compareMax(a, b)

  if (minCmp === 0) {
    return maxCmp <= 0 ? a : b
  } else if (maxCmp === 0) {
    return minCmp < 0 ? b : a
  } else if (minCmp < 0) {
    if (maxCmp > 0) return b
    const cmp = b.min!.compareTo(a.max!)
    return cmp < 0 || (cmp === 0 && b.minInclusive && a.maxInclusive) ? interval(b.min, b.minInclusive, a.max, a.maxInclusive) : null
  } else {
    if (maxCmp < 0) return a
    const cmp = a.min!.compareTo(b.max!)
    return cmp < 0 || (cmp === 0 && a.minInclusive && b.maxInclusive) ? interval(a.min, a.minInclusive, b.max, b.maxInclusive) : null
  }
}

function compareMin(a: VersionInterval, b: VersionInterval): number {
  if (!a.min) return b.min ? -1 : 0
  if (!b.min) return 1
  const cmp = a.min.compareTo(b.min)
  if (cmp > 0 || (cmp === 0 && !a.minInclusive && b.minInclusive)) return 1
  if (cmp < 0 || (a.minInclusive && !b.minInclusive)) return -1
  return 0
}

function compareMax(a: VersionInterval, b: VersionInterval): number {
  if (!a.max) return b.max ? 1 : 0
  if (!b.max) return -1
  const cmp = a.max.compareTo(b.max)
  if (cmp < 0 || (cmp === 0 && !a.maxInclusive && b.maxInclusive)) return -1
  if (cmp > 0 || (a.maxInclusive && !b.maxInclusive)) return 1
  return 0
}

/** String.compareTo: UTF-16 code unit order, as JavaScript's < does. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** String.trim: strips chars <= U+0020 only. */
function javaTrim(s: string): string {
  let start = 0
  let end = s.length

  while (start < end && s.charCodeAt(start) <= 0x20) start++
  while (end > start && s.charCodeAt(end - 1) <= 0x20) end--

  return s.slice(start, end)
}
