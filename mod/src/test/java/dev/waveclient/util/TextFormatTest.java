package dev.waveclient.util;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class TextFormatTest {
	private static String fixed(double value, int decimals) {
		return TextFormat.appendFixed(new StringBuilder(), value, decimals).toString();
	}

	@Test
	void roundsToTheRequestedPlaces() {
		assertEquals("12", fixed(12.4, 0));
		assertEquals("13", fixed(12.5, 0));
		assertEquals("12.3", fixed(12.34, 1));
		assertEquals("12.35", fixed(12.345, 2));
		assertEquals("0.05", fixed(0.05, 2));
		assertEquals("1.007", fixed(1.007, 3));
		assertEquals("100.00", fixed(99.999, 2));
	}

	@Test
	void negativesAndNegativeZero() {
		assertEquals("-12.3", fixed(-12.34, 1));
		assertEquals("0.0", fixed(-0.04, 1));
		assertEquals("0", fixed(-0.0, 0));
		assertEquals("-0.05", fixed(-0.05, 2));
	}

	@Test
	void largeValuesAndBadInput() {
		assertEquals("29999984.5", fixed(29_999_984.5, 1));
		assertEquals("?", fixed(Double.NaN, 1));
		assertEquals("?", fixed(Double.POSITIVE_INFINITY, 1));
		assertEquals("1.2346", fixed(1.23456, 9));
		assertEquals("1", fixed(1.4, -3));
	}

	private static String scaled(long value, int decimals) {
		return TextFormat.appendScaled(new StringBuilder(), value, decimals).toString();
	}

	@Test
	void scaledValuesFormat() {
		assertEquals("123.45", scaled(12345, 2));
		assertEquals("-0.05", scaled(-5, 2));
		assertEquals("0.00", scaled(0, 2));
		assertEquals("1.007", scaled(1007, 3));
		assertEquals("-12", scaled(-12, 0));
		assertEquals("0", scaled(0, 0));
	}

	@Test
	void roundingIsSymmetricAroundZero() {
		assertEquals(13, TextFormat.scaleRounded(1.25, 1));
		assertEquals(-13, TextFormat.scaleRounded(-1.25, 1));
		assertEquals(-1003, TextFormat.scaleRounded(-100.25, 1));
		assertEquals(0, TextFormat.scaleRounded(-0.04, 1));
		assertEquals("0.0", scaled(TextFormat.scaleRounded(-0.04, 1), 1), "no -0.0");
		assertEquals(0, TextFormat.scaleRounded(Double.NaN, 2));
		assertEquals(-9938, TextFormat.scaleRounded(-9.9375, 3));
	}

	@Test
	void appendsToExistingText() {
		StringBuilder sb = new StringBuilder("X: ");
		TextFormat.appendFixed(sb, 5.5, 1).append(" blocks");
		assertEquals("X: 5.5 blocks", sb.toString());
	}
}
