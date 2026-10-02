package dev.waveclient.gui.widget;

/** Frame-rate independent easing for small UI transitions. */
public final class Anim {
	private Anim() {
	}

	/**
	 * Moves {@code current} towards {@code target} exponentially, at {@code rate} per second,
	 * landing exactly on it once close.
	 */
	public static float approach(float current, float target, float seconds, float rate) {
		if (!(seconds > 0)) {
			return current;
		}

		float next = current + (target - current) * (1 - (float) Math.exp(-rate * Math.min(seconds, 0.25f)));
		return Math.abs(target - next) < 0.002f ? target : next;
	}
}
