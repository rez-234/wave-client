package dev.waveclient.util;

/** Conversions between packed ARGB and hue/saturation/value, for the color picker. */
public final class ColorMath {
	private ColorMath() {
	}

	/**
	 * @param hue        0 to 1 (wraps around)
	 * @param saturation 0 to 1
	 * @param value      0 to 1
	 * @return opaque {@code 0xFFRRGGBB}
	 */
	public static int hsvToRgb(float hue, float saturation, float value) {
		float h = (hue - (float) Math.floor(hue)) * 6;
		float s = clamp01(saturation);
		float v = clamp01(value);
		int sector = Math.min(5, (int) h);
		float f = h - sector;
		float p = v * (1 - s);
		float q = v * (1 - s * f);
		float t = v * (1 - s * (1 - f));

		return switch (sector) {
			case 0 -> rgb(v, t, p);
			case 1 -> rgb(q, v, p);
			case 2 -> rgb(p, v, t);
			case 3 -> rgb(p, q, v);
			case 4 -> rgb(t, p, v);
			default -> rgb(v, p, q);
		};
	}

	/**
	 * Writes {hue, saturation, value} (each 0 to 1) of the RGB part of {@code argb} into
	 * {@code out}. Gray has saturation 0 and black has value 0; their hue is reported as 0, so
	 * callers that let the user edit HSV should keep their own hue rather than re-deriving it.
	 */
	public static void rgbToHsv(int argb, float[] out) {
		float r = ((argb >> 16) & 0xFF) / 255f;
		float g = ((argb >> 8) & 0xFF) / 255f;
		float b = (argb & 0xFF) / 255f;
		float max = Math.max(r, Math.max(g, b));
		float min = Math.min(r, Math.min(g, b));
		float delta = max - min;
		float hue;

		if (delta == 0) {
			hue = 0;
		} else if (max == r) {
			hue = ((g - b) / delta) / 6;
		} else if (max == g) {
			hue = ((b - r) / delta + 2) / 6;
		} else {
			hue = ((r - g) / delta + 4) / 6;
		}

		if (hue < 0) {
			hue += 1;
		}

		out[0] = hue;
		out[1] = max == 0 ? 0 : delta / max;
		out[2] = max;
	}

	/** Replaces the alpha of {@code argb} (alpha 0 to 255, clamped). */
	public static int withAlpha(int argb, int alpha) {
		return (Math.max(0, Math.min(255, alpha)) << 24) | (argb & 0x00FFFFFF);
	}

	/** Multiplies the alpha of {@code argb} by {@code factor} (0 to 1). */
	public static int fadeAlpha(int argb, float factor) {
		return withAlpha(argb, Math.round((argb >>> 24) * clamp01(factor)));
	}

	/** Linear blend between two ARGB colors, channel by channel, including alpha. */
	public static int lerp(int from, int to, float t) {
		float k = clamp01(t);
		return (lerpChannel(from >>> 24, to >>> 24, k) << 24)
				| (lerpChannel((from >> 16) & 0xFF, (to >> 16) & 0xFF, k) << 16)
				| (lerpChannel((from >> 8) & 0xFF, (to >> 8) & 0xFF, k) << 8)
				| lerpChannel(from & 0xFF, to & 0xFF, k);
	}

	private static int lerpChannel(int a, int b, float t) {
		return Math.round(a + (b - a) * t);
	}

	private static int rgb(float r, float g, float b) {
		return 0xFF000000 | (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
	}

	private static float clamp01(float value) {
		return value < 0 ? 0 : value > 1 ? 1 : value;
	}
}
