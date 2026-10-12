#!/usr/bin/env node
/**
 * Regenerates src/main/game/fabric-api-modules.ts: for each Fabric API version, the mods nested
 * in its jar (id, version, provides), so the mod check knows what Fabric API provides before it
 * is downloaded.
 *
 *   node scripts/fabric-api-modules.mjs [version ...] [--jar <version>=<path> ...]
 *                                        [--source <version>=<fabric-api git checkout> ...] [--out <file>]
 *
 * Versions default to the one pinned in src/main/game/versions.ts. Each jar is downloaded from
 * Fabric's Maven unless --jar gives a local copy (Node's fetch ignores HTTPS_PROXY before Node 24:
 * download with curl and pass the file). Without the jar, --source reads a full (not shallow)
 * clone of FabricMC/fabric at the release tag and works out what its build nests, with the same
 * version strings. List every version the table should keep.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let output = join(root, 'src/main/game/fabric-api-modules.ts')
const MOD_ID = /^[a-z][a-z0-9_-]{1,63}$/

const args = process.argv.slice(2)
const versions = []
const jars = new Map()
const sources = new Map()

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    output = args[++i]
  } else if (args[i] === '--jar' || args[i] === '--source') {
    const [version, path] = splitOnce(args[i + 1] ?? '', '=')
    ;(args[i] === '--jar' ? jars : sources).set(version, path)
    i++
  } else {
    versions.push(args[i])
  }
}

for (const version of [...jars.keys(), ...sources.keys()]) {
  if (!versions.includes(version)) versions.push(version)
}

if (versions.length === 0) {
  const pinned = /fabricApi:\s*'([^']+)'/.exec(await readFile(join(root, 'src/main/game/versions.ts'), 'utf8'))

  if (!pinned) throw new Error("Couldn't find the pinned Fabric API version in versions.ts")
  versions.push(pinned[1])
}

const table = []

for (const version of versions) {
  const modules = sources.has(version) ? await modulesFromSource(version, sources.get(version)) : modulesOf(jars.has(version) ? await readFile(jars.get(version)) : await download(version))

  if (!modules.some((m) => m.id === 'fabric-api-base')) {
    throw new Error(`${version}: no fabric-api-base among the nested jars; is this a Fabric API jar?`)
  }

  table.push([version, modules])
  console.log(`${version}: ${modules.length} modules`)
}

await writeFile(output, render(table))
console.log(`Wrote ${output}`)

async function download(version) {
  const url = `https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/${version}/fabric-api-${version}.jar`
  const response = await fetch(url)

  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Every Fabric mod nested in the jar (recursively), sorted by id. */
