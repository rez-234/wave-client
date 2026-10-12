import type { ModFix, ModProblem } from '@shared/ipc'

import { type DependencyOverrides, applyDependencyOverrides, parseDependencyOverrides, parseDependencyOverridesText } from './overrides'
import type { AnalysisInput, IncludedSpec, ModAnalysis, ModDependency, ModJarInfo, ModMetadata, ModResult, ScannedMod } from './types'
import { type Version, compareVersions, describePredicates, matchesAny, parsePredicate, parseVersion } from './version'

/**
 * Which of a profile's mods Fabric Loader will load and what will stop it, worked out before the
 * game starts. The rule throughout: an error (which stops the launch) only for what Fabric itself
 * treats as fatal; anything Fabric tolerates is at most a warning, and when unsure, a warning.
 *
 * Fabric's model, simplified to what can be decided without its solver: the built-in mods
 * (minecraft, java) and the mods the launcher always adds (Fabric Loader with its nested
 * MixinExtras, Fabric API with its modules, Wave Client) are present; of several top-level copies
 * of one id only one loads; nested mods load if their parent does and their
 * own Minecraft, Java and loader requirements hold; a dependency is met by any loaded mod with
 * that id or "provides" whose version matches. Of several copies, the one chosen is the one that
 * leaves the fewest problems (Fabric's solver looks for a set of mods that works), newest first.
 */

/** Ids Fabric itself provides: a mod claiming one stops the launch. */
const BUILT_IN = new Set(['minecraft', 'java'])
/** Ids whose versions are fixed by the profile (built-ins and the loader). */
const FIXED = new Set(['minecraft', 'java', 'fabricloader'])
/** Copying a jar into the folder takes a moment; a read failure that recent is probably that. */
const COPYING_MS = 2000
/** Rounds of re-choosing copies; a profile needing more is reported with warnings only. */
const CHOOSE_ROUNDS = 8
/** Own problems a copy nested in another mod can stand in for (not 'built-in': a product rule). */
const REPLACEABLE = new Set<ModProblem['code']>(['minecraft', 'java', 'loader', 'breaks'])

type Kind = 'depends' | 'recommends' | 'suggests' | 'conflicts' | 'breaks'

/** A top-level mod that may load: a turned-on jar, or one of the mods the launcher adds. */
interface Copy {
  /** The scanned jar; undefined for an included mod. */
  jar?: ScannedMod
  included?: IncludedSpec
  metadata: ModMetadata | null
  nested: ModJarInfo[]
  ids: string[]
  version: Version
  versionText: string
  name: string
  problems: ModProblem[]
  /** Has a problem of its own that Fabric would stop on (so another copy loads instead, if any). */
  fatal: boolean
  loads: boolean
}

/** Something that can meet a dependency. */
interface Candidate {
  version: Version
  versionText: string
  name: string
  /** A top-level mod (or a built-in), as opposed to one nested in a jar. */
  topLevel: boolean
  copy: Copy | null
  /** For a nested mod: the file it is inside, or 'Wave Client' for the included mods' own. */
  parent?: string
}

