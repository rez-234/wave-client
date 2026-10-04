/** Small text formatting helpers shared by the views. Pure, so they're unit tested. */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * A byte count for people: "512 B", "1.5 KB", "41.2 MB". Uses 1024-based units, like the
 * operating system's file manager on Windows, with one decimal from KB up.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B'
  }

  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit++
  }

  // 1023.96 KB would round to "1024.0 KB"; show the next unit instead.
  if (unit > 0 && unit < BYTE_UNITS.length - 1 && Number(value.toFixed(1)) >= 1024) {
    value /= 1024
    unit++
  }

  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${BYTE_UNITS[unit]}`
}

/** A memory amount in MiB as gigabytes with one decimal: 4096 → "4.0 GB". */
export function formatMemory(megabytes: number): string {
  const gigabytes = Math.max(0, megabytes) / 1024
  return `${gigabytes.toFixed(1)} GB`
}

/** Time left as "m:ss" (or "h:mm:ss"), never negative. */
export function formatCountdown(milliseconds: number): string {
  const total = Math.max(0, Math.ceil(milliseconds / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const ss = String(seconds).padStart(2, '0')

  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`
}

/** A clock time in the user's time zone, "09:05:03". */
export function formatClock(time: number): string {
  const date = new Date(time)

  if (Number.isNaN(date.getTime())) {
    return '--:--:--'
  }

  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':')
}

/** The letter shown in an account's avatar: the first letter or digit of the name, upper case. */
export function initialOf(name: string): string {
  const match = /[\p{L}\p{N}]/u.exec(name)
  return match ? match[0].toLocaleUpperCase() : '?'
}

/** "1 file", "3 files". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`
}
