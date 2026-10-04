/**
 * The exact game, loader and Fabric API versions this launcher installs: the ones the mod is
 * built and tested against (mod/gradle.properties; pins.test.ts fails if they drift).
 */
export const PINS = {
  minecraft: '1.21.11',
  fabricLoader: '0.19.5',
  fabricApi: '0.141.6+1.21.11'
} as const
