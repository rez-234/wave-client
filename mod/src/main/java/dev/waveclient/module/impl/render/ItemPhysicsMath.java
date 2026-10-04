package dev.waveclient.module.impl.render;

/**
 * The maths for item physics: dropped items lie flat on the ground and tumble while falling.
 * Angles are in radians, lengths in blocks. Everything here works on the item model's bounding
 * box as the game's item renderer sees it (after the "on the ground" display transform).
 */
public final class ItemPhysicsMath {
	/** The game's own cut-off: models thinner than this are flat (stacked copies line up along their depth). */
	public static final float FLAT_DEPTH = 0.0625F;
	/** Gap between the model's lowest point and the ground, so a flat item doesn't flicker into it. */
	public static final float GROUND_GAP = 0.015625F;
	/** Tumble speed at full falling speed, radians per tick. */
	public static final float BASE_SPIN = 0.5F;
	/** Lays a model on its back, front face up. */
	public static final float LAY_FLAT_PITCH = (float) (-Math.PI / 2);
	/** How fast a landed item rolls onto its side instead of snapping, radians per tick. */
	public static final float SETTLE_RATE = 0.35F;
	/**
	 * Longest step the tumble takes in one frame, in ticks: real time down to 5 FPS, while an item
	 * that was off screen for a while doesn't jump far when it comes back.
	 */
	public static final float MAX_STEP_TICKS = 4.0F;
	/** How far the game moves extra copies of a block around the first, in each direction. */
	private static final float BLOCK_JITTER = 0.15F;
	/** The same for copies of a flat item, which are also stacked along their depth. */
	private static final float FLAT_JITTER = 0.075F;

	private static final float TWO_PI = (float) (Math.PI * 2);
	private static final float EPSILON = 1.0E-4F;

	private ItemPhysicsMath() {
	}

	public static boolean isFlat(float depth) {
		return depth <= FLAT_DEPTH;
	}

	/** Half the extra depth the game adds when it draws several copies of a flat item stacked together. */
	public static float flatStackHalfSpread(float depth, int renderedCount) {
		return isFlat(depth) ? depth * 1.5F * (renderedCount - 1) / 2.0F : 0.0F;
	}

	/**
	 * How far to raise the model so its lowest point, once rotated by {@code pitch} about the
	 * center of its box, sits just above the ground, whatever the yaw (yaw doesn't change height).
	 */
	public static float lift(float pitch, float minY, float maxY, float minZ, float maxZ, int renderedCount) {
		float centerY = (minY + maxY) / 2.0F;
		float halfY = (maxY - minY) / 2.0F;
		float halfZ = (maxZ - minZ) / 2.0F + flatStackHalfSpread(maxZ - minZ, renderedCount);
		return GROUND_GAP - centerY + Math.abs((float) Math.cos(pitch)) * halfY + Math.abs((float) Math.sin(pitch)) * halfZ;
	}

	/** The game's random numbers for a stack's copies, in the order it draws them. */
	@FunctionalInterface
	public interface FloatSource {
		float nextFloat();
	}

	/**
	 * How much lower than the first copy the lowest of the other copies of a stack ends up, once
	 * the game's random offset for each copy is applied under the item's pitch (0 if none is
	 * lower). Adding it to {@link #lift} keeps every copy above the ground.
	 *
	 * @param random the game's random source, already seeded with the stack's seed; read exactly
	 *               as the item renderer does (three numbers per extra copy of a block, two of a
	 *               flat item)
	 */
	public static float clusterDrop(float pitch, boolean flat, int renderedCount, FloatSource random) {
		if (renderedCount <= 1) {
			return 0.0F;
		}

		// Rotating by the pitch about X: a model offset (x, y, z) rises by y*cos - z*sin.
		float cos = (float) Math.cos(pitch);
		float sin = (float) Math.sin(pitch);
		float lowest = 0.0F;

		for (int copy = 1; copy < renderedCount; copy++) {
			float rise;

			if (flat) {
				random.nextFloat();
				rise = (random.nextFloat() * 2.0F - 1.0F) * FLAT_JITTER * cos;
			} else {
				random.nextFloat();
				float y = (random.nextFloat() * 2.0F - 1.0F) * BLOCK_JITTER;
				float z = (random.nextFloat() * 2.0F - 1.0F) * BLOCK_JITTER;
				rise = y * cos - z * sin;
			}

			lowest = Math.min(lowest, rise);
		}

		return -lowest;
	}

	/** Tumble speed in radians per tick at {@code speed} blocks per tick; items at rest don't tumble. */
	public static float spinRate(double speed, float multiplier) {
		return BASE_SPIN * multiplier * (float) Math.min(1.0, speed * 2.0);
	}

	/**
	 * The next tumble angle, in [0, 2π). In the air it turns at {@code airRate}; at rest it rolls
	 * forward to the next multiple of {@code period} (π for flat items, which look the same either
	 * way up, π/2 for blocks) and stays there. Time is the entity's age in ticks, so the angle
	 * stops while the game is paused, and a gap (the item was off screen) counts as at most
	 * {@link #MAX_STEP_TICKS}.
	 *
	 * @param lastAge the age at the previous step, or NaN for the first
	 */
	public static float step(float angle, float lastAge, float age, boolean resting, float airRate, float period) {
		if (Float.isNaN(lastAge)) {
			return resting ? 0.0F : angle;
		}

		float ticks = Math.max(0.0F, Math.min(MAX_STEP_TICKS, age - lastAge));

		if (!resting) {
			return wrap(angle + ticks * airRate);
		}

		float target = (float) Math.ceil(angle / period - EPSILON) * period;
		float next = Math.min(target, angle + ticks * SETTLE_RATE);
		return wrap(next >= target - EPSILON ? target : next);
	}

	static float wrap(float angle) {
		float wrapped = angle % TWO_PI;

		if (wrapped < 0) {
			wrapped += TWO_PI;
		}

		// Adding 0 turns -0 (from rounding up a tiny negative) into 0.
		return wrapped > TWO_PI - EPSILON ? 0.0F : wrapped + 0.0F;
	}
}
