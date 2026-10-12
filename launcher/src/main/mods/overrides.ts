import { JsonSyntaxError, fromJs, parseFabricJson, type JsonValue } from './json'
import { MetadataError, checkPredicates } from './metadata'
import type { ModDependency, ModMetadata } from './types'

/**
 * <gameDir>/config/fabric_loader_dependencies.json, a port of Fabric Loader's
 * DependencyOverrides: per mod id, replace a kind of dependency ("depends"), or remove ("-depends",
 * by id) and then add ("+depends") entries. Fabric applies it to every mod it reads, and refuses
 * to start when the file can't be parsed.
 */

export type DependencyKind = 'depends' | 'recommends' | 'suggests' | 'conflicts' | 'breaks'

const KINDS: readonly DependencyKind[] = ['depends', 'recommends', 'suggests', 'conflicts', 'breaks']

type Operation = 'add' | 'remove' | 'replace'

interface OverrideEntry {
  operation: Operation
  kind: DependencyKind
  values: ModDependency[]
}

export type DependencyOverrides = ReadonlyMap<string, readonly OverrideEntry[]>

export class OverridesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OverridesError'
  }
}

/** From the file's text, read with Fabric's JSON rules. */
export function parseDependencyOverridesText(text: string): DependencyOverrides {
  let root: JsonValue

  try {
    root = parseFabricJson(text)
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      throw new OverridesError(error.message)
    }

    throw error
  }

  return parseOverrides(root)
}

/** From a value JSON.parse already read (key order as JavaScript keeps it). */
export function parseDependencyOverrides(value: unknown): DependencyOverrides {
  return parseOverrides(fromJs(value))
}

function parseOverrides(root: JsonValue): DependencyOverrides {
  if (root.type !== 'object') {
    throw new OverridesError('Root must be an object')
  }

  const [first, ...rest] = root.entries

  if (!first || first[0] !== 'version') {
    throw new OverridesError('First key must be "version"')
  }

  if (first[1].type !== 'number' || Number(first[1].raw) !== 1) {
    throw new OverridesError('Unsupported "version", must be 1')
  }

  const result = new Map<string, OverrideEntry[]>()

  for (const [key, value] of rest) {
    if (key !== 'overrides') {
      throw new OverridesError(`Unsupported root key: ${key}`)
    }

    for (const [modId, keys] of objectEntries(value, '"overrides" must be an object')) {
      result.set(modId, readKeys(keys))
    }
  }

  return result
}

function readKeys(value: JsonValue): OverrideEntry[] {
  const byKind = new Map<DependencyKind, Map<Operation, ModDependency[]>>()

  for (const [rawKey, deps] of objectEntries(value, 'Dependency container must be an object!')) {
    const operation: Operation = rawKey.startsWith('+') ? 'add' : rawKey.startsWith('-') ? 'remove' : 'replace'
    const key = operation === 'replace' ? rawKey : rawKey.slice(1)
    const kind = KINDS.find((k) => k === key)

    if (!kind) {
      throw new OverridesError(`${key} is not an allowed dependency key, must be one of: ${KINDS.join(', ')}`)
    }

    const values = readDependencies(deps)

    if (values.length > 0 || operation === 'replace') {
      let ops = byKind.get(kind)

      if (!ops) {
        ops = new Map()
        byKind.set(kind, ops)
      }

      ops.set(operation, values)
    }
  }

  const entries: OverrideEntry[] = []

  // Fabric walks its EnumMap in declaration order; a replace suppresses add and remove.
  for (const kind of KINDS) {
    const ops = byKind.get(kind)

    if (!ops) continue

    const replace = ops.get('replace')

    if (replace) {
      entries.push({ operation: 'replace', kind, values: replace })
    } else {
      const remove = ops.get('remove')
      const add = ops.get('add')
      if (remove) entries.push({ operation: 'remove', kind, values: remove })
      if (add) entries.push({ operation: 'add', kind, values: add })
    }
  }

  return entries
}

function readDependencies(value: JsonValue): ModDependency[] {
  const result: ModDependency[] = []

  for (const [id, v] of objectEntries(value, 'Dependency container must be an object!')) {
    let predicates: string[]

    if (v.type === 'string') {
      predicates = [v.value]
    } else if (v.type === 'array') {
      predicates = v.items.map((item) => {
        if (item.type !== 'string') {
          throw new OverridesError('Dependency version range array must only contain string values')
        }

        return item.value
      })
    } else {
      throw new OverridesError('Dependency version range must be a string or string array!')
    }

    try {
      result.push({ id, predicates: checkPredicates(predicates) })
    } catch (error) {
      throw error instanceof MetadataError ? new OverridesError(error.message) : error
    }
  }

  return result
}

/** The mod's dependencies after the overrides for its id (DependencyOverrides.apply). */
export function applyDependencyOverrides(overrides: DependencyOverrides | null, metadata: ModMetadata): ModMetadata {
  const entries = overrides?.get(metadata.id)

  if (!entries) {
    return metadata
  }

  const result: ModMetadata = { ...metadata }

  for (const kind of KINDS) {
    result[kind] = [...metadata[kind]]
  }

  for (const entry of entries) {
    switch (entry.operation) {
      case 'replace':
        result[entry.kind] = [...entry.values]
        break
      case 'remove':
        result[entry.kind] = result[entry.kind].filter((dep) => !entry.values.some((value) => value.id === dep.id))
        break
      case 'add':
        result[entry.kind] = [...result[entry.kind], ...entry.values]
        break
    }
  }

  return result
}

function objectEntries(value: JsonValue, message: string): Array<[string, JsonValue]> {
  if (value.type !== 'object') {
    throw new OverridesError(message)
  }

  return value.entries
}

