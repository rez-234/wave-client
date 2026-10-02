package dev.waveclient.gui.render;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class CornerMaskTest {
	@Test
	void zeroRadiusIsEmpty() {
		assertEquals(0, CornerMask.of(0).radius());
		assertEquals(0, CornerMask.of(-3).radius());
	}

	@Test
	void cachedPerRadius() {
		assertSame(CornerMask.of(6), CornerMask.of(6));
		assertEquals(64, CornerMask.of(500).radius());
	}

	@Test
	void coverageShapeIsAQuarterCircle() {
		CornerMask mask = CornerMask.of(6);
		assertTrue(mask.coverage(0, 0) < 0.05f, "the very corner is outside");
		assertEquals(1f, mask.coverage(5, 5), 1e-6f, "next to the body is inside");

		float total = 0;

		for (int i = 0; i < 6; i++) {
			for (int j = 0; j < 6; j++) {
				total += mask.coverage(i, j);
				assertEquals(mask.coverage(i, j), mask.coverage(j, i), 1e-6f, "symmetric");
			}

			if (i > 0) {
				assertTrue(mask.solidFrom(i) <= mask.solidFrom(i - 1), "rows get wider towards the body");
			}

			for (int j = mask.solidFrom(i); j < 6; j++) {
				assertEquals(1f, mask.coverage(i, j), 1e-6f);
			}
		}

		// Area of the square minus the quarter circle's complement: pi r^2 / 4.
		assertEquals(Math.PI * 36 / 4, total, 0.5);
	}
}
