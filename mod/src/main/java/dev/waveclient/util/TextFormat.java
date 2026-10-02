package dev.waveclient.util;

/** Number formatting that appends to a reusable {@link StringBuilder} instead of allocating. */
public final class TextFormat {
	private static final long[] POWERS_OF_TEN = {1, 10, 100, 1_000, 10_000};

	private TextFormat() {
	}

	/**
	 * Appends {@code value} rounded to {@code decimals} places (0 to 4), without exponent notation
	 * and without a "-0". Non-finite values append "?".
	 */
	public static StringBuilder appendFixed(StringBuilder out, double value, int decimals) {
		if (!Double.isFinite(value)) {
			return out.append('?');
		}

		int places = Math.max(0, Math.min(POWERS_OF_TEN.length - 1, decimals));
		long factor = POWERS_OF_TEN[places];
		long scaled = Math.round(Math.abs(value) * factor);

		if (value < 0 && scaled != 0) {
			out.append('-');
		}

		out.append(scaled / factor);

		if (places > 0) {
			out.append('.');
			long fraction = scaled % factor;

			for (long digit = factor / 10; digit > 1 && fraction < digit; digit /= 10) {
				out.append('0');
			}

			out.append(fraction);
		}

		return out;
	}

	/**
	 * Rounds {@code value} to {@code decimals} places (0 to 4), half away from zero, and returns it
	 * scaled by 10^decimals: 1.25 with 1 decimal gives 13, -1.25 gives -13. Pair with
	 * {@link #appendScaled}. Non-finite values give 0.
	 */
	public static long scaleRounded(double value, int decimals) {
		if (!Double.isFinite(value)) {
			return 0;
		}

		int places = Math.max(0, Math.min(POWERS_OF_TEN.length - 1, decimals));
		long scaled = Math.round(Math.abs(value) * POWERS_OF_TEN[places]);
		return value < 0 ? -scaled : scaled;
	}

	/**
	 * Appends a value that was already rounded and scaled by 10^{@code decimals}, e.g. 12345 with
	 * 2 decimals appends "123.45". Formatting the same quantized number that was used to detect a
	 * change keeps display and change detection consistent. Never prints "-0".
	 */
	public static StringBuilder appendScaled(StringBuilder out, long scaled, int decimals) {
		int places = Math.max(0, Math.min(POWERS_OF_TEN.length - 1, decimals));
		long factor = POWERS_OF_TEN[places];

		if (scaled < 0) {
			out.append('-');
		}

		long magnitude = Math.abs(scaled);
		out.append(magnitude / factor);

		if (places > 0) {
			out.append('.');
			long fraction = magnitude % factor;

			for (long digit = factor / 10; digit > 1 && fraction < digit; digit /= 10) {
				out.append('0');
			}

			out.append(fraction);
		}

		return out;
	}
}
