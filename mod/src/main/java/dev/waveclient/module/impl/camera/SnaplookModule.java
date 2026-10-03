package dev.waveclient.module.impl.camera;

import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;

import dev.waveclient.input.HoldToggle;
import dev.waveclient.input.KeyMode;
import dev.waveclient.input.Keybind;
import dev.waveclient.module.Category;
import dev.waveclient.module.Module;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.setting.KeybindSetting;
import dev.waveclient.setting.Setting;

/**
 * Snaplook: third person while a key is held, like holding F5. The mouse still turns you as
 * normal, and your perspective setting is untouched, so releasing returns to it.
 */
public final class SnaplookModule extends Module {
	public enum View implements EnumSetting.Labeled {
		FRONT("Front (look behind you)", CameraType.THIRD_PERSON_FRONT),
		BACK("Back", CameraType.THIRD_PERSON_BACK);

		private final String label;
		private final CameraType camera;

		View(String label, CameraType camera) {
			this.label = label;
			this.camera = camera;
		}

		@Override
		public String label() {
			return label;
		}
	}

	public final KeybindSetting snaplookKey = add(new KeybindSetting("snaplookKey", "Snaplook key", Keybind.NONE)
			.describe("Switch to third person while held (or toggled, depending on Key mode)."));
	public final EnumSetting<KeyMode> keyMode = add(new EnumSetting<>("keyMode", "Key mode", KeyMode.HOLD));
	public final EnumSetting<View> view = add(new EnumSetting<>("view", "View", View.FRONT));

	private final HoldToggle hold = new HoldToggle();
	private LocalPlayer startedFor;

	public SnaplookModule() {
		super("snaplook", "Snaplook", "Third person while a key is held, like holding F5.", Category.CAMERA);
		snaplookKey.onPress(this::pressed).onRelease(this::released);
	}

	private void pressed() {
		if (!isActive()) {
			return;
		}

		if (hold.press(keyMode.get())) {
			start();
		} else {
			stop();
		}
	}

	private void released() {
		if (!hold.release(keyMode.get())) {
			stop();
		}
	}

	private void start() {
		Minecraft minecraft = Minecraft.getInstance();
		LocalPlayer player = minecraft.player;

		if (player == null || minecraft.getCameraEntity() != player || player.isSleeping()) {
			hold.reset();
			return;
		}

		startedFor = player;
		CameraHooks.setSnaplook(view.get().camera);
	}

	public void stop() {
		hold.reset();

		if (startedFor != null) {
			startedFor = null;
			CameraHooks.setSnaplook(null);
		}
	}

	@Override
	protected void onTick() {
		if (startedFor == null) {
			return;
		}

		Minecraft minecraft = Minecraft.getInstance();
		LocalPlayer player = minecraft.player;

		if (player == null || player != startedFor || minecraft.getCameraEntity() != player || player.isDeadOrDying() || player.isSleeping()) {
			stop();
		}
	}

	@Override
	protected void onSettingChanged(Setting<?> setting) {
		if (setting == keyMode && !hold.modeChanged(keyMode.get(), snaplookKey.isDown())) {
			stop();
		} else if (setting == view && startedFor != null) {
			CameraHooks.setSnaplook(view.get().camera);
		}
	}

	@Override
	protected void onDisable() {
		stop();
	}
}
