package dev.waveclient.gui;

import java.util.List;

/**
 * Finds a free spot for the pause menu's Wave Client button, so it never covers a vanilla
 * button or one added by another mod (Mod Menu moves things around in several ways).
 *
 * <p>Tried in order: just left of "Options...", just right of the last button on that row, the
 * top-right corner. The first spot that is on screen and overlaps no visible button wins.
 */
public final class ButtonPlacement {
	/** Gap between our button and the one it sits beside, like vanilla's language button. */
	public static final int GAP = 4;
	public static final int SIZE = 20;

	public record Rect(int x, int y, int width, int height) {
		public int right() {
			return x + width;
		}

		public int bottom() {
			return y + height;
		}

		/** Strict overlap: rectangles that only touch don't count. */
		public boolean intersects(Rect other) {
			return x < other.right() && other.x < right() && y < other.bottom() && other.y < bottom();
		}
	}

	private ButtonPlacement() {
	}

	/**
	 * @param options the "Options..." button
	 * @param visible every visible button on the screen, including {@code options}
	 * @return where to put the button, or {@code null} if there is no free spot
	 */
	public static Rect choose(Rect options, List<Rect> visible, int screenWidth, int screenHeight) {
		int rowRight = options.right();

		for (Rect button : visible) {
			if (button.y() == options.y()) {
				rowRight = Math.max(rowRight, button.right());
			}
		}

		Rect[] candidates = {
				new Rect(options.x() - GAP - SIZE, options.y(), SIZE, SIZE),
				new Rect(rowRight + GAP, options.y(), SIZE, SIZE),
				new Rect(screenWidth - GAP - SIZE, GAP, SIZE, SIZE),
		};

		for (Rect candidate : candidates) {
			if (fits(candidate, visible, screenWidth, screenHeight)) {
				return candidate;
			}
		}

		return null;
	}

	private static boolean fits(Rect candidate, List<Rect> visible, int screenWidth, int screenHeight) {
		if (candidate.x() < 0 || candidate.y() < 0 || candidate.right() > screenWidth || candidate.bottom() > screenHeight) {
			return false;
		}

		for (Rect button : visible) {
			if (button.intersects(candidate)) {
				return false;
			}
		}

		return true;
	}
}
