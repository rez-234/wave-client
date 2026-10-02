package dev.waveclient.compat;

import com.terraformersmc.modmenu.api.ConfigScreenFactory;
import com.terraformersmc.modmenu.api.ModMenuApi;

import dev.waveclient.WaveClient;
import dev.waveclient.gui.menu.ModMenuScreen;

/**
 * Makes Mod Menu's "Configure" button for Wave Client open our menu. Loaded only by Mod Menu,
 * through the {@code modmenu} entrypoint, so it costs nothing without it.
 */
public final class ModMenuIntegration implements ModMenuApi {
	@Override
	public ConfigScreenFactory<?> getModConfigScreenFactory() {
		return parent -> new ModMenuScreen(WaveClient.get(), parent);
	}
}
