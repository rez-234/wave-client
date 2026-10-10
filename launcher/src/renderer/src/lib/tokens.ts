/** The parts of shared/design-tokens.json the launcher uses. */
export interface DesignTokens {
  color: Record<string, string>
  font: { ui: string; mono: string }
  space: readonly number[]
  radius: Record<string, number>
}

const UI_FALLBACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
/** The mono token's font isn't bundled, so a system monospace face stands in when it's not installed. */
const MONO_FALLBACK = 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Consolas, "Liberation Mono", "DejaVu Sans Mono", Menlo, monospace'

/** "surfaceRaised" → "surface-raised". */
export function kebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}

function quoteFamily(family: string): string {
  return /^[\w-]+$/.test(family) && !/^\d/.test(family) ? family : `"${family.replace(/["\\]/g, '')}"`
}

/**
 * The tokens as CSS custom properties: --color-surface-raised, --font-ui, --space-1 (the first
 * spacing step) to --space-6, --radius-small. Set on :root at startup so the stylesheet and the
 * mod share one source of truth.
 */
export function cssVariables(tokens: DesignTokens): Record<string, string> {
  const variables: Record<string, string> = {}

  for (const [name, value] of Object.entries(tokens.color)) {
    variables[`--color-${kebabCase(name)}`] = value
  }

  variables['--font-ui'] = `${quoteFamily(tokens.font.ui)}, ${UI_FALLBACK}`
  variables['--font-mono'] = `${quoteFamily(tokens.font.mono)}, ${MONO_FALLBACK}`

  tokens.space.forEach((value, index) => {
    variables[`--space-${index + 1}`] = `${value}px`
  })

  for (const [name, value] of Object.entries(tokens.radius)) {
    variables[`--radius-${kebabCase(name)}`] = `${value}px`
  }

  return variables
}
