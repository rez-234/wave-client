package dev.waveclient.util;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class TimeFormatTest {
	private static String clock(int h, int m, int s, boolean twelve, boolean seconds) {
		return TimeFormat.appendClock(new StringBuilder(), h, m, s, twelve, seconds).toString();
	}

	@Test
	void clock() {
		assertEquals("14:05", clock(14, 5, 9, false, false));
		assertEquals("14:05:09", clock(14, 5, 9, false, true));
		assertEquals("2:05 PM", clock(14, 5, 9, true, false));
		assertEquals("12:00 AM", clock(0, 0, 0, true, false));
		assertEquals("12:30 PM", clock(12, 30, 0, true, false));
		assertEquals("00:00", clock(0, 0, 0, false, false));
	}

	@Test
	void gameTime() {
		assertEquals(6, TimeFormat.gameHour(0), "a new day starts at sunrise");
		assertEquals(0, TimeFormat.gameMinute(0));
		assertEquals(12, TimeFormat.gameHour(6000));
		assertEquals(0, TimeFormat.gameHour(18000));
		assertEquals(6, TimeFormat.gameHour(24000 * 50L), "day time keeps counting days");
		assertEquals(30, TimeFormat.gameMinute(500));
		assertEquals(5, TimeFormat.gameHour(-1000), "negative day time wraps");
	}

	@Test
	void tickDurationsMatchVanilla() {
		assertEquals("00:00", TimeFormat.appendTickDuration(new StringBuilder(), 0, 20).toString());
		assertEquals("01:30", TimeFormat.appendTickDuration(new StringBuilder(), 1800, 20).toString());
		assertEquals("00:59", TimeFormat.appendTickDuration(new StringBuilder(), 1199, 20).toString());
		assertEquals("01:02:03", TimeFormat.appendTickDuration(new StringBuilder(), (3723) * 20, 20).toString());
		assertEquals("00:30", TimeFormat.appendTickDuration(new StringBuilder(), 300, 10).toString(), "slower tick rate");
	}
}
