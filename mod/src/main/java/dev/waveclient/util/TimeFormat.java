package dev.waveclient.util;

/** Clock and duration formatting that appends to a reusable {@link StringBuilder}. */
public final class TimeFormat {
	private static final int TICKS_PER_DAY = 24000;
	private static final int TICKS_PER_HOUR = 1000;

	private TimeFormat() {
	}

	/**
	 * Appends a time of day: "14:05", "2:05 PM", or with seconds "14:05:09".
	 *
	 * @param hour 0 to 23
	 */
	public static StringBuilder appendClock(StringBuilder out, int hour, int minute, int second, boolean twelveHour, boolean seconds) {
		if (twelveHour) {
			int h = hour % 12;
			out.append(h == 0 ? 12 : h);
		} else {
			twoDigits(out, hour);
		}

		out.append(':');
		twoDigits(out, minute);

		if (seconds) {
			out.append(':');
			twoDigits(out, second);
		}

		if (twelveHour) {
			out.append(hour < 12 ? " AM" : " PM");
		}

		return out;
	}

	/**
	 * The in-game hour (0 to 23) for a level's day time. Tick 0 is 06:00 (sunrise), 6000 is noon,
	 * 18000 midnight.
	 */
	public static int gameHour(long dayTime) {
		return (int) (ticksIntoDay(dayTime) / TICKS_PER_HOUR);
	}

	/** The in-game minute (0 to 59) for a level's day time. */
	public static int gameMinute(long dayTime) {
		return (int) (ticksIntoDay(dayTime) % TICKS_PER_HOUR * 60 / TICKS_PER_HOUR);
	}

	private static long ticksIntoDay(long dayTime) {
		return Math.floorMod(dayTime + 6000, TICKS_PER_DAY);
	}

	/**
	 * Appends a duration in ticks the way vanilla shows effect durations: "01:30", or
	 * "01:02:03" past an hour.
	 *
	 * @param tickRate ticks per second (20 normally; servers can change it)
	 */
	public static StringBuilder appendTickDuration(StringBuilder out, int ticks, float tickRate) {
		int totalSeconds = (int) Math.floor(ticks / Math.max(0.001f, tickRate));
		int seconds = totalSeconds % 60;
		int minutes = totalSeconds / 60 % 60;
		int hours = totalSeconds / 3600;

		if (hours > 0) {
			twoDigits(out, hours);
			out.append(':');
		}

		twoDigits(out, minutes);
		out.append(':');
		twoDigits(out, seconds);
		return out;
	}

	private static void twoDigits(StringBuilder out, int value) {
		if (value < 10) {
			out.append('0');
		}

		out.append(value);
	}
}