export function analyzeMods(input: AnalysisInput): ModAnalysis {
  const results = new Map<string, ModResult>()
  const profileProblems: ModProblem[] = []
  const overrides = readOverrides(input, profileProblems)
  const fixedVersions = new Map<string, string>([
    ['minecraft', input.minecraft],
    ['java', String(input.javaMajor)]
  ])
  const loader = input.included.find((mod) => mod.id === 'fabricloader')
  const fabricApi = input.included.find((mod) => mod.id === 'fabric-api')

  if (loader) {
    fixedVersions.set('fabricloader', loader.version)
  }

  const context: Context = { input, fixedVersions, loaderVersion: loader?.version ?? null, fabricApi }
  const copies: Copy[] = []
  const disabled: Array<{ mod: ScannedMod; metadata: ModMetadata }> = []
  const serverOnly: ModMetadata[] = []
  let uncertain = false

  for (const mod of input.mods) {
    const result: ModResult = { loads: false, problems: [], neededBy: [] }
    results.set(mod.key, result)

    if (mod.state === 'case') {
      result.problems.push(warning('case', "Won't load: the file name has to end in .jar (lower case)."))
      continue
    }

    if (!mod.read.ok) {
      if (mod.state === 'off') continue

      if (input.now - mod.mtimeMs < COPYING_MS) {
        result.problems.push(warning('copying', "Couldn't read this file yet. Is it still being copied?", mod.read.message))
        uncertain = true
      } else if (mod.read.kind === 'unchecked') {
        result.problems.push(warning('unchecked', "Couldn't check this file. It may still work.", mod.read.message))
        result.loads = true
        uncertain = true
      } else {
        result.problems.push(error('unreadable', "This file is damaged or isn't a working mod. Remove it or download it again.", mod.read.message, removeFix(mod.key, 'Remove it')))
      }

      continue
    }

    const metadata = mod.read.info.metadata ? applyDependencyOverrides(overrides, mod.read.info.metadata) : null

    if (!metadata) {
      if (mod.state === 'on') {
        result.problems.push(warning('not-fabric', notFabricMessage(mod.read.info.nonFabric)))
      }

      continue
    }

    if (mod.state === 'off') {
      disabled.push({ mod, metadata })
      continue
    }

    if (metadata.environment === 'server') {
      result.problems.push(warning('server-only', "Won't load: this mod is only for servers."))
      serverOnly.push(metadata)
      continue
    }

    const copy = jarCopy(mod, metadata, mod.read.info.nested)
    ownProblems(copy, context, overrides)
    copies.push(copy)
  }

  const includedCopies = input.included.map(includedCopy)
  const all = [...includedCopies, ...copies]
  const groups = groupCopies(all)
  const discovered = discoveredIds(all, context, overrides, serverOnly)
  const env: DependencyEnv = { context, overrides, disabled, serverOnly, discovered, uncertain, alternatives: new Map() }
  const winners = chooseWinners(groups, all, env)

  if (!winners.settled) {
    env.uncertain = true
  }

  replaceByNested(copies, all, context, overrides)

  for (const group of groups) {
    reportUnused(group, winners.byGroup.get(group)!, context)
  }

  const candidates = indexCandidates(all.filter((copy) => copy.loads), context, overrides)
  env.alternatives = indexAlternatives(groups)

  for (const copy of copies) {
    if (copy.loads) {
      copy.problems.push(...dependencyProblems(copy, candidates, env))
    }
  }

  // Who needs each mod (for "turn it off anyway?"): loaded mods whose hard dependency it meets.
  const loaded = copies.filter((copy) => copy.loads && copy.metadata)

  for (const mod of input.mods) {
    const metadata = mod.read.ok ? mod.read.info.metadata : null

    if (!metadata) continue

    const ids = new Set([metadata.id, ...metadata.provides])
    const version = parseVersion(metadata.version)
    const needers = loaded
      .filter((copy) => copy.jar !== mod && copy.metadata!.depends.some((dep) => ids.has(dep.id) && !FIXED.has(dep.id) && matchesAny(dep.predicates, version)))
      .map((copy) => copy.name)
    results.get(mod.key)!.neededBy = [...new Set(needers)].sort((a, b) => a.localeCompare(b))
  }

  for (const copy of copies) {
    const result = results.get(copy.jar!.key)!
    result.loads = copy.loads
    result.problems.push(...copy.problems)
  }

  if (input.customFabricOptions) {
    for (const result of results.values()) {
      result.problems = result.problems.map((problem) => (problem.severity === 'error' ? { ...problem, severity: 'warning' } : problem))
    }

    profileProblems.push(warning('custom-fabric-options', 'Custom Fabric options in Java arguments: the mod check may be wrong.'))
  }

  let errors = 0
  let warnings = 0

  for (const problem of [...profileProblems, ...[...results.values()].flatMap((result) => result.problems)]) {
    if (problem.severity === 'error') errors++
    else warnings++
  }

  return { mods: results, profileProblems, errors, warnings }
}

interface Context {
  input: AnalysisInput
  fixedVersions: Map<string, string>
  loaderVersion: string | null
  fabricApi: IncludedSpec | undefined
}

function readOverrides(input: AnalysisInput, profileProblems: ModProblem[]): DependencyOverrides | null {
  if (!input.overrides) {
    return null
  }

  const message = "This profile's config/fabric_loader_dependencies.json can't be read, and the game won't start with it. Fix or remove the file."

  if (!input.overrides.ok) {
    profileProblems.push(error('overrides', message, input.overrides.message))
    return null
  }

  try {
    return 'text' in input.overrides ? parseDependencyOverridesText(input.overrides.text) : parseDependencyOverrides(input.overrides.value)
  } catch (e) {
    profileProblems.push(error('overrides', message, e instanceof Error ? e.message : String(e)))
    return null
  }
}