function modulesOf(jar) {
  const found = new Map()
  const visit = (bytes) => {
    const zip = readZip(bytes)
    const modJson = zip.get('fabric.mod.json')
    if (!modJson) return null
    const metadata = JSON.parse(modJson().toString('utf8').replace(/^﻿/, ''))

    for (const { file } of metadata.jars ?? []) {
      const nested = zip.get(file)
      if (!nested || !file.endsWith('.jar')) continue
      const child = visit(nested())
      if (!child) continue

      for (const id of [child.id, ...(child.provides ?? [])]) {
        if (!MOD_ID.test(id)) throw new Error(`Bad mod id ${id} in ${file}`)
      }

      found.set(child.id, { id: child.id, version: String(child.version), provides: [...(child.provides ?? [])].sort() })
    }

    return metadata
  }

  visit(jar)
  return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * What Fabric API's build.gradle nests: every subproject in settings.gradle except the meta
 * projects and devOnlyModules, each at "<gradle.properties version>+<first 8 of the last commit
 * touching a path of the module's name><first 2 of sha256(minecraft_version)>"
 * (getSubprojectVersion; git runs in the root, so deprecated modules match their old path).
 */
async function modulesFromSource(version, dir) {
  const git = (...gitArgs) => execFileSync('git', ['-C', dir, ...gitArgs], { encoding: 'utf8' }).trim()

  if (git('rev-parse', '--is-shallow-repository') !== 'false') {
    throw new Error(`${dir} is a shallow clone: the module versions need the full history`)
  }

  const properties = new Map(
    (await readFile(join(dir, 'gradle.properties'), 'utf8'))
      .split('\n')
      .map((line) => /^([^#=\s]+)\s*=\s*(.*)$/.exec(line.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]])
  )
  const release = `${properties.get('version')}+${properties.get('minecraft_version')}`

  if (release !== version) {
    throw new Error(`${dir} is Fabric API ${release}, not ${version}`)
  }

  const build = await readFile(join(dir, 'build.gradle'), 'utf8')
  const listed = (name) => [...(new RegExp(`def ${name} = \\[([^\\]]*)\\]`).exec(build)?.[1] ?? '').matchAll(/["']([^"']+)["']/g)].map((m) => m[1])
  const skip = new Set([...listed('metaProjects'), ...listed('devOnlyModules')])

  if (!skip.has('fabric-client-gametest-api-v1')) {
    throw new Error("Couldn't read devOnlyModules from build.gradle")
  }

  const suffix = createHash('sha256').update(properties.get('minecraft_version')).digest('hex').slice(0, 2)
  const settings = await readFile(join(dir, 'settings.gradle'), 'utf8')
  const modules = []

  for (const [, path] of settings.matchAll(/^include ['"]([^'"]+)['"]/gm)) {
    const name = path.split(':').pop()

    if (skip.has(name)) continue

    const base = properties.get(`${name}-version`)
    if (!base) throw new Error(`No version for ${name} in gradle.properties`)
    // Client-only modules keep theirs in the client source set.
    const moduleDir = join(dir, ...path.split(':'))
    const text = await readFile(join(moduleDir, 'src/main/resources/fabric.mod.json'), 'utf8').catch(() => readFile(join(moduleDir, 'src/client/resources/fabric.mod.json'), 'utf8'))
    const metadata = JSON.parse(text)
    if (metadata.id !== name) throw new Error(`${path}: id ${metadata.id}`)
    const hash = git('log', '-1', '--format=%H', '--', name)
    modules.push({ id: name, version: `${base}+${hash.slice(0, 8)}${suffix}`, provides: [...(metadata.provides ?? [])].sort() })
  }

  return modules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** The entries of a zip by name, each read on demand. Stored and deflated entries only. */
function readZip(buffer) {
  let eocd = -1

  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }

  if (eocd < 0) throw new Error('Not a zip file')

  const count = buffer.readUInt16LE(eocd + 10)
  let at = buffer.readUInt32LE(eocd + 16)
  const entries = new Map()

  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('Damaged zip directory')
    const method = buffer.readUInt16LE(at + 10)
    const compressedSize = buffer.readUInt32LE(at + 20)
    const nameLength = buffer.readUInt16LE(at + 28)
    const extraLength = buffer.readUInt16LE(at + 30)
    const commentLength = buffer.readUInt16LE(at + 32)
    const local = buffer.readUInt32LE(at + 42)
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength)

    entries.set(name, () => {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
      const raw = buffer.subarray(start, start + compressedSize)
      if (method === 0) return raw
      if (method === 8) return inflateRawSync(raw)
      throw new Error(`${name}: unsupported compression method ${method}`)
    })
    at += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

function render(rows) {
  const body = rows
    .map(([version, modules]) => {
      const lines = modules.map((m) => `    { id: '${m.id}', version: '${m.version}', provides: [${m.provides.map((p) => `'${p}'`).join(', ')}] }`)
      return `  '${version}': [\n${lines.join(',\n')}\n  ]`
    })
    .join(',\n')

  return `/**
 * The mods nested in each pinned Fabric API jar (id, version, provides), so the mod check knows
 * what Fabric API provides before it is downloaded. Generated by scripts/fabric-api-modules.mjs
 * from the released jar (or from Fabric API's sources at the release tag); don't edit by hand.
 */
export interface FabricModuleSpec {
  id: string
  version: string
  provides: string[]
}

export const FABRIC_API_MODULES: Readonly<Record<string, readonly FabricModuleSpec[]>> = {
${body}
}
`
}

function splitOnce(text, separator) {
  const at = text.indexOf(separator)
  if (at < 0) throw new Error(`Expected <version>${separator}<path>, got ${text}`)
  return [text.slice(0, at), text.slice(at + 1)]
}
