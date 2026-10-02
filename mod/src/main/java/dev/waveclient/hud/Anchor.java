package dev.waveclient.hud;

/**
 * One of nine reference points on the screen. A HUD element is positioned by placing the same
 * point of the element at this point of the screen, plus an offset. An element anchored
 * {@link #BOTTOM_RIGHT} therefore keeps its distance to the bottom-right corner at any
 * resolution or GUI scale.
 */
public enum Anchor {
	TOP_LEFT(0, 0),
	TOP_CENTER(0.5, 0),
	TOP_RIGHT(1, 0),
	MIDDLE_LEFT(0, 0.5),
	CENTER(0.5, 0.5),
	MIDDLE_RIGHT(1, 0.5),
	BOTTOM_LEFT(0, 1),
	BOTTOM_CENTER(0.5, 1),
	BOTTOM_RIGHT(1, 1);

	private static final Anchor[] GRID = {
			TOP_LEFT, TOP_CENTER, TOP_RIGHT,
			MIDDLE_LEFT, CENTER, MIDDLE_RIGHT,
			BOTTOM_LEFT, BOTTOM_CENTER, BOTTOM_RIGHT,
	};

	/** Horizontal position of the reference point: 0 = left edge, 0.5 = center, 1 = right edge. */
	public final double fx;
	/** Vertical position of the reference point: 0 = top edge, 0.5 = middle, 1 = bottom edge. */
	public final double fy;

	Anchor(double fx, double fy) {
		this.fx = fx;
		this.fy = fy;
	}

	/**
	 * The anchor for a point at the given fractions of the screen, splitting the screen into
	 * thirds in each direction.
	 */
	public static Anchor nearest(double fractionX, double fractionY) {
		return GRID[third(fractionY) * 3 + third(fractionX)];
	}

	private static int third(double fraction) {
		if (fraction < 1.0 / 3.0) {
			return 0;
		}

		return fraction > 2.0 / 3.0 ? 2 : 1;
	}
}
