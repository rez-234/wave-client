package dev.waveclient.gui.theme;

/**
 * The menu's text styles, set in Inter.
 *
 * <p>Minecraft samples font textures with nearest filtering and rasterises a TTF once, at
 * {@code size * oversample} pixels. Text is only sharp when that matches the screen, so every
 * style ships one font definition per GUI scale ({@code assets/waveclient/font/ui/<key>_<scale>.json},
 * each with {@code oversample} equal to the scale) and the menu picks the one for the current
 * scale. At GUI scale 1, Inter is too small to read, so the vanilla font is used instead.
 */
public enum UiFont {
	/**
	 * Regular text. Medium rather than Regular weight: Minecraft's text shader squares glyph
	 * coverage, which makes light-on-dark Regular look thin.
	 */
	BODY("body", "inter-medium.ttf", 8),
	/** Names, labels and buttons. */
	STRONG("strong", "inter-semibold.ttf", 8),
	/** Page titles. */
	HEADING("heading", "inter-semibold.ttf", 10);

	public static final int MIN_SCALE = 2;
	public static final int MAX_SCALE = 10;

	/** Inter's cap height and descender as a fraction of the em size (from its OS/2 and hhea tables). */
	private static final double CAP_HEIGHT = 1490 / 2048.0;
	private static final double DESCENDER = 494 / 2048.0;

	/** Where Minecraft puts the baseline, in GUI pixels below the y passed to drawString. */
	public static final int BASELINE = 7;

	private final String key;
	private final String file;
	private final int size;

	UiFont(String key, String file, int size) {
		this.key = key;
		this.file = file;
		this.size = size;
	}

	/** The TTF file under {@code assets/waveclient/font/inter/}. */
	public String file() {
		return file;
	}

	/** Em size in GUI pixels. */
	public int size() {
		return size;
	}

	/**
	 * Path of the font definition for a GUI scale, relative to {@code assets/waveclient/font/}.
	 * Scales above {@link #MAX_SCALE} use the largest definition.
	 */
	public String definition(int guiScale) {
		return "ui/" + key + "_" + Math.max(MIN_SCALE, Math.min(MAX_SCALE, guiScale));
	}

	/** Whether Inter is used at this GUI scale; otherwise the vanilla font is. */
	public static boolean supports(int guiScale) {
		return guiScale >= MIN_SCALE;
	}

	/**
	 * Height of capital letters in GUI pixels, as rendered at this scale (hinting snaps it to
	 * whole screen pixels).
	 */
	public double capHeight(int guiScale) {
		int scale = Math.max(1, guiScale);
		return Math.round(CAP_HEIGHT * size * scale) / (double) scale;
	}

	/** How far descenders reach below the baseline, in GUI pixels. */
	public double descender() {
		return DESCENDER * size;
	}
}
