/**
 * Electron wraps errors thrown by main-process handlers:
 * "Error invoking remote method 'game:launch': Error: Minecraft is already starting or running."
 * The part after the prefix is the message written for players.
 */
const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/

const FALLBACK = 'Something went wrong. Please try again.'

/** A message to show for a rejected wave.* call (or anything else thrown). */
export function errorMessage(error: unknown, fallback = FALLBACK): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const message = raw.replace(IPC_PREFIX, '').trim()

  if (message === '' || message === 'Refused') {
    return fallback
  }

  return message
}
