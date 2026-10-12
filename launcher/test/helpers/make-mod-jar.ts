import { makeZip, type ZipFileSpec, type ZipOptions } from './make-zip'

export interface ModJarSpec {
  /** fabric.mod.json: an object (schemaVersion 1 added unless given), raw text, or none. */
  modJson?: Record<string, unknown> | string | null
  /** Jars to nest: listed in "jars" and stored at the path. */
  nested?: Array<{ path: string; jar: Buffer; listed?: boolean }>
  files?: ZipFileSpec[]
  zip?: ZipOptions
}

/** A Fabric mod jar for tests. */
export function makeModJar(spec: ModJarSpec): Buffer {
  const files: ZipFileSpec[] = []
  const nested = spec.nested ?? []

  if (spec.modJson !== null && spec.modJson !== undefined) {
    let text: string

    if (typeof spec.modJson === 'string') {
      text = spec.modJson
    } else {
      const listed = nested.filter((n) => n.listed !== false).map((n) => ({ file: n.path }))
      text = JSON.stringify({ schemaVersion: 1, ...spec.modJson, ...(listed.length > 0 && !('jars' in spec.modJson) ? { jars: listed } : {}) })
    }

    files.push({ name: 'fabric.mod.json', data: text })
  }

  for (const n of nested) {
    files.push({ name: n.path, data: n.jar, method: 0 })
  }

  return makeZip([...files, ...(spec.files ?? [])], spec.zip)
}

/** The smallest Fabric mod: id and version, plus any other fabric.mod.json keys. */
export function simpleMod(id: string, version: string, extra: Record<string, unknown> = {}, nested: ModJarSpec['nested'] = []): Buffer {
  return makeModJar({ modJson: { id, version, ...extra }, nested })
}
