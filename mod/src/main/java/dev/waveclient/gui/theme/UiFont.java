package dev.waveclient.gui.theme;

/**
 * The menu's text styles, set in Inter.
 *
 * <p>Minecraft samples font textures with nearest filtering and rasterises a TTF once, at
 * {@code size * oversample} pixels. Text is only sharp when that matches the screen, so every
 * style ships one font definition per GUI scale ({@code assets/waveclient/font/ui/<key>_<scale>.json},
 * each with {@code oversample} equal to the scale) and the menu picks the one for the current
 * scale. At GUI scale 1, Inter is too small to read, so the vanilla font is used instead; see
 * {@link #oversample} for scales above the largest definition.
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
	 * The oversample (and so the font definition) to use at a GUI scale, or 0 for the vanilla
	 * font. Above {@link #MAX_SCALE}, a definition whose oversample divides the scale keeps every
	 * glyph texel a whole block of screen pixels (scale 12 uses 6, 14 uses 7); scales with no such
	 * divisor (11, 13, 17...) use the vanilla font rather than unevenly resampled Inter.
	 */
	public static int oversample(int guiScale) {
		if (guiScale < MIN_SCALE) {
			return 0;
		}

		if (guiScale <= MAX_SCALE) {
			return guiScale;
		}

		for (int candidate = MAX_SCALE; candidate >= MIN_SCALE; candidate--) {
			if (guiScale % candidate == 0) {
				return candidate;
			}
		}

		return 0;
	}

	/** Whether Inter is used at this GUI scale; otherwise the vanilla font is. */
	public static boolean supports(int guiScale) {
		return oversample(guiScale) > 0;
	}

	/**
	 * Path of the font definition for a GUI scale, relative to {@code assets/waveclient/font/}.
	 * Only meaningful when {@link #supports} is true.
	 */
	public String definition(int guiScale) {
		return "ui/" + key + "_" + Math.max(MIN_SCALE, oversample(guiScale));
	}

	/**
	 * Height of capital letters in GUI pixels, as rendered at this scale (hinting snaps it to
	 * whole screen pixels).
	 */
	public double capHeight(int guiScale) {
		int oversample = Math.max(1, oversample(guiScale));
		return Math.round(CAP_HEIGHT * size * oversample) / (double) oversample;
	}

	/** How far descenders reach below the baseline, in GUI pixels. */
	public double descender() {
		return DESCENDER * size;
	}
}
