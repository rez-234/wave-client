package dev.waveclient;

import dev.waveclient.input.Keybind;
import dev.waveclient.module.SettingContainer;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.setting.KeybindSetting;

/** Client-wide settings that don't belong to a module. Saved under {@code "client"} in the config. */
public final class ClientSettings extends SettingContainer {
	private static final int GLFW_KEY_RIGHT_SHIFT = 344;

	public enum MenuFont implements EnumSetting.Labeled {
		INTER("Inter"),
		MINECRAFT("Minecraft");

		private final String label;

		MenuFont(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	public final KeybindSetting hudEditorKey = add(new KeybindSetting("hudEditorKey", "HUD editor key", Keybind.key(GLFW_KEY_RIGHT_SHIFT))
			.describe("Opens the HUD editor."));

	public final KeybindSetting modMenuKey = add(new KeybindSetting("modMenuKey", "Mod menu key", Keybind.NONE)
			.describe("Opens this menu directly. The HUD editor's Mods button and the pause menu open it too."));

	public final BooleanSetting pauseMenuButton = add(new BooleanSetting("pauseMenuButton", "Pause menu button", true)
			.describe("Show a Wave Client button in the pause menu."));

	public final EnumSetting<MenuFont> menuFont = add(new EnumSetting<>("menuFont", "Menu font", MenuFont.INTER)
			.describe("Inter matches the launcher. At GUI scale 1 (too small for Inter) and a few very large scales (11, 13, 17...) the Minecraft font is always used."));

	public final BooleanSetting hideHudWithDebug = add(new BooleanSetting("hideHudWithDebug", "Hide HUD with F3", true)
			.describe("Hide Wave Client HUD elements while the F3 debug screen is open."));
}