function jarCopy(jar: ScannedMod, metadata: ModMetadata, nested: ModJarInfo[]): Copy {
  return {
    jar,
    metadata,
    nested,
    ids: [metadata.id, ...metadata.provides],
    version: parseVersion(metadata.version),
    versionText: metadata.version,
    name: metadata.name ?? metadata.id,
    problems: [],
    fatal: false,
    loads: true
  }
}

function includedCopy(included: IncludedSpec): Copy {
  return {
    included,
    metadata: null,
    nested: [],
    ids: [included.id, ...included.provides],
    version: parseVersion(included.version),
    versionText: included.version,
    name: included.name,
    problems: [],
    fatal: false,
    loads: true
  }
}

/**
 * What is wrong with a jar whatever else is installed: it claims to be part of the game or the
 * launcher, or its Minecraft, Java or Fabric Loader requirement fails.
 */
function ownProblems(copy: Copy, context: Context, overrides: DependencyOverrides | null): void {
  const metadata = copy.metadata!
  const key = copy.jar!.key
  const claimed = copy.ids.find((id) => BUILT_IN.has(id)) ?? nestedBuiltIn(copy.nested, overrides)

  if (claimed) {
    copy.problems.push(error('built-in', "This file claims to be part of Minecraft or Java itself, and the game won't start with it. Remove it.", `Provides ${claimed}`, removeFix(key, 'Remove it')))
  } else if (copy.ids.includes('fabricloader')) {
    copy.problems.push(error('built-in', 'Remove this file: Wave Client already includes Fabric Loader.', undefined, removeFix(key, 'Remove it')))
  } else if (copy.ids.includes('waveclient')) {
    copy.problems.push(error('built-in', 'Remove this file: Wave Client is already included.', undefined, removeFix(key, 'Remove it')))
  }

  for (const dep of metadata.depends) {
    const version = context.fixedVersions.get(dep.id)

    if (version !== undefined && !matchesAny(dep.predicates, version)) {
      copy.problems.push(fixedRequirementProblem(dep, context))
    }
  }

  for (const dep of metadata.breaks) {
    const version = context.fixedVersions.get(dep.id)

    if (version !== undefined && matchesAny(dep.predicates, version)) {
      copy.problems.push(error('breaks', `Doesn't work with ${fixedName(dep.id)} ${version}.`, requirement('breaks', dep), disableFix(key, copy.name)))
    }
  }

  copy.fatal = copy.problems.some((problem) => problem.severity === 'error')
}

/** A nested mod anywhere in the jar using a built-in id fails the launch too. */
function nestedBuiltIn(nested: ModJarInfo[], overrides: DependencyOverrides | null): string | undefined {
  for (const child of nested) {
    const metadata = child.metadata

    if (!metadata) continue

    const found = [metadata.id, ...metadata.provides].find((id) => BUILT_IN.has(id)) ?? nestedBuiltIn(child.nested, overrides)

    if (found) return found
  }

  return undefined
}

function fixedRequirementProblem(dep: ModDependency, context: Context): ModProblem {
  const detail = requirement('depends', dep)
  const wanted = describePredicates(dep.predicates)
  const minecraft = context.input.minecraft

  if (dep.id === 'minecraft') {
    return error(
      'minecraft',
      wanted ? `Made for Minecraft ${wanted}. Get the version of this mod for ${minecraft}.` : `Made for a different Minecraft version. Get the version of this mod for ${minecraft}.`,
      detail
    )
  }

  if (dep.id === 'java') {
    return error('java', wanted ? `Needs Java ${wanted}. Choose a newer Java in Settings.` : 'Needs a different Java version. Choose another Java in Settings.', detail)
  }

  const loader = context.loaderVersion ?? '?'
  const newer = dep.predicates.length > 0 && dep.predicates.every((p) => needsNewer(p, loader))
  return error(
    'loader',
    newer
      ? `Needs a newer Fabric Loader than Wave Client uses (${loader}). Use an older version of this mod.`
      : `Needs a different Fabric Loader than Wave Client uses (${loader}). Use another version of this mod.`,
    detail
  )
}

