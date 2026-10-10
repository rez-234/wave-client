import { describe, expect, it } from 'vitest'

import { errorMessage } from './errors'

describe('errorMessage', () => {
  it("strips Electron's remote method prefix", () => {
    expect(errorMessage(new Error("Error invoking remote method 'game:launch': Error: Minecraft is already starting or running."))).toBe(
      'Minecraft is already starting or running.'
    )
    expect(errorMessage(new Error("Error invoking remote method 'settings:pick-java': TypeError: bad"))).toBe('bad')
  })

  it('keeps plain messages', () => {
    expect(errorMessage(new Error('Your disk is full.'))).toBe('Your disk is full.')
    expect(errorMessage('Just text')).toBe('Just text')
  })

  it('falls back for empty, refused or unknown errors', () => {
    expect(errorMessage(new Error(''))).toBe('Something went wrong. Please try again.')
    expect(errorMessage(new Error("Error invoking remote method 'app:info': Error: Refused"))).toBe('Something went wrong. Please try again.')
    expect(errorMessage({ weird: true }, 'Fallback')).toBe('Fallback')
    expect(errorMessage(undefined)).toBe('Something went wrong. Please try again.')
  })
})
