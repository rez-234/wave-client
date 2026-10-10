import { DEFAULT_GAME_VERSION } from './versions'

/**
 * The default game, loader and Fabric API versions: the ones the mod is built and tested against
 * (mod/gradle.properties; pins.test.ts fails if they drift).
 */
export const PINS = {
  minecraft: DEFAULT_GAME_VERSION.minecraft,
  fabricLoader: DEFAULT_GAME_VERSION.fabricLoader,
  fabricApi: DEFAULT_GAME_VERSION.fabricApi
} as const
