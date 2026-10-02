package dev.waveclient.util;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ColorMathTest {
	private static final float EPS = 1e-3f;

	@Test
	void primariesAndSecondaries() {
		assertEquals(0xFFFF0000, ColorMath.hsvToRgb(0, 1, 1));
		assertEquals(0xFFFFFF00, ColorMath.hsvToRgb(1 / 6f, 1, 1));
		assertEquals(0xFF00FF00, ColorMath.hsvToRgb(2 / 6f, 1, 1));
		assertEquals(0xFF00FFFF, ColorMath.hsvToRgb(3 / 6f, 1, 1));
		assertEquals(0xFF0000FF, ColorMath.hsvToRgb(4 / 6f, 1, 1));
		assertEquals(0xFFFF00FF, ColorMath.hsvToRgb(5 / 6f, 1, 1));
		assertEquals(0xFFFF0000, ColorMath.hsvToRgb(1, 1, 1), "hue wraps");
		assertEquals(0xFFFFFFFF, ColorMath.hsvToRgb(0.4f, 0, 1));
		assertEquals(0xFF000000, ColorMath.hsvToRgb(0.4f, 1, 0));
	}

	@Test
	void everyByteColorSurvivesARoundTrip() {
		float[] hsv = new float[3];

		for (int rgb = 0; rgb <= 0xFFFFFF; rgb += 0x010307) {
			ColorMath.rgbToHsv(rgb, hsv);
			assertEquals(0xFF000000 | rgb, ColorMath.hsvToRgb(hsv[0], hsv[1], hsv[2]), Integer.toHexString(rgb));
		}
	}

	@Test
	void hsvOfKnownColors() {
		float[] hsv = new float[3];
		ColorMath.rgbToHsv(0xFF5B8CFF, hsv);
		assertEquals(222.0 / 360, hsv[0], 0.01);
		assertEquals(1 - 0x5B / 255f, hsv[1], EPS);
		assertEquals(1, hsv[2], EPS);

		ColorMath.rgbToHsv(0xFF808080, hsv);
		assertEquals(0, hsv[1], EPS);
		assertEquals(128 / 255f, hsv[2], EPS);
	}

	@Test
	void alphaHelpers() {
		assertEquals(0x80123456, ColorMath.withAlpha(0xFF123456, 0x80));
		assertEquals(0x00123456, ColorMath.withAlpha(0xFF123456, -5));
		assertEquals(0x40123456, ColorMath.fadeAlpha(0x80123456, 0.5f));
		assertEquals(0xFF808080, ColorMath.lerp(0xFF000000, 0xFFFFFFFF, 0.5f) | 0x00010101 & 0, "midpoint rounds");
		assertEquals(0x80FFFFFF, ColorMath.lerp(0x00FFFFFF, 0xFFFFFFFF, 0.5f));
		assertEquals(0xFF102030, ColorMath.lerp(0xFF102030, 0xFFFFFFFF, -1));
	}
}
