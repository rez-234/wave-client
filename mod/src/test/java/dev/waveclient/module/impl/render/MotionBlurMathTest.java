package dev.waveclient.module.impl.render;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class MotionBlurMathTest {
	private static final double FRAME_60 = 1.0 / 60;

	@Test
	void strengthIsTheShareKeptPerSixtiethOfASecond() {
		assertEquals(0.5, MotionBlurMath.historyWeight(FRAME_60, 0.5), 1e-12);
		assertEquals(0.8, MotionBlurMath.historyWeight(FRAME_60, 0.8), 1e-12);
	}

	@Test
	void theTrailLastsTheSameAtAnyFrameRate() {
		for (double strength : new double[] {0.2, 0.5, 0.8, 0.95}) {
			double at60 = MotionBlurMath.historyWeight(FRAME_60, strength);
			assertEquals(at60, Math.pow(MotionBlurMath.historyWeight(1.0 / 120, strength), 2), 1e-12);
			assertEquals(at60, Math.pow(MotionBlurMath.historyWeight(1.0 / 240, strength), 4), 1e-12);
		}
	}

	@Test
	void oddInputsNeverFreezeTheImage() {
		assertEquals(0, MotionBlurMath.historyWeight(FRAME_60, 0));
		assertEquals(0, MotionBlurMath.historyWeight(FRAME_60, Double.NaN));
		assertEquals(0, MotionBlurMath.historyWeight(FRAME_60, -1));
		assertTrue(MotionBlurMath.historyWeight(0, 0.95) < 1, "a zero-length frame still moves");
		assertTrue(MotionBlurMath.historyWeight(-1, 0.95) < 1);
		assertEquals(0.5, MotionBlurMath.historyWeight(Double.NaN, 0.5), 1e-12, "unknown frame time counts as 1/60 s");
		assertTrue(MotionBlurMath.historyWeight(5, 0.95) < 0.05, "after a long pause the old image is gone");
	}

	@Test
	void strengthIsCapped() {
		assertEquals(MotionBlurMath.historyWeight(FRAME_60, MotionBlurMath.MAX_STRENGTH), MotionBlurMath.historyWeight(FRAME_60, 1.0));
	}

	@Test
	void timeConstants() {
		assertEquals(24.0, MotionBlurMath.timeConstantMillis(0.5), 0.1);
		assertEquals(74.7, MotionBlurMath.timeConstantMillis(0.8), 0.1);
	}

	@Test
	void eightBitTrailsAlwaysFadeCompletely() {
		for (boolean linear : new boolean[] {false, true}) {
			for (double weight : new double[] {0.3, 0.8, 0.95, 0.99}) {
				assertConverges(0, 40, weight, linear);
				assertConverges(255, 0, weight, linear);
				assertConverges(10, 200, weight, linear);
			}
		}
	}

	private static void assertConverges(int from, int to, double weight, boolean linear) {
		int value = from;

		for (int frame = 0; frame < 256; frame++) {
			int next = MotionBlurMath.accumulate8(value, to, weight, linear);
			assertTrue(Math.abs(to - next) <= Math.abs(to - value), "moved away from the target");
			assertTrue(from < to ? next <= to : next >= to, "overshot the target");
			value = next;

			if (value == to) {
				return;
			}
		}

		throw new AssertionError("stuck at " + value + " going " + from + " -> " + to + " (weight " + weight + ", linear " + linear + ")");
	}

	@Test
	void plainRoundingWouldGetStuck() {
		// Why the shader forces a step: without it, 39 never reaches 40 at weight 0.99.
		int naive = (int) Math.round(39 + (40 - 39) * (1 - 0.99));
		assertEquals(39, naive);
		assertEquals(40, MotionBlurMath.accumulate8(39, 40, 0.99, false));
	}

	@Test
	void anUnchangedPixelStaysPut() {
		assertEquals(128, MotionBlurMath.accumulate8(128, 128, 0.9, false));
		assertEquals(128, MotionBlurMath.accumulate8(128, 128, 0.9, true));
	}
}
