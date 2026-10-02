package dev.waveclient.gui.theme;

/**
 * Colors shared with the launcher, as opaque ARGB. Mirrors {@code shared/design-tokens.json};
 * ThemeTokensTest fails the build if the two drift apart.
 */
public final class Theme {
	public static final int BACKGROUND = 0xFF0F1012;
	public static final int SURFACE = 0xFF17181B;
	public static final int SURFACE_RAISED = 0xFF1F2024;
	public static final int BORDER = 0xFF2A2B30;
	public static final int TEXT = 0xFFE6E6E8;
	public static final int TEXT_MUTED = 0xFF9A9BA1;
	public static final int ACCENT = 0xFF5B8CFF;
	public static final int DANGER = 0xFFE5484D;

	private Theme() {
	}

	/** The same color with a different alpha (0-255). */
	public static int withAlpha(int argb, int alpha) {
		return (Math.max(0, Math.min(255, alpha)) << 24) | (argb & 0x00FFFFFF);
	}
}
