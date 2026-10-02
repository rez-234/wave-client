package com.terraformersmc.modmenu.api;

/**
 * Compile-time stand-in for Mod Menu's API, so the mod builds without downloading Mod Menu.
 * Only what Wave Client implements is declared, with Mod Menu 17's signatures; at runtime the
 * real interface from Mod Menu's jar is used, and without Mod Menu this is never loaded.
 * Not packaged into the mod jar.
 */
public interface ModMenuApi {
	default ConfigScreenFactory<?> getModConfigScreenFactory() {
		throw new AssertionError("compile-time stub");
	}
}
