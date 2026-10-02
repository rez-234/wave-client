package dev.waveclient;

import dev.waveclient.input.Keybind;
import dev.waveclient.module.SettingContainer;
import dev.waveclient.setting.KeybindSetting;

/** Client-wide settings that don't belong to a module. Saved under {@code "client"} in the config. */
public final class ClientSettings extends SettingContainer {
	private static final int GLFW_KEY_RIGHT_SHIFT = 344;

	public final KeybindSetting hudEditorKey = add(new KeybindSetting("hudEditorKey", "HUD editor key", Keybind.key(GLFW_KEY_RIGHT_SHIFT))
			.describe("Opens the HUD editor."));

	public final KeybindSetting modMenuKey = add(new KeybindSetting("modMenuKey", "Mod menu key", Keybind.NONE)
			.describe("Opens the mod menu directly."));
}