/** Every version the predicate allows is newer than `version`. */
function needsNewer(predicate: string, version: string): boolean {
  try {
    const range = parsePredicate(predicate).interval()

    if (!range?.min) return false

    const cmp = range.min.compareTo(parseVersion(version))
    return cmp > 0 || (cmp === 0 && !range.minInclusive)
  } catch {
    return false
  }
}

/** Copies that share an id or a "provides" (Fabric loads at most one mod per id). */
function groupCopies(copies: Copy[]): Copy[][] {
  const parent = copies.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const owner = new Map<string, number>()

  copies.forEach((copy, i) => {
    for (const id of copy.ids) {
      const other = owner.get(id)

      if (other === undefined) owner.set(id, i)
      else parent[find(i)] = find(other)
    }
  })

  const groups = new Map<number, Copy[]>()
  copies.forEach((copy, i) => {
    const root = find(i)
    groups.set(root, [...(groups.get(root) ?? []), copy])
  })
  return [...groups.values()].filter((group) => group.length > 1)
}

/** Newest first; an included mod wins a tie, then the first file name. */
function preferred(a: Copy, b: Copy): number {
  return compareVersions(b.version, a.version) || (a.included ? -1 : 0) - (b.included ? -1 : 0) || (a.jar?.file ?? '').localeCompare(b.jar?.file ?? '')
}

/**
 * Which copy of each group loads. Only copies without a fatal problem of their own can (when none
 * can, the preferred one stands for the group and each keeps its errors). Of those, the one that
 * leaves the fewest dependency errors across all loaded mods, newest first: Fabric's solver looks
 * for a set of mods that works, so a copy another mod needs, or one that doesn't break another
 * mod, loads even when it isn't the newest. Groups are re-chosen until nothing changes.
 */
function chooseWinners(groups: Copy[][], all: Copy[], env: DependencyEnv): { byGroup: Map<Copy[], Copy>; settled: boolean } {
  const byGroup = new Map<Copy[], Copy>()
  const pools = new Map<Copy[], Copy[]>()

  for (const group of groups) {
    const usable = group.filter((copy) => !copy.fatal)
    const pool = [...(usable.length > 0 ? usable : group)].sort(preferred)
    pools.set(group, usable.length > 0 ? pool : [pool[0]!])
    setWinner(group, pool[0]!)
    byGroup.set(group, pool[0]!)
  }

  for (let round = 0; round < CHOOSE_ROUNDS; round++) {
    let changed = false

    for (const group of groups) {
      const pool = pools.get(group)!

      if (pool.length < 2) continue

      let best = byGroup.get(group)!
      let fewest = Infinity

      for (const copy of pool) {
        setWinner(group, copy)
        const errors = dependencyErrors(all, env)

        if (errors < fewest) {
          fewest = errors
          best = copy
        }
      }

      setWinner(group, best)

      if (best !== byGroup.get(group)) {
        byGroup.set(group, best)
        changed = true
      }
    }

    if (!changed) {
      return { byGroup, settled: true }
    }
  }

  return { byGroup, settled: false }
}

function setWinner(group: Copy[], winner: Copy): void {
  for (const copy of group) {
    copy.loads = copy === winner
  }
}

/** Dependency errors of every loaded jar, with the copies chosen so far. */
function dependencyErrors(all: Copy[], env: DependencyEnv): number {
  const loading = all.filter((copy) => copy.loads)
  const candidates = indexCandidates(loading, env.context, env.overrides)
  let errors = 0

  for (const copy of loading) {
    if (copy.jar) {
      errors += dependencyProblems(copy, candidates, env).filter((problem) => problem.severity === 'error').length
    }
  }

  return errors
}

/**
 * The copies that don't load: a warning naming the one that does, and their own problems no
 * longer matter. When no copy could load, each keeps its own problems (the launch fails anyway).
 */
