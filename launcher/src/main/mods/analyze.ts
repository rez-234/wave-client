import type { ModFix, ModProblem } from '@shared/ipc'

import { type DependencyOverrides, applyDependencyOverrides, parseDependencyOverrides } from './overrides'
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
 * of one id only one loads (the newest that can); nested mods load if their parent does and their
 * own Minecraft, Java and loader requirements hold; a dependency is met by any loaded mod with
 * that id or "provides" whose version matches.
 */

/** Ids Fabric itself provides: a mod claiming one stops the launch. */
const BUILT_IN = new Set(['minecraft', 'java'])
/** Ids whose versions are fixed by the profile (built-ins and the loader). */
const FIXED = new Set(['minecraft', 'java', 'fabricloader'])
/** Copying a jar into the folder takes a moment; a read failure that recent is probably that. */
const COPYING_MS = 2000

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
  const groups = groupCopies([...copies, ...includedCopies])

  for (const group of groups) {
    chooseWinner(group, context)
  }

  const candidates = indexCandidates([...includedCopies, ...copies].filter((copy) => copy.loads), context, overrides)

  for (const copy of copies) {
    if (copy.loads) {
      checkDependencies(copy, candidates, disabled, serverOnly, context, uncertain)
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
    return parseDependencyOverrides(input.overrides.value)
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

/**
 * Of several copies, the newest one that can load loads (Fabric: the newest whose own
 * requirements hold); an included mod wins a tie, then the first file name. The others are
 * unused: a warning, and their own problems don't matter. When none can load, each keeps its
 * problems (the launch fails either way).
 */
function chooseWinner(group: Copy[], context: Context): void {
  const usable = group.filter((copy) => !copy.fatal)
  const pool = usable.length > 0 ? usable : group
  const ordered = [...pool].sort(
    (a, b) => compareVersions(b.version, a.version) || (a.included ? -1 : 0) - (b.included ? -1 : 0) || (a.jar?.file ?? '').localeCompare(b.jar?.file ?? '')
  )
  const winner = ordered[0]!

  for (const copy of group) {
    if (copy === winner) continue

    copy.loads = false

    // A copy of something the launcher provides is an error of its own (product rule): keep it.
    if (!copy.jar || copy.problems.some((problem) => problem.code === 'built-in') || usable.length === 0) {
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

  const addNested = (children: ModJarInfo[]): void => {
    for (const child of children) {
      const metadata = child.metadata ? applyDependencyOverrides(overrides, child.metadata) : null

      // A nested mod loads only if it can: not server-only, its fixed requirements met.
      if (!metadata || metadata.environment === 'server' || !fixedRequirementsMet(metadata, context)) {
        continue
      }

      const candidate: Candidate = { version: parseVersion(metadata.version), versionText: metadata.version, name: metadata.name ?? metadata.id, topLevel: false, copy: null }

      for (const id of [metadata.id, ...metadata.provides]) add(id, candidate)

      addNested(child.nested)
    }
  }

  for (const copy of loading) {
    const candidate: Candidate = { version: copy.version, versionText: copy.versionText, name: copy.name, topLevel: true, copy }

    for (const id of copy.ids) add(id, candidate)

    if (copy.included) {
      for (const nested of copy.included.nested) {
        const child: Candidate = { version: parseVersion(nested.version), versionText: nested.version, name: nested.id, topLevel: false, copy: null }

        for (const id of [nested.id, ...nested.provides]) add(id, child)
      }
    } else {
      addNested(copy.nested)
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

function checkDependencies(
  copy: Copy,
  candidates: Map<string, Candidate[]>,
  disabled: Array<{ mod: ScannedMod; metadata: ModMetadata }>,
  serverOnly: ModMetadata[],
  context: Context,
  uncertain: boolean
): void {
  const metadata = copy.metadata!
  const key = copy.jar!.key
  const others = (id: string): Candidate[] => (candidates.get(id) ?? []).filter((candidate) => candidate.copy !== copy)
  const modulesKnown = (context.fabricApi?.nested.length ?? 0) > 0

  for (const dep of metadata.depends) {
    if (FIXED.has(dep.id)) continue // checked with the jar's own problems

    const present = others(dep.id)

    if (present.some((candidate) => matchesAny(dep.predicates, candidate.version))) {
      continue
    }

    const off = bestDisabled(dep, disabled)

    if (off) {
      const name = off.metadata.name ?? off.metadata.id
      copy.problems.push(error('disabled-dependency', `Needs ${name} (turned off).`, requirement('depends', dep), { kind: 'enable', key: off.mod.key, label: `Turn on ${name}` }))
      continue
    }

    // Fabric softens a dependency on a mod that is there but server-only to a suggestion.
    if (serverOnly.some((m) => [m.id, ...m.provides].includes(dep.id) && matchesAny(dep.predicates, m.version))) {
      continue
    }

    if (present.length > 0) {
      const name = present[0]!.name
      const installed = [...new Set(present.map((candidate) => candidate.versionText))].join(', ')
      const wanted = describePredicates(dep.predicates)
      copy.problems.push(
        error(
          'dependency-version',
          wanted ? `Needs ${name} ${wanted} (${installed} installed).` : `Needs a different version of ${name} (${installed} installed).`,
          requirement('depends', dep)
        )
      )
      continue
    }

    if (dep.id.startsWith('fabric-') && !modulesKnown) {
      copy.problems.push(warning('unknown-dependency', `Needs ${dep.id}, which Wave Client couldn't check. If the game doesn't start, add it.`, requirement('depends', dep)))
      continue
    }

    const missing = error('missing', `Needs ${dep.id}. Download its Fabric version for Minecraft ${context.input.minecraft} and add it here.`, requirement('depends', dep))
    missing.modId = dep.id
    // A jar we couldn't check might be the one that provides it.
    copy.problems.push(uncertain ? { ...missing, severity: 'warning' } : missing)
  }

  for (const kind of ['breaks', 'conflicts'] as const) {
    for (const dep of metadata[kind]) {
      if (kind === 'breaks' && FIXED.has(dep.id)) continue // checked with the jar's own problems

      const match = others(dep.id).find((candidate) => candidate.topLevel && matchesAny(dep.predicates, candidate.version))

      if (!match) continue

      const other = match.copy?.jar
      const fix: ModFix = other ? disableFix(other.key, match.name) : disableFix(key, copy.name)

      if (kind === 'breaks') {
        copy.problems.push(error('breaks', `Doesn't work with ${match.name} ${match.versionText}. Turn one of them off.`, requirement(kind, dep), fix))
      } else {
        copy.problems.push(warning('conflicts', `May not work well with ${match.name} ${match.versionText}.`, requirement(kind, dep), fix))
      }
    }
  }

  for (const dep of metadata.recommends) {
    if (!others(dep.id).some((candidate) => matchesAny(dep.predicates, candidate.version))) {
      const wanted = describePredicates(dep.predicates)
      copy.problems.push(warning('recommends', wanted ? `Works best with ${dep.id} ${wanted}.` : `Works best with ${dep.id}.`, requirement('recommends', dep)))
    }
  }
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
