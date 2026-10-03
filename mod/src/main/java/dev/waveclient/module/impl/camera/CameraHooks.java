package dev.waveclient.module.impl.camera;

import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;

import dev.waveclient.WaveClient;
import dev.waveclient.mixin.OptionsAccessor;

/**
 * State read by the camera mixins every frame, kept in plain static fields so the hot paths
 * (Options.getCameraType is called per particle) are a single field read.
 *
 * <p>The player's perspective option is never written: while freelook or snaplook is engaged,
 * getCameraType() returns {@link #override} instead. Freelook wins if both are engaged.
 */
public final class CameraHooks {
	/** The perspective to report instead of the player's own, or {@code null}. */
	public static CameraType override;
	/** Whether the camera's rotation comes from {@link #yaw} and {@link #pitch}. */
	public static boolean freelook;
	public static float yaw;
	public static float pitch;

	private static CameraType freelookView;
	private static CameraType snaplookView;

	private CameraHooks() {
	}

	static void setFreelook(boolean on, float startYaw, float startPitch) {
		freelook = on;
		yaw = startYaw;
		pitch = startPitch;
		freelookView = on ? CameraType.THIRD_PERSON_BACK : null;
		apply();
	}

	static void setAngles(float newYaw, float newPitch) {
		yaw = newYaw;
		pitch = newPitch;
	}

	static void setSnaplook(CameraType view) {
		snaplookView = view;
		apply();
	}

	private static void apply() {
		CameraType wanted = freelookView != null ? freelookView : snaplookView;

		if (wanted == override) {
			return;
		}

		Minecraft minecraft = Minecraft.getInstance();
		boolean wasFirstPerson = effective(minecraft).isFirstPerson();
		override = wanted;

		// Like vanilla's F5: switching between first and third person needs a chunk visibility
		// update (Sodium hooks this to reschedule its terrain).
		if (wasFirstPerson != effective(minecraft).isFirstPerson() && minecraft.levelRenderer != null) {
			minecraft.levelRenderer.needsUpdate();
		}
	}

	private static CameraType effective(Minecraft minecraft) {
		return override != null ? override : ((OptionsAccessor) minecraft.options).waveclient$rawCameraType();
	}

	/** F5 was pressed: it changes the player's real perspective, so freelook and snaplook end. */
	public static void onVanillaPerspectiveCycle() {
		WaveClient wave = WaveClient.get();

		if (wave != null) {
			wave.freelook().stop();
			wave.snaplook().stop();
		}
	}
}