function reportUnused(group: Copy[], winner: Copy, context: Context): void {
  const usable = group.some((copy) => !copy.fatal)

  for (const copy of group) {
    if (copy === winner) continue

    copy.loads = false

    // A copy of something the launcher provides is an error of its own (product rule): keep it.
    if (!copy.jar || copy.problems.some((problem) => problem.code === 'built-in') || !usable) {
      continue
    }

    copy.problems = [
      winner.included?.id === 'fabric-api'
        ? warning('fabric-api-copy', `Not needed: Wave Client already includes Fabric API ${winner.versionText}.`, undefined, removeFix(copy.jar.key, 'Remove this copy'))
        : warning(
            'duplicate',
            `Not used: ${winner.name} ${winner.versionText} (${winner.jar?.file ?? 'included with Wave Client'}) loads instead.`,
            undefined,
            removeFix(copy.jar.key, 'Remove this copy')
          )
    ]
  }

  const replaced = group.find((copy) => copy.included?.id === 'fabric-api' && copy !== winner)

  if (replaced && winner.jar && context.fabricApi) {
    winner.problems.push(warning('fabric-api-copy', `Replaces the Fabric API included with Wave Client (${context.fabricApi.version}).`))
  }
}

/**
 * A top-level jar that can't load because of its Minecraft, Java or loader requirement is not a
 * problem when a copy nested in another loaded mod can stand in for it (for its id and everything
 * it provides): Fabric loads that copy instead.
 */
function replaceByNested(copies: Copy[], all: Copy[], context: Context, overrides: DependencyOverrides | null): void {
  const parents = all.filter((copy) => copy.loads && !copy.fatal)
  const nested = indexCandidates(parents, context, overrides)

  for (const copy of copies) {
    if (!copy.fatal || !copy.problems.every((problem) => REPLACEABLE.has(problem.code))) continue

    const standIns = copy.ids.map((id) => (nested.get(id) ?? []).find((candidate) => !candidate.topLevel))

    if (standIns.some((candidate) => !candidate)) continue

    const standIn = standIns[0]!
    copy.loads = false
    copy.problems = [warning('duplicate', `Not used: ${standIn.name} ${standIn.versionText} (inside ${standIn.parent}) loads instead.`, undefined, removeFix(copy.jar!.key, 'Remove this copy'))]
  }
}

/** Copies that could load but don't (another copy of the mod was chosen), by id and "provides". */
function indexAlternatives(groups: Copy[][]): Map<string, Copy[]> {
  const index = new Map<string, Copy[]>()

  for (const copy of groups.flat()) {
    if (copy.loads || copy.fatal || !copy.jar) continue

    for (const id of copy.ids) {
      index.set(id, [...(index.get(id) ?? []), copy])
    }
  }

  return index
}

/**
 * Every id Fabric finds a mod for (whether or not that mod ends up loading): the game's, every
 * turned-on client jar's and the included mods', and those of mods nested in them. Server-only
 * nested mods go to serverOnly instead.
 */
function discoveredIds(all: Copy[], context: Context, overrides: DependencyOverrides | null, serverOnly: ModMetadata[]): Set<string> {
  const ids = new Set(context.fixedVersions.keys())
  const walk = (children: ModJarInfo[]): void => {
    for (const child of children) {
      const metadata = child.metadata ? applyDependencyOverrides(overrides, child.metadata) : null

      if (!metadata) continue

      if (metadata.environment === 'server') {
        serverOnly.push(metadata)
        continue
      }

      for (const id of [metadata.id, ...metadata.provides]) ids.add(id)

      walk(child.nested)
    }
  }

  for (const copy of all) {
    for (const id of copy.ids) ids.add(id)

    for (const nested of copy.included?.nested ?? []) {
      for (const id of [nested.id, ...nested.provides]) ids.add(id)
    }

    walk(copy.nested)
  }

  return ids
}

/** Every mod that will load, by id and by each "provides", with the provider's version. */
function indexCandidates(loading: Copy[], context: Context, overrides: DependencyOverrides | null): Map<string, Candidate[]> {
  const index = new Map<string, Candidate[]>()
  const add = (id: string, candidate: Candidate): void => {
    index.set(id, [...(index.get(id) ?? []), candidate])
  }

  for (const [id, version] of context.fixedVersions) {
    if (id !== 'fabricloader') {
      add(id, { version: parseVersion(version), versionText: version, name: fixedName(id), topLevel: true, copy: null })
    }
  }

  const addNested = (children: ModJarInfo[], parent: string): void => {
    for (const child of children) {
      const metadata = child.metadata ? applyDependencyOverrides(overrides, child.metadata) : null

      // A nested mod loads only if it can: not server-only, its fixed requirements met.
      if (!metadata || metadata.environment === 'server' || !fixedRequirementsMet(metadata, context)) {
        continue
      }

      const candidate: Candidate = { version: parseVersion(metadata.version), versionText: metadata.version, name: metadata.name ?? metadata.id, topLevel: false, copy: null, parent }

      for (const id of [metadata.id, ...metadata.provides]) add(id, candidate)

      addNested(child.nested, parent)
    }
  }

  for (const copy of loading) {
    const candidate: Candidate = { version: copy.version, versionText: copy.versionText, name: copy.name, topLevel: true, copy }

    for (const id of copy.ids) add(id, candidate)

    if (copy.included) {
      for (const nested of copy.included.nested) {
        const child: Candidate = { version: parseVersion(nested.version), versionText: nested.version, name: nested.id, topLevel: false, copy: null, parent: 'Wave Client' }

        for (const id of [nested.id, ...nested.provides]) add(id, child)
      }
    } else {
      addNested(copy.nested, copy.jar!.file)
    }
  }

  return index
}

