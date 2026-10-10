import { describe, expect, it } from 'vitest'

import tokens from '../../../../../shared/design-tokens.json'

import { cssVariables, kebabCase } from './tokens'

describe('kebabCase', () => {
  it('converts camel case names', () => {
    expect(kebabCase('surfaceRaised')).toBe('surface-raised')
    expect(kebabCase('textMuted')).toBe('text-muted')
    expect(kebabCase('accent')).toBe('accent')
  })
})

describe('cssVariables', () => {
  const variables = cssVariables(tokens)

  it('exposes every color token', () => {
    expect(variables['--color-background']).toBe('#0F1012')
    expect(variables['--color-surface-raised']).toBe('#1F2024')
    expect(variables['--color-text-muted']).toBe('#9A9BA1')
    expect(variables['--color-accent']).toBe('#5B8CFF')
    expect(variables['--color-danger']).toBe('#E5484D')
  })

  it('numbers the spacing scale from 1 and adds units', () => {
    expect(variables['--space-1']).toBe('4px')
    expect(variables['--space-6']).toBe('32px')
    expect(variables['--radius-small']).toBe('4px')
    expect(variables['--radius-medium']).toBe('6px')
  })

  it('puts the token fonts first with system fallbacks', () => {
    expect(variables['--font-ui']).toMatch(/^Inter, system-ui/)
    expect(variables['--font-mono']).toMatch(/^"JetBrains Mono", ui-monospace/)
    expect(variables['--font-mono']).toMatch(/monospace$/)
  })
})
