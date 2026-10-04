import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * A random id for this installation, passed to the game as --clientId (base64, like the official
 * launcher's client token). Not a secret and not linked to the account.
 */
export async function loadClientId(file: string): Promise<string> {
  let id: string

  try {
    id = (await readFile(file, 'utf8')).trim()
  } catch {
    id = ''
  }

  if (!/^[0-9a-f-]{36}$/.test(id)) {
    id = randomUUID()
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, id)
  }

  return Buffer.from(id).toString('base64')
}