function fixedRequirementsMet(metadata: ModMetadata, context: Context): boolean {
  return metadata.depends.every((dep) => {
    const version = context.fixedVersions.get(dep.id)
    return version === undefined || matchesAny(dep.predicates, version)
  })
}

/** What the dependency checks need besides the candidates. */
interface DependencyEnv {
  context: Context
  overrides: DependencyOverrides | null
  disabled: Array<{ mod: ScannedMod; metadata: ModMetadata }>
  /** Server-only mods Fabric found (top-level or nested): they soften a dependency on their id. */
  serverOnly: ModMetadata[]
  /** Every id Fabric finds some client mod for. */
  discovered: Set<string>
  /** A jar we couldn't check might be the copy that meets or avoids a requirement. */
  uncertain: boolean
  /** Usable copies that weren't chosen: Fabric might load one of them instead. */
  alternatives: Map<string, Copy[]>
}

function dependencyProblems(copy: Copy, candidates: Map<string, Candidate[]>, env: DependencyEnv): ModProblem[] {
  const problems: ModProblem[] = []
  const metadata = copy.metadata!
  const key = copy.jar!.key
  const minecraft = env.context.input.minecraft
  // A dependency on itself (its id or a "provides") is met by itself, as in Fabric.
  const present = (id: string): Candidate[] => candidates.get(id) ?? []
  const others = (id: string): Candidate[] => present(id).filter((candidate) => candidate.copy !== copy)
  const modulesKnown = (env.context.fabricApi?.nested.length ?? 0) > 0
  const unsure = (problem: ModProblem): ModProblem => (env.uncertain ? { ...problem, severity: 'warning' } : problem)

  for (const dep of metadata.depends) {
    if (FIXED.has(dep.id)) continue // checked with the jar's own problems

    const found = present(dep.id)

    if (found.some((candidate) => matchesAny(dep.predicates, candidate.version))) {
      continue
    }

    // Fabric softens a dependency on a mod that is only there server-only to a suggestion, when
    // no client mod at all has that id (it never sees turned-off files).
    if (!env.discovered.has(dep.id) && env.serverOnly.some((m) => m.id === dep.id && matchesAny(dep.predicates, m.version))) {
      continue
    }

    const wanted = describePredicates(dep.predicates)
    const other = (env.alternatives.get(dep.id) ?? []).find((alternative) => matchesAny(dep.predicates, alternative.version))

    if (other) {
      problems.push(
        warning(
          'dependency-version',
          `${wanted ? `Needs ${other.name} ${wanted}.` : `Needs a different version of ${other.name}.`} Fabric may load ${other.name} ${other.versionText} (${other.jar!.file}) instead; if the game doesn't start, remove the copy you don't need.`,
          requirement('depends', dep)
        )
      )
      continue
    }

    const off = bestDisabled(dep, env.disabled)

    if (off) {
      const name = off.metadata.name ?? off.metadata.id
      problems.push(unsure(error('disabled-dependency', `Needs ${name} (turned off).`, requirement('depends', dep), { kind: 'enable', key: off.mod.key, label: `Turn on ${name}` })))
      continue
    }

    if (found.length > 0) {
      const name = found[0]!.name
      const installed = [...new Set(found.map((candidate) => candidate.versionText))].join(', ')
      problems.push(
        unsure(
          error(
            'dependency-version',
            wanted ? `Needs ${name} ${wanted} (${installed} installed).` : `Needs a different version of ${name} (${installed} installed).`,
            requirement('depends', dep)
          )
        )
      )
      continue
    }

    if (dep.id.startsWith('fabric-') && !modulesKnown) {
      problems.push(warning('unknown-dependency', `Needs ${dep.id}, which Wave Client couldn't check. If the game doesn't start, add it.`, requirement('depends', dep)))
      continue
    }

    const missing = error('missing', `Needs ${dep.id}. Download its Fabric version for Minecraft ${minecraft} and add it here.`, requirement('depends', dep))
    missing.modId = dep.id
    problems.push(unsure(missing))
  }

  for (const kind of ['breaks', 'conflicts'] as const) {
    for (const dep of metadata[kind]) {
      if (kind === 'breaks' && FIXED.has(dep.id)) continue // checked with the jar's own problems

      const match = others(dep.id).find((candidate) => candidate.topLevel && matchesAny(dep.predicates, candidate.version))

      if (!match) continue

      const other = match.copy?.jar
      const fix: ModFix = other ? disableFix(other.key, match.name) : disableFix(key, copy.name)

      if (kind === 'conflicts') {
        problems.push(warning('conflicts', `May not work well with ${match.name} ${match.versionText}.`, requirement(kind, dep), fix))
      } else if ((env.alternatives.get(dep.id) ?? []).some((alternative) => !matchesAny(dep.predicates, alternative.version))) {
        // Another copy of that mod would be fine: Fabric may load it instead.
        problems.push(warning('breaks', `Doesn't work with ${match.name} ${match.versionText}. Fabric may load another copy of it instead; if the game doesn't start, turn one of them off.`, requirement(kind, dep), fix))
      } else {
        problems.push(unsure(error('breaks', `Doesn't work with ${match.name} ${match.versionText}. Turn one of them off.`, requirement(kind, dep), fix)))
      }
    }
  }

  for (const dep of metadata.recommends) {
    if (!present(dep.id).some((candidate) => matchesAny(dep.predicates, candidate.version))) {
      const wanted = describePredicates(dep.predicates)
      problems.push(warning('recommends', wanted ? `Works best with ${dep.id} ${wanted}.` : `Works best with ${dep.id}.`, requirement('recommends', dep)))
    }
  }

  return problems
}

