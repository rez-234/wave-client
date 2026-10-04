import { describe, expect, it } from 'vitest'

import { mavenKey, mavenPath, mavenUrl, parseMaven } from './maven'

describe('maven coordinates', () => {
  it('parses plain, classifier and extension forms', () => {
    expect(parseMaven('net.fabricmc:fabric-loader:0.19.5')).toEqual({
      group: 'net.fabricmc',
      artifact: 'fabric-loader',
      version: '0.19.5',
      classifier: null,
      extension: 'jar'
    })
    expect(parseMaven('org.lwjgl:lwjgl:3.3.3:natives-windows')).toMatchObject({ classifier: 'natives-windows', extension: 'jar' })
    expect(parseMaven('a.b:c:1@zip')).toMatchObject({ classifier: null, extension: 'zip' })
  })

  it('builds paths and URLs', () => {
    expect(mavenPath(parseMaven('org.lwjgl:lwjgl:3.3.3:natives-windows'))).toBe('org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar')
    expect(mavenUrl('https://maven.fabricmc.net', parseMaven('net.fabricmc.fabric-api:fabric-api:0.141.6+1.21.11'))).toBe(
      'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/0.141.6%2B1.21.11/fabric-api-0.141.6%2B1.21.11.jar'
    )
  })

  it('keys libraries without their version', () => {
    expect(mavenKey(parseMaven('org.ow2.asm:asm:9.6'))).toBe(mavenKey(parseMaven('org.ow2.asm:asm:9.8')))
    expect(mavenKey(parseMaven('org.lwjgl:lwjgl:3.3.3'))).not.toBe(mavenKey(parseMaven('org.lwjgl:lwjgl:3.3.3:natives-linux')))
  })

  it('rejects malformed or path-escaping coordinates', () => {
    for (const bad of ['a:b', 'a:b:c:d:e', 'a::1', 'a:../../x:1', 'a:b:..', 'a:b:1@']) {
      expect(() => parseMaven(bad), bad).toThrow()
    }
  })
})
