package dev.waveclient.util;

/** Roman numerals, for effect levels (Speed II). */
public final class Roman {
	private static final int[] VALUES = {1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1};
	private static final String[] SYMBOLS = {"M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"};

	private Roman() {
	}

	/** Appends {@code n} in Roman numerals, or as digits outside 1 to 3999. */
	public static StringBuilder append(StringBuilder out, int n) {
		if (n < 1 || n > 3999) {
			return out.append(n);
		}

		int rest = n;

		for (int i = 0; i < VALUES.length; i++) {
			while (rest >= VALUES[i]) {
				out.append(SYMBOLS[i]);
				rest -= VALUES[i];
			}
		}

		return out;
	}
}
