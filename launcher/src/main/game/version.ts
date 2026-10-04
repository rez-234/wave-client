import { mavenKey, mavenPath, mavenUrl, parseMaven, type MavenCoordinate } from '../util/maven'

/*
 * Mojang's version JSON (and Fabric's profile JSON, which uses the same format and "inheritsFrom"
 * the vanilla version), and the rules that turn it into libraries and command-line arguments.
 */

export interface RuleOs {
  name?: string
  arch?: string
  version?: string
}

export interface Rule {
  action: 'allow' | 'disallow'
  os?: RuleOs
  features?: Record<string, boolean>
}

export type Argument = string | { rules?: Rule[]; value: string | string[] }

export interface Artifact {
  path?: string
  sha1?: string
  size?: number
  url: string
}

export interface Library {
  name: string
  downloads?: { artifact?: Artifact; classifiers?: Record<string, Artifact> }
  /** A Maven repository base URL (Fabric's style, used when there is no downloads block). */
  url?: string
  sha1?: string
  size?: number
  rules?: Rule[]
  /** Pre-1.19 native classifiers: not supported. */
  natives?: Record<string, string>
}

export interface AssetIndexRef {
  id: string
  sha1: string
  size: number
  totalSize?: number
  url: string
}

export interface VersionJson {
  id: string
  inheritsFrom?: string
  type?: string
  mainClass?: string
  arguments?: { game?: Argument[]; jvm?: Argument[] }
  /** Pre-1.13 game arguments, space separated. */
  minecraftArguments?: string
  libraries?: Library[]
  assetIndex?: AssetIndexRef
  assets?: string
  downloads?: Record<string, Artifact>
  javaVersion?: { component: string; majorVersion: number }
  logging?: { client?: { argument: string; file: { id: string; sha1: string; size: number; url: string }; type: string } }
  releaseTime?: string
  time?: string
}

/** What rules are evaluated against. */
export interface RuleEnvironment {
  /** Mojang's names: 'windows', 'osx' or 'linux'. */
  os: 'windows' | 'osx' | 'linux'
  /** Node's process.arch ('x64', 'arm64', 'ia32', ...). */
  arch: string
  /** The OS version string matched by "os.version" regexes. */
  osVersion: string
  features: Record<string, boolean>
}

export function mojangOsName(platform: string): RuleEnvironment['os'] {
  switch (platform) {
    case 'win32':
      return 'windows'
    case 'darwin':
      return 'osx'
    case 'linux':
      return 'linux'
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

/**
 * Whether a rule list allows something. No rules means allowed; otherwise it starts disallowed and
 * the last rule that matches decides.
 */
export function rulesAllow(rules: Rule[] | undefined, env: RuleEnvironment): boolean {
  if (!rules || rules.length === 0) {
    return true
  }

  let allowed = false

  for (const rule of rules) {
    if (ruleMatches(rule, env)) {
      allowed = rule.action === 'allow'
    }
  }

  return allowed
}

function ruleMatches(rule: Rule, env: RuleEnvironment): boolean {
  if (rule.os) {
    if (rule.os.name !== undefined && rule.os.name !== env.os) {
      return false
    }

    // Mojang's "x86" means a 32-bit x86 JVM.
    if (rule.os.arch !== undefined && !(rule.os.arch === 'x86' ? env.arch === 'ia32' : rule.os.arch === env.arch)) {
      return false
    }

    if (rule.os.version !== undefined && !safeRegexTest(rule.os.version, env.osVersion)) {
      return false
    }
  }

  if (rule.features) {
    for (const [feature, wanted] of Object.entries(rule.features)) {
      if ((env.features[feature] ?? false) !== wanted) {
        return false
      }
    }
  }

  return true
}

function safeRegexTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}

/**
 * Applies "inheritsFrom": the child (e.g. Fabric's profile) on top of its parent (vanilla).
 * Scalar fields come from the child when it has them; arguments are the parent's followed by the
 * child's; libraries are the child's followed by the parent's, so the child's version of a
 * library wins when both list it (see resolveLibraries).
 */
export function mergeVersions(child: VersionJson, parent: VersionJson): VersionJson {
  const merged: VersionJson = { ...parent, ...stripUndefined(child) }
  delete merged.inheritsFrom

  merged.libraries = [...(child.libraries ?? []), ...(parent.libraries ?? [])]

  if (parent.arguments || child.arguments) {
    merged.arguments = {
      game: [...(parent.arguments?.game ?? []), ...(child.arguments?.game ?? [])],
      jvm: [...(parent.arguments?.jvm ?? []), ...(child.arguments?.jvm ?? [])]
    }
  }

  return merged
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}

export interface ResolvedLibrary {
  name: string
  coordinate: MavenCoordinate
  /** Path relative to the libraries folder, with forward slashes. */
  path: string
  url: string
  sha1?: string
  size?: number
}

const MOJANG_LIBRARIES = 'https://libraries.minecraft.net/'

/**
 * The libraries that apply on this machine, in classpath order, with download details. When two
 * entries share group, artifact and classifier, the first one wins (the child's, after a merge).
 */
export function resolveLibraries(libraries: Library[], env: RuleEnvironment): ResolvedLibrary[] {
  const seen = new Set<string>()
  const resolved: ResolvedLibrary[] = []

  for (const library of libraries) {
    if (!rulesAllow(library.rules, env)) {
      continue
    }

    if (library.natives) {
      throw new Error(`Library ${library.name} uses the pre-1.19 natives format, which this launcher doesn't support`)
    }

    const coordinate = parseMaven(library.name)
    const key = mavenKey(coordinate)

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    const artifact = library.downloads?.artifact

    if (artifact) {
      resolved.push({
        name: library.name,
        coordinate,
        path: artifact.path ?? mavenPath(coordinate),
        url: artifact.url,
        sha1: artifact.sha1,
        size: artifact.size
      })
    } else if (!library.downloads) {
      resolved.push({
        name: library.name,
        coordinate,
        path: mavenPath(coordinate),
        url: mavenUrl(library.url ?? MOJANG_LIBRARIES, coordinate),
        sha1: library.sha1,
        size: library.size
      })
    }
    // A downloads block with only classifiers has nothing for the classpath.
  }

  return resolved
}

/** Values for ${...} placeholders. */
export type ArgumentValues = Record<string, string>

/**
 * Expands argument templates: entries whose rules don't allow them are dropped, and every
 * ${name} with a value is substituted. Unknown placeholders are left as they are.
 */
export function expandArguments(args: Argument[], env: RuleEnvironment, values: ArgumentValues): string[] {
  const out: string[] = []

  for (const arg of args) {
    if (typeof arg === 'string') {
      out.push(substitute(arg, values))
    } else if (rulesAllow(arg.rules, env)) {
      for (const value of Array.isArray(arg.value) ? arg.value : [arg.value]) {
        out.push(substitute(value, values))
      }
    }
  }

  return out
}

export function substitute(template: string, values: ArgumentValues): string {
  return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => (Object.hasOwn(values, name) ? values[name]! : match))
}

/** Game arguments, from "arguments.game" or the pre-1.13 "minecraftArguments". */
export function gameArgumentTemplates(version: VersionJson): Argument[] {
  if (version.arguments?.game) {
    return version.arguments.game
  }

  return version.minecraftArguments ? version.minecraftArguments.split(' ').filter((part) => part.length > 0) : []
}

/** JVM arguments; very old versions have none, so the launcher supplies the classic set. */
export function jvmArgumentTemplates(version: VersionJson): Argument[] {
  return version.arguments?.jvm ?? ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}']
}
