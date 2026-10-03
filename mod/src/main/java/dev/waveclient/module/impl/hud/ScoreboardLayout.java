package dev.waveclient.module.impl.hud;

/**
 * Where the parts of the sidebar scoreboard go, matching vanilla's layout exactly, relative to the
 * box's top-left corner: a title band, then one 9-pixel row per score, names on the left and
 * scores on the right.
 */
public final class ScoreboardLayout {
	public static final int MAX_ROWS = 15;
	public static final int ROW = 9;
	public static final int TITLE_BAND = 10;
	public static final int PAD = 2;
	public static final int TITLE_Y = 1;

	private ScoreboardLayout() {
	}

	/**
	 * Width of the text area: the title, or the widest row. A row's ": " spacer only counts
	 * when it has a score to show.
	 */
	public static int contentWidth(int titleWidth, int[] nameWidths, int[] scoreWidths, int rows, int spacerWidth) {
		int width = titleWidth;

		for (int i = 0; i < rows; i++) {
			width = Math.max(width, nameWidths[i] + (scoreWidths[i] > 0 ? spacerWidth + scoreWidths[i] : 0));
		}

		return width;
	}

	public static int width(int contentWidth) {
		return contentWidth + 2 * PAD;
	}

	public static int height(int rows) {
		return TITLE_BAND + rows * ROW;
	}

	public static int titleX(int contentWidth, int titleWidth) {
		return PAD + contentWidth / 2 - titleWidth / 2;
	}

	public static int rowY(int row) {
		return TITLE_BAND + row * ROW;
	}

	public static int scoreX(int contentWidth, int scoreWidth) {
		return width(contentWidth) - scoreWidth;
	}

	public static int bodyAlpha(double opacity) {
		return (int) Math.floor(Math.min(1.0, Math.max(0.0, opacity)) * 255.0F);
	}

	/** The title band is a little darker than the body, as in vanilla (0.4 against 0.3); no background means neither. */
	public static int titleAlpha(double opacity) {
		return opacity <= 0 ? 0 : (int) Math.floor(Math.min(1.0, opacity + 0.1) * 255.0F);
	}

	/** Vanilla's order: highest score first, then names alphabetically ignoring case. */
	public static int compare(int valueA, String ownerA, int valueB, String ownerB) {
		return valueA != valueB ? Integer.compare(valueB, valueA) : String.CASE_INSENSITIVE_ORDER.compare(ownerA, ownerB);
	}
}
