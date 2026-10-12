import { JsonSyntaxError, parseFabricJson, type JsonValue } from './json'
import type { ModDependency, ModMetadata } from './types'
import { VersionParsingError, parsePredicate } from './version'

/**
 * fabric.mod.json, read the way Fabric Loader reads it (ModMetadataParser, V0ModMetadataParser,
 * V1ModMetadataParser, MetadataVerifier): whatever Fabric refuses throws a MetadataError, which
 * makes the jar unreadable (Fabric stops the launch on it); whatever Fabric only warns about is
 * accepted. Text meant for display is cleaned and capped.
 */

export class MetadataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetadataError'
  }
}

export const MOD_ID = /^[a-z][a-z0-9_-]{1,63}$/
/** The icon size asked for (Mod Menu's list); Fabric picks the smallest at least this big, else the largest. */
const ICON_SIZE = 64
const NAME_LIMIT = 100
const DESCRIPTION_LIMIT = 300
const AUTHOR_LIMIT = 60
const AUTHORS = 10

type Kind = 'depends' | 'recommends' | 'suggests' | 'conflicts' | 'breaks'

interface Draft {
  id: string | null
  version: string | null
  name: string | null
  description: string | null
  authors: string[]
  icon: string | null
  environment: ModMetadata['environment']
  provides: string[]
  dependencies: Record<Kind, ModDependency[]>
  jars: string[]
}

export function parseFabricModJson(input: string | Buffer): ModMetadata {
  const text = typeof input === 'string' ? input : input.toString('utf8')
  let root: JsonValue

  try {
    root = parseFabricJson(text)
  } catch (error) {
    if (error instanceof JsonSyntaxError) {
      throw new MetadataError(`fabric.mod.json isn't valid JSON: ${error.message}`)
    }

    throw error
  }

  if (root.type !== 'object') {
    throw new MetadataError('Root of "fabric.mod.json" must be an object')
  }

  // schemaVersion first (after "$schema"): parse the rest with it. Anywhere else: parse the whole
  // object again with the first one found. None: schema 0.
  let schemaVersion = 0
  let entries = root.entries
  let firstField = true

  for (let i = 0; i < root.entries.length; i++) {
    const [key, value] = root.entries[i]!

    if (key === 'schemaVersion') {
      if (value.type !== 'number') {
        throw new MetadataError('"schemaVersion" must be a number.')
      }

      schemaVersion = nextInt(value)

      if (firstField) {
        entries = root.entries.slice(i + 1)
      }

      break
    }

    if (key !== '$schema') {
      firstField = false
    }
  }

  let draft: Draft

  if (schemaVersion === 1) {
    draft = parseV1(entries)
  } else if (schemaVersion === 0) {
    draft = parseV0(entries)
  } else if (schemaVersion > 1) {
    throw new MetadataError(`This mod needs a newer Fabric Loader (fabric.mod.json schema version ${schemaVersion})`)
  } else {
    throw new MetadataError(`Invalid/Unsupported schema version "${schemaVersion}" was found`)
  }

  if (draft.id === null) {
    throw new MetadataError('Missing mandatory field "id"')
  }

  if (draft.version === null) {
    throw new MetadataError('Missing mandatory field "version"')
  }

  checkModId(draft.id, 'mod id')

  for (const provided of draft.provides) {
    checkModId(provided, 'provides declaration')
  }

  return {
    schemaVersion: schemaVersion as 0 | 1,
    id: draft.id,
    version: draft.version,
    name: draft.name ? cleanText(draft.name, NAME_LIMIT, true) || null : null,
    description: draft.description ? cleanText(draft.description, DESCRIPTION_LIMIT, false) || null : null,
    authors: draft.authors
      .map((a) => cleanText(a, AUTHOR_LIMIT, true))
      .filter((a) => a.length > 0)
      .slice(0, AUTHORS),
    icon: schemaVersion === 0 ? `assets/${draft.id}/icon.png` : draft.icon,
    environment: draft.environment,
    provides: draft.provides,
    jars: draft.jars,
    ...draft.dependencies
  }
}

function newDraft(): Draft {
  return {
    id: null,
    version: null,
    name: null,
    description: null,
    authors: [],
    icon: null,
    environment: '*',
    provides: [],
    dependencies: { depends: [], recommends: [], suggests: [], conflicts: [], breaks: [] },
    jars: []
  }
}

