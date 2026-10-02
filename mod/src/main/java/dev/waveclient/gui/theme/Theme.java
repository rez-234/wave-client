package dev.waveclient.gui.theme;

import dev.waveclient.util.ColorMath;

/**
 * Colors and corner radii shared with the launcher, as opaque ARGB and GUI pixels. Mirrors
 * {@code shared/design-tokens.json}; ThemeTokensTest fails the build if the two drift apart.
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

	// Shades derived from the tokens (the launcher derives the same ones with color-mix).

	/** Hovered surfaces: halfway between surface and raised. */
	public static final int SURFACE_HOVER = mix(SURFACE, SURFACE_RAISED, 0.5f);
	/** The track of a switch or slider that is off. */
	public static final int TRACK = mix(BORDER, TEXT_MUTED, 0.25f);
	/** Text on an accent background. */
	public static final int ON_ACCENT = 0xFFFFFFFF;
	/** Accent under the pointer. */
	public static final int ACCENT_HOVER = mix(ACCENT, TEXT, 0.15f);
	/** Text and controls that can't be used right now. */
	public static final int DISABLED = mix(TEXT_MUTED, BACKGROUND, 0.45f);

	/**
	 * Corner radii in GUI pixels: the token values are CSS pixels, and one GUI pixel is two
	 * screen pixels at the usual GUI scale, so the menu's corners match the launcher's.
	 */
	public static final double RADIUS_SMALL = 2;
	public static final double RADIUS_MEDIUM = 3;

	private Theme() {
	}

	/** The same color with a different alpha (0-255). */
	public static int withAlpha(int argb, int alpha) {
		return (Math.max(0, Math.min(255, alpha)) << 24) | (argb & 0x00FFFFFF);
	}

	/** Blends two colors; {@code t} = 0 gives {@code a}, 1 gives {@code b}. */
	public static int mix(int a, int b, float t) {
		return ColorMath.lerp(a, b, t);
	}
}
