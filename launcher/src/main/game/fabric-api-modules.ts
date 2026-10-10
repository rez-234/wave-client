/**
 * The mods nested in each pinned Fabric API jar (id, version, provides), so the mod check knows
 * what Fabric API provides before it is downloaded. Generated from the jar by
 * scripts/fabric-api-modules.mjs; the e2e test checks it against the downloaded jar.
 */
export interface FabricModuleSpec {
  id: string
  version: string
  provides: string[]
}

export const FABRIC_API_MODULES: Readonly<Record<string, readonly FabricModuleSpec[]>> = {
  // Filled in by scripts/fabric-api-modules.mjs.
  '0.141.6+1.21.11': []
}
