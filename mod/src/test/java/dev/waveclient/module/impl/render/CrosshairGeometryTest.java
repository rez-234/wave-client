package dev.waveclient.module.impl.render;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.HashSet;
import java.util.Set;

import org.junit.jupiter.api.Test;

import dev.waveclient.module.impl.render.CrosshairGeometry.Style;

class CrosshairGeometryTest {
	/** Every covered pixel as "x,y". */
	private static Set<String> pixels(CrosshairGeometry g) {
		Set<String> set = new HashSet<>();

		for (int i = 0; i < g.count(); i++) {
			for (int x = g.x0(i); x < g.x1(i); x++) {
				for (int y = g.y0(i); y < g.y1(i); y++) {
					assertTrue(set.add(x + "," + y), "rectangles overlap at " + x + "," + y);
				}
			}
		}

		return set;
	}

	/** Mirrored around the center pixel: x -> -x, y -> -y (for odd sizes). */
	private static void assertSymmetric(Set<String> set, boolean vertically) {
		for (String p : set) {
			int x = Integer.parseInt(p.split(",")[0]);
			int y = Integer.parseInt(p.split(",")[1]);
			assertTrue(set.contains(-x + "," + y), "mirror of " + p);

			if (vertically) {
				assertTrue(set.contains(x + "," + -y), "vertical mirror of " + p);
			}
		}
	}

	@Test
	void crossIsSymmetricWithAnEmptyCenter() {
		Set<String> set = pixels(CrosshairGeometry.of(Style.CROSS, 4, 2, 1, 1));
		assertSymmetric(set, true);
		assertEquals(16, set.size());
		assertFalse(set.contains("0,0"));
		assertTrue(set.contains("3,0"), "right arm starts gap pixels after the center pixel");
		assertFalse(set.contains("2,0"));
		assertTrue(set.contains("6,0"));
		assertFalse(set.contains("7,0"));
	}

	@Test
	void thickArmsAndDot() {
		Set<String> set = pixels(CrosshairGeometry.of(Style.CROSS_DOT, 3, 1, 3, 3));
		assertSymmetric(set, true);
		assertTrue(set.contains("0,0") && set.contains("1,1") && set.contains("-1,-1"));
		assertEquals(4 * 9 + 9, set.size());
	}

	@Test
	void tShapeHasNoTopArm() {
		Set<String> set = pixels(CrosshairGeometry.of(Style.T, 4, 2, 1, 1));
		assertSymmetric(set, false);
		assertFalse(set.contains("0,-3"));
		assertTrue(set.contains("0,3"));
	}

	@Test
	void circleAndSquare() {
		Set<String> circle = pixels(CrosshairGeometry.of(Style.CIRCLE, 5, 0, 1, 1));
		assertSymmetric(circle, true);
		assertTrue(circle.contains("5,0") && circle.contains("0,-5"));
		assertFalse(circle.contains("0,0"), "hollow");

		Set<String> square = pixels(CrosshairGeometry.of(Style.SQUARE, 4, 0, 1, 1));
		assertSymmetric(square, true);
		assertEquals(4 * 9 - 4, square.size(), "the edge of a 9x9 box");
	}

	@Test
	void dotSizes() {
		assertEquals(Set.of("0,0"), pixels(CrosshairGeometry.of(Style.DOT, 1, 0, 1, 1)));
		assertEquals(9, pixels(CrosshairGeometry.of(Style.DOT, 1, 0, 1, 3)).size());
		assertEquals(7, CrosshairGeometry.of(Style.CROSS, 4, 2, 1, 1).extent(), "arms reach 1 + gap + length from the center pixel's edge");
	}

	@Test
	void degenerateInputsAreClamped() {
		CrosshairGeometry g = CrosshairGeometry.of(Style.CROSS, 0, -5, 0, 0);
		assertEquals(4, g.count());
		assertSymmetric(pixels(g), true);
	}
}
