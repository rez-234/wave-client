import type { AddModsResult, IncludedMod, ModProblem, ModView, ModsReport } from '@shared/ipc'

import { plural } from './format'

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/**
 * By name only (ignoring case, numbers in order), then by key so equal names keep their places.
 * Problems don't move a row: a list that reorders itself after every toggle loses the player's place.
 */
export function sortMods(mods: readonly ModView[]): ModView[] {
  return [...mods].sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.key, b.key))
}

export function hasError(mod: ModView): boolean {
  return mod.problems.some((problem) => problem.severity === 'error')
}

/** Whether a mod matches the search box: its name, mod id, file name or authors contain the text. */
export function matchesModQuery(mod: ModView, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()

  if (needle === '') {
    return true
  }

  return (
    mod.name.toLocaleLowerCase().includes(needle) ||
    (mod.id?.includes(needle) ?? false) ||
    mod.file.toLocaleLowerCase().includes(needle) ||
    mod.authors.some((author) => author.toLocaleLowerCase().includes(needle))
  )
}

/** The rows to show: sorted by name, narrowed by the search and the Problems filter. */
export function visibleMods(mods: readonly ModView[], query: string, problemsOnly: boolean): ModView[] {
  return sortMods(mods.filter((mod) => (!problemsOnly || mod.problems.length > 0) && matchesModQuery(mod, query)))
}

export function matchesIncludedQuery(mod: IncludedMod, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  return needle === '' || mod.name.toLocaleLowerCase().includes(needle) || mod.id.includes(needle)
}

/** The number on the "Problems" chip: mods with an error or a warning. */
export function problemModCount(mods: readonly ModView[]): number {
  return mods.filter((mod) => mod.problems.length > 0).length
}

export interface ModsSummary {
  /** "15 mods, 12 turned on". */
  text: string
  /** "2 mods would stop Minecraft from starting", or null. */
  errors: string | null
  /** "3 mods with warnings", or null. */
  warnings: string | null
}

/** The line above the list. Problems are counted per mod, the way the rows show them. */
export function modsSummary(mods: readonly ModView[]): ModsSummary {
  const on = mods.filter((mod) => mod.enabled).length
  const withErrors = mods.filter(hasError).length
  const withWarnings = mods.filter((mod) => mod.problems.length > 0 && !hasError(mod)).length

  let text: string

  if (mods.length === 0) {
    text = 'No mods yet'
  } else if (on === mods.length) {
    text = mods.length === 1 ? '1 mod, turned on' : `${plural(mods.length, 'mod')}, all turned on`
  } else if (on === 0) {
    text = mods.length === 1 ? '1 mod, turned off' : `${plural(mods.length, 'mod')}, all turned off`
  } else {
    text = `${plural(mods.length, 'mod')}, ${on.toLocaleString('en-US')} turned on`
  }

  return {
    text,
    errors: withErrors > 0 ? `${plural(withErrors, 'mod')} would stop Minecraft from starting` : null,
    warnings: withWarnings > 0 ? `${plural(withWarnings, 'mod')} with warnings` : null
  }
}

/** "Mod Menu needs Cloth Config.", "Mod Menu and Iris need Sodium.", "Mod Menu and 2 others need Cloth Config." */
export function neededByText(name: string, neededBy: readonly string[]): string {
  const [first, second] = neededBy

  if (first === undefined) {
    return ''
  }

  if (second === undefined) {
    return `${first} needs ${name}.`
  }

  if (neededBy.length === 2) {
    return `${first} and ${second} need ${name}.`
  }

  return `${first} and ${neededBy.length - 1} others need ${name}.`
}

/** Turned-on mods with errors: what "Turn them off and play" turns off in one round. */
export function modsToTurnOff(report: ModsReport): ModView[] {
  return sortMods(report.mods.filter((mod) => mod.enabled && hasError(mod)))
}

/** The fixed search page a "missing" problem links to; the main process only opens allow-listed hosts. */
export function modrinthSearchUrl(modId: string): string {
  return `https://modrinth.com/mods?q=${encodeURIComponent(modId)}`
}