function parseV1(entries: Array<[string, JsonValue]>): Draft {
  const draft = newDraft()

  for (const [key, value] of entries) {
    switch (key) {
      case 'schemaVersion':
        if (value.type !== 'number') {
          throw new MetadataError('Duplicate "schemaVersion" field is not a number')
        }

        if (nextInt(value) !== 1) {
          throw new MetadataError('Duplicate "schemaVersion" field does not match the predicted schema version of 1')
        }

        break
      case 'id':
        draft.id = string(value, 'Mod id must be a non-empty string with a length of 3-64 characters.')
        break
      case 'version':
        draft.version = string(value, 'Version must be a non-empty string')

        if (draft.version.length === 0) {
          throw new MetadataError('Failed to parse version: Version must be a non-empty string!')
        }

        break
      case 'provides':
        for (const item of array(value, 'Provides must be an array')) {
          draft.provides.push(string(item, 'Provided id must be a string'))
        }

        break
      case 'environment':
        draft.environment = environment(string(value, 'Environment must be a string'))
        break
      case 'entrypoints':
        readEntrypoints(value)
        break
      case 'jars':
        for (const item of array(value, 'Jar entries must be in an array')) {
          let file: string | null = null

          for (const [k, v] of object(item, 'Invalid type for JAR entry!')) {
            if (k === 'file') {
              file = string(v, '"file" entry in jar object must be a string')
            }
          }

          if (file === null) {
            throw new MetadataError("Missing mandatory key 'file' in JAR entry!")
          }

          draft.jars.push(file)
        }

        break
      case 'mixins':
        for (const item of array(value, 'Mixin configs must be in an array')) {
          if (item.type === 'object') {
            let config = false

            for (const [k, v] of item.entries) {
              if (k === 'environment') {
                environment(nextString(v))
              } else if (k === 'config') {
                string(v, 'Value of "config" must be a string')
                config = true
              }
            }

            if (!config) {
              throw new MetadataError("Missing mandatory key 'config' in mixin entry!")
            }
          }
        }

        break
      case 'accessWidener':
        string(value, 'Access Widener file must be a string')
        break
      case 'depends':
      case 'recommends':
      case 'suggests':
      case 'conflicts':
      case 'breaks':
        readDependencies(value, draft.dependencies[key], 'Dependency container must be an object!')
        break
      case 'name':
        draft.name = string(value, 'Mod name must be a string')
        break
      case 'description':
        draft.description = string(value, 'Mod description must be a string')
        break
      case 'authors':
      case 'contributors': {
        const people = readPeopleV1(value)
        if (key === 'authors') draft.authors.push(...people)
        break
      }
      case 'contact':
        readContact(value)
        break
      case 'license':
        if (value.type === 'array') {
          value.items.forEach((item) => string(item, 'List of licenses must only contain strings'))
        } else {
          string(value, 'License must be a string or array of strings!')
        }

        break
      case 'icon':
        draft.icon = readIcon(value)
        break
      case 'languageAdapters':
        for (const [, v] of object(value, 'Language adapters must be in an object')) {
          string(v, 'Value of language adapter entry must be a string')
        }

        break
      case 'custom':
        for (const [, v] of object(value, 'Custom values must be in an object!')) {
          checkCustomValue(v)
        }

        break
      default:
        // "requires" and unknown keys: a warning in Fabric's log.
        break
    }
  }

  return draft
}

