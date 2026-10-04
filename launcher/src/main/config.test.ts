import { describe, expect, it } from 'vitest'

import { isAllowedExternalUrl, msaClientId } from './config'

describe('msaClientId', () => {
  it('prefers a valid runtime id, then the build-time one', () => {
    expect(msaClientId('11111111-2222-3333-4444-555555555555', '66666666-7777-8888-9999-000000000000')).toBe('11111111-2222-3333-4444-555555555555')
    expect(msaClientId('not-a-guid', 'AAAAAAAA-7777-8888-9999-000000000000')).toBe('aaaaaaaa-7777-8888-9999-000000000000')
    expect(msaClientId(undefined, '')).toBeNull()
  })
})

describe('isAllowedExternalUrl', () => {
  it('allows https pages on known hosts only', () => {
    expect(isAllowedExternalUrl('https://aka.ms/mce-reviewappid')).toBe(true)
    expect(isAllowedExternalUrl('https://www.microsoft.com/link')).toBe(true)
    expect(isAllowedExternalUrl('https://help.minecraft.net/hc/en-us/articles/1')).toBe(true)
    expect(isAllowedExternalUrl('http://www.microsoft.com/link')).toBe(false)
    expect(isAllowedExternalUrl('https://microsoft.com.evil.example/')).toBe(false)
    expect(isAllowedExternalUrl('https://evilmicrosoft.com/')).toBe(false)
    expect(isAllowedExternalUrl('https://user@www.microsoft.com/')).toBe(false)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl(42)).toBe(false)
  })
})
