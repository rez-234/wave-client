package dev.waveclient.module.impl.camera;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;

import dev.waveclient.input.HoldToggle;
import dev.waveclient.input.KeyMode;
import dev.waveclient.input.Keybind;
import dev.waveclient.module.Category;
import dev.waveclient.module.Module;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.setting.KeybindSetting;
import dev.waveclient.setting.Setting;

/**
 * Freelook: while the key is held, the camera orbits your character in third person and the
 * mouse turns the camera instead of you. Releasing snaps back. Some servers don't allow it
 * (Hypixel), so the server policy turns it off there.
 */
public final class FreelookModule extends Module {
	private static final int GLFW_KEY_LEFT_ALT = 342;

	public final KeybindSetting freelookKey = add(new KeybindSetting("freelookKey", "Freelook key", Keybind.key(GLFW_KEY_LEFT_ALT))
			.describe("Look around your character while held (or toggled, depending on Key mode)."));
	public final EnumSetting<KeyMode> keyMode = add(new EnumSetting<>("keyMode", "Key mode", KeyMode.HOLD));
	public final BooleanSetting invertPitch = add(new BooleanSetting("invertPitch", "Invert up and down", false)
			.describe("Flip vertical mouse movement while freelooking only."));

	private final HoldToggle hold = new HoldToggle();
	private final FreelookCamera camera = new FreelookCamera();
	private LocalPlayer startedFor;

	public FreelookModule() {
		super("freelook", "Freelook", "Look around your character without turning, while a key is held.", Category.CAMERA);
		freelookKey.onPress(this::pressed).onRelease(this::released);
	}

	public boolean isFreelooking() {
		return camera.active();
	}

	/** Mouse movement while freelooking (from MouseHandlerMixin), already scaled for sensitivity. */
	public void turn(double dx, double dy) {
		camera.turn(dx, dy, invertPitch.get());
		CameraHooks.setAngles(camera.yaw(), camera.pitch());
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

		// Only around yourself: not while spectating another entity or asleep.
		if (player == null || minecraft.getCameraEntity() != player || player.isSleeping()) {
			hold.reset();
			return;
		}

		camera.start(player.getYRot(), player.getXRot());
		startedFor = player;
		CameraHooks.setFreelook(true, camera.yaw(), camera.pitch());
	}

	/** Ends freelook; the camera snaps back to where you face. */
	public void stop() {
		hold.reset();

		if (camera.active()) {
			camera.stop();
			startedFor = null;
			CameraHooks.setFreelook(false, 0, 0);
		}
	}

	@Override
	protected void onTick() {
		if (!camera.active()) {
			return;
		}

		Minecraft minecraft = Minecraft.getInstance();
		LocalPlayer player = minecraft.player;

		// A respawn or dimension change creates a new player; death, sleep or spectating end it too.
		if (player == null || player != startedFor || minecraft.getCameraEntity() != player || player.isDeadOrDying() || player.isSleeping()) {
			stop();
		}
	}

	@Override
	protected void onSettingChanged(Setting<?> setting) {
		if (setting == keyMode && !hold.modeChanged(keyMode.get(), freelookKey.isDown())) {
			stop();
		}
	}

	/** Also runs when a server blocks freelook while it is in use. */
	@Override
	protected void onDisable() {
		stop();
	}
}