function parseV0(entries: Array<[string, JsonValue]>): Draft {
  const draft = newDraft()
  let initializer = false
  let initializers = false

  for (const [key, value] of entries) {
    switch (key) {
      case 'schemaVersion':
        if (value.type !== 'number') {
          throw new MetadataError('Duplicate "schemaVersion" field is not a number')
        }

        if (nextInt(value) !== 0) {
          throw new MetadataError('Duplicate "schemaVersion" field does not match the predicted schema version of 0')
        }

        break
      case 'id':
        draft.id = string(value, 'Mod id must be a non-empty string with a length of 3-64 characters.')
        break
      case 'version':
        draft.version = string(value, 'Version must be a non-empty string')

        if (draft.version.length === 0) {
          throw new MetadataError('Failed to parse version: Version must be a non-empty string!')
        }

        break
      case 'requires':
        readDependencies(value, draft.dependencies.depends, 'requires must be an object containing dependencies.')
        break
      case 'conflicts':
        readDependencies(value, draft.dependencies.breaks, 'conflicts must be an object containing dependencies.')
        break
      case 'recommends':
        readDependencies(value, draft.dependencies.suggests, 'recommends must be an object containing dependencies.')
        break
      case 'mixins':
        for (const [k, v] of object(value, 'Expected mixins to be an object.')) {
          if (k === 'client' || k === 'common' || k === 'server') {
            if (v.type === 'array') {
              v.items.forEach((item) => string(item, `Expected entries in ${k} to be an array of strings`))
            } else if (v.type !== 'null') {
              string(v, `Expected ${k} to be a string or an array of strings`)
            }
          }
        }

        break
      case 'side': {
        const side = string(value, 'Side must be a string')
        // Anything else is only a warning in V0.
        if (side === 'universal') draft.environment = '*'
        else if (side === 'client' || side === 'server') draft.environment = side
        break
      }
      case 'initializer':
        if (initializers) {
          throw new MetadataError('initializer and initializers should not be set at the same time!')
        }

        string(value, 'Initializer must be a non-empty string')
        initializer = true
        break
      case 'initializers':
        if (initializer) {
          throw new MetadataError('initializer and initializers should not be set at the same time!')
        }

        array(value, 'Initializers must be in a list').forEach((item) => string(item, 'Initializer in initializers list must be a string'))
        initializers = true
        break
      case 'name':
        draft.name = string(value, 'Name must be a string')
        break
      case 'description':
        draft.description = string(value, 'Mod description must be a string')
        break
      case 'authors':
      case 'contributors': {
        const people = array(value, 'List of people must be an array').map(readPersonV0)
        if (key === 'authors') draft.authors.push(...people)
        break
      }
      case 'links':
        if (value.type === 'object') {
          for (const [k, v] of value.entries) {
            if (k === 'homepage' || k === 'issues' || k === 'sources') {
              string(v, `${k} link must be a string`)
            }
          }
        } else {
          string(value, 'Expected links to be an object or string')
        }

        break
      case 'license':
        string(value, 'License name must be a string')
        break
      default:
        break
    }
  }

  return draft
}

function readEntrypoints(value: JsonValue): void {
  for (const [, list] of object(value, 'Entrypoints must be an object')) {
    for (const item of array(list, 'Entrypoint list must be an array!')) {
      if (item.type === 'string') {
        continue
      }

      let found = false

      for (const [k, v] of object(item, 'Entrypoint must be a string or object with "value" field')) {
        if (k === 'adapter') {
          nextString(v)
        } else if (k === 'value') {
          nextString(v)
          found = true
        }
      }

      if (!found) {
        throw new MetadataError('Entrypoint value must be present')
      }
    }
  }
}

/** Both schema versions: { id: "predicate" | ["predicate", ...] }, every predicate parseable. */
function readDependencies(value: JsonValue, out: ModDependency[], notObject: string): void {
  for (const [id, v] of object(value, notObject)) {
    let predicates: string[]

    if (v.type === 'string') {
      predicates = [v.value]
    } else if (v.type === 'array') {
      predicates = v.items.map((item) => string(item, 'Dependency version range array must only contain string values'))
    } else {
      throw new MetadataError('Dependency version range must be a string or string array!')
    }

    out.push({ id, predicates: checkPredicates(predicates) })
  }
}

/** ModDependencyImpl parses each predicate up front; one that doesn't parse fails the mod. */
export function checkPredicates(predicates: string[]): string[] {
  for (const predicate of predicates) {
    try {
      parsePredicate(predicate)
    } catch (error) {
      if (error instanceof VersionParsingError) {
        throw new MetadataError(`Invalid version requirement "${predicate}": ${error.message}`)
      }

      throw error
    }
  }

  return predicates
}

function readPeopleV1(value: JsonValue): string[] {
  const names: string[] = []

  for (const item of array(value, 'List of people must be an array')) {
    if (item.type === 'string') {
      names.push(item.value)
    } else if (item.type === 'object') {
      let name: string | null = null

      for (const [k, v] of item.entries) {
        if (k === 'name') {
          name = string(v, 'Name of person in dependency container must be a string')
        } else if (k === 'contact') {
          readContact(v)
        }
      }

      if (name === null) {
        throw new MetadataError("Person object must have a 'name' field!")
      }

      names.push(name)
    } else {
      throw new MetadataError('Person type must be an object or string!')
    }
  }

  return names
}

function readPersonV0(value: JsonValue): string {
  if (value.type === 'string') {
    // "Name <email> (website)": Java's split drops trailing empty strings, so a name of only
    // spaces leaves no parts and Fabric fails on it.
    let parts = javaSplitSpace(value.value)

    if (parts.length === 0) {
      throw new MetadataError(`Invalid person "${value.value}"`)
    }

    if (/^\((.+)\)$/s.test(parts[parts.length - 1]!)) parts = parts.slice(0, -1)
    if (parts.length === 0) throw new MetadataError(`Invalid person "${value.value}"`)
    if (/^<(.+)>$/s.test(parts[parts.length - 1]!)) parts = parts.slice(0, -1)
    return parts.join(' ')
  }

  if (value.type === 'object') {
    let name = ''

    for (const [k, v] of value.entries) {
      if (k === 'name' || k === 'email' || k === 'website') {
        // Fabric skips reading a non-string value here and then fails on the next key.
        const text = string(v, `Invalid ${k} in person`)
        if (k === 'name') name = text
      }
    }

    return name
  }

  throw new MetadataError('Expected person to be a string or object')
}

