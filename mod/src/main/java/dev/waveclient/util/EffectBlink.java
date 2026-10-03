package dev.waveclient.util;

/** How visible an effect's icon is: vanilla's blink during an effect's last ten seconds. */
public final class EffectBlink {
	/** Vanilla starts blinking when this many ticks are left. */
	public static final int BLINK_TICKS = 200;

	private EffectBlink() {
	}

	/**
	 * The icon's opacity, 0 to 1, the same as the vanilla HUD's.
	 *
	 * @param duration ticks left, or -1 for an infinite effect
	 * @param ambient  from a beacon or conduit, which never blinks
	 */
	public static float alpha(int duration, boolean ambient) {
		if (ambient || duration < 0 || duration > BLINK_TICKS) {
			return 1.0F;
		}

		int countdown = 10 - duration / 20;
		float alpha = clamp(duration / 10.0F / 5.0F * 0.5F, 0.0F, 0.5F)
				+ (float) Math.cos(duration * Math.PI / 5.0) * clamp(countdown / 10.0F * 0.25F, 0.0F, 0.25F);
		return clamp(alpha, 0.0F, 1.0F);
	}

	private static float clamp(float value, float min, float max) {
		return value < min ? min : value > max ? max : value;
	}
}
