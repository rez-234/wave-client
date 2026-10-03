package dev.waveclient.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class FrameClockTest {
	@Test
	void measuresTimeBetweenTicks() {
		long[] now = {1_000_000_000L};
		FrameClock clock = new FrameClock(() -> now[0]);
		assertTrue(Double.isNaN(clock.tick()), "nothing to measure from yet");
		now[0] += 16_000_000L;
		assertEquals(0.016, clock.tick(), 1e-12);
		now[0] += 4_000_000L;
		assertEquals(0.004, clock.tick(), 1e-12);
		clock.reset();
		now[0] += 1_000_000_000L;
		assertTrue(Double.isNaN(clock.tick()), "a reset starts over");
	}
}