function readContact(value: JsonValue): void {
  for (const [, v] of object(value, 'Contact info must in an object')) {
    string(v, 'Contact information entries must be a string')
  }
}

function readIcon(value: JsonValue): string {
  if (value.type === 'string') {
    return value.value
  }

  const sizes = new Map<number, string>()

  for (const [key, v] of object(value, 'Icon entry must be an object or string!')) {
    const size = javaParseInt(key)

    if (size === null) {
      throw new MetadataError(`Could not parse icon size '${key}'!`)
    }

    if (size < 1) {
      throw new MetadataError('Size must be positive!')
    }

    sizes.set(size, string(v, 'Icon path must be a string'))
  }

  if (sizes.size === 0) {
    throw new MetadataError('Icon object must not be empty!')
  }

  const ordered = [...sizes.keys()].sort((a, b) => a - b)
  const chosen = ordered.find((size) => size >= ICON_SIZE) ?? ordered[ordered.length - 1]!
  return sizes.get(chosen)!
}

function checkCustomValue(value: JsonValue): void {
  if (value.type === 'object') {
    value.entries.forEach(([, v]) => checkCustomValue(v))
  } else if (value.type === 'array') {
    value.items.forEach(checkCustomValue)
  } else if (value.type === 'number' && !Number.isFinite(Number(value.raw))) {
    // Gson's nextDouble refuses infinities when not lenient.
    throw new MetadataError(`JSON forbids NaN and infinities: ${value.raw}`)
  }
}

/** V1 environment: case-insensitive; "" and "*" mean both sides. */
function environment(value: string): ModMetadata['environment'] {
  const lower = value.toLowerCase()

  if (lower === '' || lower === '*') return '*'
  if (lower === 'client' || lower === 'server') return lower
  throw new MetadataError(`Invalid environment type: ${lower}!`)
}

function checkModId(id: string, what: string): void {
  if (!MOD_ID.test(id)) {
    throw new MetadataError(`Invalid ${what} ${id}: it must be 2 to 64 characters, lower-case letters, digits, - and _, starting with a letter`)
  }
}

function string(value: JsonValue, message: string): string {
  if (value.type !== 'string') {
    throw new MetadataError(message)
  }

  return value.value
}

/** JsonReader.nextString: a string, or a number as written. */
function nextString(value: JsonValue): string {
  if (value.type === 'string') return value.value
  if (value.type === 'number') return value.raw
  throw new MetadataError(`Expected a string but was ${value.type}`)
}

/** JsonReader.nextInt: whole numbers in int range, written any way (1, 1.0, 1e0). */
function nextInt(value: JsonValue & { type: 'number' }): number {
  const n = Number(value.raw)

  if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) {
    throw new MetadataError(`Expected an int but was ${value.raw}`)
  }

  return n
}

function object(value: JsonValue, message: string): Array<[string, JsonValue]> {
  if (value.type !== 'object') {
    throw new MetadataError(message)
  }

  return value.entries
}

function array(value: JsonValue, message: string): JsonValue[] {
  if (value.type !== 'array') {
    throw new MetadataError(message)
  }

  return value.items
}

/** Integer.parseInt: optional sign, ASCII digits, int range. */
function javaParseInt(text: string): number | null {
  if (!/^[+-]?[0-9]+$/.test(text)) return null
  const n = Number(text)
  return n >= -2147483648 && n <= 2147483647 ? n : null
}

/** String.split(" "): trailing empty strings removed. */
function javaSplitSpace(text: string): string[] {
  if (text.length === 0) return ['']
  const parts = text.split(' ')
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  return parts
}

/** Minecraft formatting codes (§ and one character) removed, whitespace tidied, capped. */
function cleanText(text: string, limit: number, oneLine: boolean): string {
  let cleaned = text.replace(/§[\s\S]?/gu, '')
  cleaned = oneLine ? cleaned.replace(/\s+/g, ' ').trim() : cleaned.replace(/\r\n?/g, '\n').trim()
  const chars = [...cleaned]
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('').trimEnd()}…` : cleaned
}
