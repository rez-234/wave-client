package dev.waveclient.util;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class RomanTest {
	private static String roman(int n) {
		return Roman.append(new StringBuilder(), n).toString();
	}

	@Test
	void writesRomanNumerals() {
		assertEquals("I", roman(1));
		assertEquals("II", roman(2));
		assertEquals("IV", roman(4));
		assertEquals("IX", roman(9));
		assertEquals("X", roman(10));
		assertEquals("XIV", roman(14));
		assertEquals("XL", roman(40));
		assertEquals("CCLVI", roman(256));
		assertEquals("MMMCMXCIX", roman(3999));
	}

	@Test
	void fallsBackToDigitsOutsideTheRange() {
		assertEquals("0", roman(0));
		assertEquals("-3", roman(-3));
		assertEquals("4000", roman(4000));
	}

	@Test
	void appendsToExistingText() {
		assertEquals("Speed II", Roman.append(new StringBuilder("Speed "), 2).toString());
	}
}