/** A turned-off mod that would meet the dependency, else any turned-off mod with that id. */
function bestDisabled(dep: ModDependency, disabled: Array<{ mod: ScannedMod; metadata: ModMetadata }>): { mod: ScannedMod; metadata: ModMetadata } | undefined {
  const withId = disabled.filter(({ metadata }) => [metadata.id, ...metadata.provides].includes(dep.id))
  return withId.find(({ metadata }) => matchesAny(dep.predicates, metadata.version)) ?? withId[0]
}

function notFabricMessage(kind: ModJarInfo['nonFabric']): string {
  switch (kind) {
    case 'forge':
      return "Won't load: this is a Forge mod. Get its Fabric version."
    case 'neoforge':
      return "Won't load: this is a NeoForge mod. Get its Fabric version."
    case 'quilt':
      return "Won't load: this is a Quilt mod. Get its Fabric version."
    default:
      return "Won't load: this isn't a Fabric mod."
  }
}

function fixedName(id: string): string {
  return id === 'minecraft' ? 'Minecraft' : id === 'java' ? 'Java' : id === 'fabricloader' ? 'Fabric Loader' : id
}

/** The requirement as written, for the detail line: depends minecraft "~1.20.1". */
function requirement(kind: Kind, dep: ModDependency): string {
  const predicates = dep.predicates.length > 0 ? dep.predicates.map((p) => JSON.stringify(p)).join(' or ') : '(no version)'
  return `${kind} ${dep.id} ${predicates}`
}

function removeFix(key: string, label: string): ModFix {
  return { kind: 'remove', key, label }
}

function disableFix(key: string, name: string): ModFix {
  return { kind: 'disable', key, label: `Turn off ${name}` }
}

function error(code: ModProblem['code'], message: string, detail?: string, fix?: ModFix): ModProblem {
  return problem('error', code, message, detail, fix)
}

function warning(code: ModProblem['code'], message: string, detail?: string, fix?: ModFix): ModProblem {
  return problem('warning', code, message, detail, fix)
}

function problem(severity: ModProblem['severity'], code: ModProblem['code'], message: string, detail?: string, fix?: ModFix): ModProblem {
  return { severity, code, message, ...(detail !== undefined ? { detail } : {}), ...(fix ? { fix } : {}) }
}
