package dev.waveclient.module.impl.render;

/**
 * The maths behind motion blur: each frame is blended with the image kept from the frames
 * before it.
 *
 * <p>Strength is how much of the previous image is kept per 1/60 s. The weight used for an
 * actual frame is scaled by its duration, so the trail lasts the same time at any frame rate:
 * two frames at 120 FPS fade as much as one at 60.
 */
public final class MotionBlurMath {
	public static final double REFERENCE_FRAME_SECONDS = 1.0 / 60;
	/** Stronger blends leave the image smeared for most of a second. */
	public static final double MAX_STRENGTH = 0.95;
	private static final double MIN_FRAME_SECONDS = 0.0005;
	private static final double MAX_FRAME_SECONDS = 1.0;

	private MotionBlurMath() {
	}

	/**
	 * How much of the kept image to blend into this frame, 0 to 1.
	 *
	 * @param frameSeconds time since the previous blended frame; NaN if unknown
	 * @param strength     share of the image kept per 1/60 s
	 */
	public static double historyWeight(double frameSeconds, double strength) {
		// NaN fails the comparison and counts as no blur.
		double s = strength > 0 ? Math.min(strength, MAX_STRENGTH) : 0;

		if (s <= 0) {
			return 0;
		}

		double seconds = Double.isFinite(frameSeconds) ? Math.max(MIN_FRAME_SECONDS, Math.min(MAX_FRAME_SECONDS, frameSeconds)) : REFERENCE_FRAME_SECONDS;
		return Math.pow(s, seconds / REFERENCE_FRAME_SECONDS);
	}

	/** How long a change takes to fade to about a third, in milliseconds. */
	public static double timeConstantMillis(double strength) {
		double s = Math.max(0.01, Math.min(strength, MAX_STRENGTH));
		return -1000 * REFERENCE_FRAME_SECONDS / Math.log(s);
	}

	/**
	 * One 8-bit color channel through the shader's blend (motion_blur.fsh), for testing. The kept
	 * image is 8-bit, so a change smaller than half a step would round back to the old value and
	 * leave a ghost forever. The blend therefore always moves at least one step toward the
	 * current frame, without overshooting it.
	 *
	 * @param linearLight blend squared values, as the "natural blending" setting does
	 */
	public static int accumulate8(int history, int current, double weight, boolean linearLight) {
		double previous = history / 255.0;
		double now = current / 255.0;
		double blended = linearLight
				? Math.sqrt(now * now + (previous * previous - now * now) * weight)
				: now + (previous - now) * weight;
		double delta = now - previous;
		double change = Math.max(Math.abs(blended - previous), Math.min(Math.abs(delta), 1.0 / 255));
		double result = previous + Math.signum(delta) * change;
		return (int) Math.floor(result * 255 + 0.5);
	}
}
