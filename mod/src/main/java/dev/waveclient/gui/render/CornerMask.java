package dev.waveclient.gui.render;

/**
 * Anti-aliased coverage of one rounded corner, precomputed per radius so drawing a rounded
 * rectangle needs no math or allocation per frame.
 *
 * <p>Row {@code i} and column {@code j} count from the corner's outer edges, so (0, 0) is the
 * pixel at the very corner. In each row, pixels from {@link #solidFrom(int)} inwards are fully
 * covered; the pixels before that have partial coverage {@link #coverage(int, int)} (0 to 1).
 */
public final class CornerMask {
	private static final int SUBSAMPLES = 4;
	private static final int MAX_CACHED_RADIUS = 64;
	private static final CornerMask[] CACHE = new CornerMask[MAX_CACHED_RADIUS + 1];

	private final int radius;
	private final int[] solidFrom;
	private final float[][] coverage;

	private CornerMask(int radius) {
		this.radius = radius;
		this.solidFrom = new int[radius];
		this.coverage = new float[radius][radius];
		double r2 = (double) radius * radius;

		for (int i = 0; i < radius; i++) {
			int solid = radius;

			for (int j = radius - 1; j >= 0; j--) {
				int inside = 0;

				for (int sy = 0; sy < SUBSAMPLES; sy++) {
					double dy = radius - (i + (sy + 0.5) / SUBSAMPLES);

					for (int sx = 0; sx < SUBSAMPLES; sx++) {
						double dx = radius - (j + (sx + 0.5) / SUBSAMPLES);

						if (dx * dx + dy * dy <= r2) {
							inside++;
						}
					}
				}

				coverage[i][j] = inside / (float) (SUBSAMPLES * SUBSAMPLES);

				if (inside == SUBSAMPLES * SUBSAMPLES && solid == j + 1) {
					solid = j;
				}
			}

			solidFrom[i] = solid;
		}
	}

	/** The mask for {@code radius} pixels (clamped to 0..64). */
	public static CornerMask of(int radius) {
		int r = Math.max(0, Math.min(MAX_CACHED_RADIUS, radius));
		CornerMask mask = CACHE[r];

		if (mask == null) {
			mask = new CornerMask(r);
			CACHE[r] = mask;
		}

		return mask;
	}

	public int radius() {
		return radius;
	}

	/** First column of row {@code row} that is fully covered (equals the radius if none is). */
	public int solidFrom(int row) {
		return solidFrom[row];
	}

	/** Coverage of the pixel at {@code row}, {@code column}, from 0 to 1. */
	public float coverage(int row, int column) {
		return coverage[row][column];
	}
}
