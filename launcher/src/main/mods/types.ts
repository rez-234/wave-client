import type { ModProblem } from '@shared/ipc'

/**
 * The mods library's types (zip.ts, metadata.ts, version.ts, scan.ts, analyze.ts). Pure Node:
 * nothing here imports Electron. The main process (mods/service.ts) builds the IPC ModsReport
 * from these.
 */

export type NonFabricKind = 'forge' | 'neoforge' | 'quilt' | 'unknown'

/** One dependency entry: met when any of the predicates matches (Fabric: an array is an OR). */
export interface ModDependency {
  id: string
  /** Raw predicate strings, already checked to parse. Empty means "never matches". */
  predicates: string[]
}

/** fabric.mod.json, schema 0 or 1, validated the way Fabric Loader validates it. */
export interface ModMetadata {
  schemaVersion: 0 | 1
  id: string
  version: string
  /** Display name (capped, formatting codes removed), or null. */
  name: string | null
  description: string | null
  authors: string[]
  /** Path of the icon inside the jar, chosen like Fabric (smallest size >= 64, else largest). */
  icon: string | null
  /** Lower-cased; '' is treated as '*'. */
  environment: 'client' | 'server' | '*'
  provides: string[]
  depends: ModDependency[]
  recommends: ModDependency[]
  suggests: ModDependency[]
  breaks: ModDependency[]
  conflicts: ModDependency[]
  /** jar-in-jar entries listed in "jars" (paths inside this jar). */
  jars: string[]
}

/** What one jar contains, with the Fabric mods nested in it (recursively). */
export interface ModJarInfo {
  /** null when the jar has no fabric.mod.json. */
  metadata: ModMetadata | null
  /** Set when metadata is null: what kind of jar it seems to be. */
  nonFabric: NonFabricKind | null
  /** Mods nested via "jars" (each with metadata), recursively. */
  nested: ModJarInfo[]
}

export type ModReadResult =
  | { ok: true; info: ModJarInfo }
  /**
   * unreadable: Fabric would fail on it too (no zip, encrypted or unsupported entries, bad
   * fabric.mod.json, broken nested jar). unchecked: our reader couldn't handle it but Java might.
   */
  | { ok: false; kind: 'unreadable' | 'unchecked'; message: string }

export interface ScannedMod {
  /** File name without ".disabled". */
  key: string
  /** File name now. */
  file: string
  /** on: ends in exactly ".jar"; off: ".jar.disabled"; case: ".jar" in another case (Fabric skips it). */
  state: 'on' | 'off' | 'case'
  size: number
  mtimeMs: number
  read: ModReadResult
}

export interface ScanResult {
  folder: 'ok' | 'missing' | 'not-a-folder' | 'unreadable'
  /** Sorted by key. */
  mods: ScannedMod[]
}

/** A mod the launcher always loads (Fabric Loader, Fabric API, Wave Client), with what it nests. */
export interface IncludedSpec {
  id: string
  name: string
  version: string
  provides: string[]
  nested: Array<{ id: string; version: string; provides: string[] }>
}

export interface AnalysisInput {
  mods: ScannedMod[]
  minecraft: string
  /** Java major version, e.g. 21 (Fabric's "java" built-in). */
  javaMajor: number
  /** fabricloader, fabric-api and waveclient, with their nested mods. */
  included: IncludedSpec[]
  /** <gameDir>/config/fabric_loader_dependencies.json: absent (null), parsed, or unparsable. */
  overrides: null | { ok: true; value: unknown } | { ok: false; message: string }
  /** The profile's JVM args set fabric.modsFolder / debug.disableModIds / gameVersion / debug.replaceVersion. */
  customFabricOptions: boolean
  /** Now, in ms: a jar changed in the last 2 s that can't be read is reported as 'copying'. */
  now: number
}

export interface ModResult {
  /** Fabric will load it. */
  loads: boolean
  problems: ModProblem[]
  /** Names of loaded mods that hard-depend on it. */
  neededBy: string[]
}

export interface ModAnalysis {
  /** By ScannedMod.key. */
  mods: Map<string, ModResult>
  profileProblems: ModProblem[]
  errors: number
  warnings: number
}
