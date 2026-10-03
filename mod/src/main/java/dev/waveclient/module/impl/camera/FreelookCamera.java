package dev.waveclient.module.impl.camera;

/**
 * The camera angles while freelooking. Turned by the same mouse deltas that would turn the
 * player (already scaled for sensitivity and inverted by the game's options), with the same
 * factor and pitch limit as {@code Entity.turn}.
 */
public final class FreelookCamera {
	private static final float DEGREES_PER_UNIT = 0.15F;

	private boolean active;
	private float yaw;
	private float pitch;

	public void start(float yaw, float pitch) {
		this.active = true;
		this.yaw = yaw;
		this.pitch = clampPitch(pitch);
	}

	public void stop() {
		active = false;
	}

	public boolean active() {
		return active;
	}

	public float yaw() {
		return yaw;
	}

	public float pitch() {
		return pitch;
	}

	/** @param invertPitch flips vertical movement for freelook only */
	public void turn(double dx, double dy, boolean invertPitch) {
		if (!active) {
			return;
		}

		yaw += (float) dx * DEGREES_PER_UNIT;
		pitch = clampPitch(pitch + (float) (invertPitch ? -dy : dy) * DEGREES_PER_UNIT);
	}

	private static float clampPitch(float value) {
		return Math.max(-90.0F, Math.min(90.0F, value));
	}
}
