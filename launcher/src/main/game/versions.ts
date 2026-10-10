import { FABRIC_API_MODULES, type FabricModuleSpec } from './fabric-api-modules'

/** One Minecraft version Wave Client supports, with the loader, Fabric API and Java it runs with. */
export interface GameVersionSpec {
  minecraft: string
  fabricLoader: string
  /** The MixinExtras version Fabric Loader nests (a mod may bring a newer one). */
  mixinExtras: string
  fabricApi: string
  /** The mods nested in that Fabric API jar. */
  fabricApiModules: readonly FabricModuleSpec[]
  /** Java major version the game needs (Mojang's runtime for it, and the minimum for a chosen Java). */
  java: number
}

/**
 * The versions a profile can use: those the Wave Client mod is built and tested for. The first is
 * the default for new profiles. Adding a version means building the mod for it too.
 */
export const GAME_VERSIONS: readonly GameVersionSpec[] = [
  {
    minecraft: '1.21.11',
    fabricLoader: '0.19.5',
    mixinExtras: '0.5.5',
    fabricApi: '0.141.6+1.21.11',
    fabricApiModules: FABRIC_API_MODULES['0.141.6+1.21.11'] ?? [],
    java: 21
  }
]

export const DEFAULT_GAME_VERSION: GameVersionSpec = GAME_VERSIONS[0]!

export function findGameVersion(minecraft: string): GameVersionSpec | undefined {
  return GAME_VERSIONS.find((spec) => spec.minecraft === minecraft)
}