/** Whether two reports would draw the same list, so a poll that finds nothing new doesn't re-render. */
export function sameReport(a: ModsReport | null, b: ModsReport | null): boolean {
  return a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b))
}

/** Problems in the order a player should read them: errors first, otherwise as the main process sent them. */
export function orderedProblems(problems: readonly ModProblem[]): ModProblem[] {
  return [...problems.filter((p) => p.severity === 'error'), ...problems.filter((p) => p.severity !== 'error')]
}

/**
 * Compares two mod versions by their leading numbers ("0.6.13+mc1.21.11" → 0, 6, 13), which is all
 * the add toast needs to say "older". 0 when they're equal or can't be compared.
 */
export function compareModVersions(a: string, b: string): number {
  const numbers = (version: string): number[] | null => {
    const match = /^v?(\d+(?:\.\d+)*)/i.exec(version.trim())
    return match?.[1] ? match[1].split('.').map(Number) : null
  }

  const left = numbers(a)
  const right = numbers(b)

  if (!left || !right) {
    return 0
  }

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0)

    if (difference !== 0) {
      return Math.sign(difference)
    }
  }

  return 0
}

type AddedMod = AddModsResult['added'][number]
type SkippedFile = AddModsResult['skipped'][number]

/** "Updated Sodium 0.6.10 → 0.6.13", "Replaced Sodium 0.6.13 with older 0.6.10", "Replaced Sodium 0.6.13". */
export function updateText(mod: AddedMod): string {
  const before = mod.replaced?.version ?? null
  const after = mod.version

  if (before === null || after === null) {
    return `Updated ${mod.name}`
  }

  if (before === after) {
    return `Replaced ${mod.name} ${after}`
  }

  return compareModVersions(after, before) < 0 ? `Replaced ${mod.name} ${before} with older ${after}` : `Updated ${mod.name} ${before} → ${after}`
}

/** A skipped file's reason, naming the file unless the message already does. */
export function skipText(skip: SkippedFile): string {
  const message = skip.message.trim()

  if (skip.name === '' || message.toLocaleLowerCase().includes(skip.name.toLocaleLowerCase())) {
    return message
  }

  return `${skip.name}: ${message}`
}

export interface ToastContent {
  tone: 'success' | 'warn'
  title: string
  lines: string[]
}

/** How many skipped files are spelled out before "and n more". */
const SKIPS_SHOWN = 3

/**
 * The toast after adding mods: what was added, updated and skipped, and why. Null when nothing
 * happened (the file picker was cancelled).
 */
export function addResultToast(result: Pick<AddModsResult, 'added' | 'skipped'>, profileName: string, running: boolean): ToastContent | null {
  const added = result.added.filter((mod) => !mod.replaced)
  const updated = result.added.filter((mod) => mod.replaced)
  const skipped = result.skipped

  if (added.length === 0 && updated.length === 0 && skipped.length === 0) {
    return null
  }

  const lines: string[] = []
  let title: string
  const [firstAdded] = added
  const [firstUpdated] = updated

  if (firstAdded) {
    title = `Added ${added.length === 1 ? firstAdded.name : plural(added.length, 'mod')} to ${profileName}`
    lines.push(...updated.map(updateText))
  } else if (firstUpdated && updated.length === 1) {
    title = `${updateText(firstUpdated)} in ${profileName}`
  } else if (firstUpdated) {
    title = `Updated ${plural(updated.length, 'mod')} in ${profileName}`
    lines.push(...updated.map(updateText))
  } else {
    title = skipped.length === 1 ? `Nothing was added to ${profileName}` : `None of the ${skipped.length} files were added to ${profileName}`
  }

  if (skipped.length > 0) {
    const shown = skipped.slice(0, SKIPS_SHOWN).map(skipText)
    const more = skipped.length - shown.length

    if (firstAdded || firstUpdated) {
      lines.push(`${plural(skipped.length, 'file')} skipped:`)
    }

    lines.push(...shown)

    if (more > 0) {
      lines.push(`And ${plural(more, 'other file')}.`)
    }
  }

  if (running && (firstAdded || firstUpdated)) {
    lines.push('Takes effect next time you play.')
  }

  return { tone: skipped.length > 0 ? 'warn' : 'success', title, lines }
}
