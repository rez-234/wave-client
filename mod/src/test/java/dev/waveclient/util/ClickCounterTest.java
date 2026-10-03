package dev.waveclient.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class ClickCounterTest {
	@Test
	void countsClicksInTheLastSecond() {
		ClickCounter counter = new ClickCounter();
		counter.click(1_000);
		counter.click(1_200);
		counter.click(1_900);
		assertEquals(3, counter.count(1_950));
		assertEquals(2, counter.count(2_000), "the click at 1000 is exactly a second old");
		assertEquals(1, counter.count(2_500));
		assertEquals(0, counter.count(5_000));
	}

	@Test
	void aFullBufferDropsTheOldest() {
		ClickCounter counter = new ClickCounter(3);

		for (int i = 0; i < 5; i++) {
			counter.click(100 + i);
		}

		assertEquals(3, counter.count(110));
		assertThrows(IllegalArgumentException.class, () -> new ClickCounter(0));
	}

	@Test
	void wrapsAroundTheRing() {
		ClickCounter counter = new ClickCounter(4);

		for (long t = 0; t < 10_000; t += 300) {
			counter.click(t);
			assertEquals(Math.min(4, (int) Math.min(t / 300 + 1, 4)), counter.count(t), "at " + t);
		}

		counter.reset();
		assertEquals(0, counter.count(10_000));
	}
}
