package dev.waveclient.module.impl.render;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.util.HashSet;
import java.util.Set;

import org.junit.jupiter.api.Test;

import dev.waveclient.module.impl.render.CrosshairShape.Spec;
import dev.waveclient.module.impl.render.CrosshairShape.Style;

class CrosshairShapeTest {
	private static long key(int x, int y) {
		return ((long) x << 32) | (y & 0xFFFFFFFFL);
	}

	private static int x(long key) {
		return (int) (key >> 32);
	}

	private static int y(long key) {
		return (int) key;
	}

	/** The pixels covered, failing if any two rectangles overlap or one is empty. */
	private static Set<Long> pixels(int[] rects) {
		Set<Long> out = new HashSet<>();

		for (int i = 0; i < rects.length; i += 4) {
			assertTrue(rects[i] < rects[i + 2] && rects[i + 1] < rects[i + 3], "empty rectangle");

			for (int px = rects[i]; px < rects[i + 2]; px++) {
				for (int py = rects[i + 1]; py < rects[i + 3]; py++) {
					if (!out.add(key(px, py))) {
						fail("rectangles overlap at " + px + "," + py);
					}
				}
			}
		}

		return out;
	}

	@Test
	void theDefaultsAreTheVanillaPlus() {
		CrosshairShape shape = CrosshairShape.of(new Spec(Style.CROSS, 4, 0, 1, false, 1, 0));
		Set<Long> expected = new HashSet<>();

		// The 15x15 sprite: row 7, columns 3 to 11, and column 7, rows 3 to 11, around (7, 7).
		for (int i = -4; i <= 4; i++) {
			expected.add(key(i, 0));
			expected.add(key(0, i));
		}

		assertEquals(expected, pixels(shape.fillRects()));
		assertEquals(5, shape.maxY());
		assertEquals(3, shape.fillCount(), "a plus is three rectangles");
	}

	@Test
	void everyShapeIsDisjointSymmetricAndKeepsItsGap() {
		for (Style style : Style.values()) {
			for (int length = 1; length <= 8; length++) {
				for (int gap = 0; gap <= 4; gap++) {
					for (int thickness = 1; thickness <= 4; thickness++) {
						for (int dotSize = 1; dotSize <= 3; dotSize++) {
							for (int dot = 0; dot <= 1; dot++) {
								for (int outline = 0; outline <= 2; outline++) {
									check(new Spec(style, length, gap, thickness, dot == 1, dotSize, outline));
								}
							}
						}
					}
				}
			}
		}
	}

	private static void check(Spec spec) {
		CrosshairShape shape = CrosshairShape.of(spec);
		Set<Long> fill = pixels(shape.fillRects());
		Set<Long> outline = pixels(shape.outlineRects());
		assertFalse(fill.isEmpty(), spec + " is empty");

		for (long p : outline) {
			assertFalse(fill.contains(p), spec + ": outline covers the fill");
		}

		int width = spec.outline();

		if (width == 0) {
			assertTrue(outline.isEmpty(), spec + ": outline without a width");
		}

		for (long p : fill) {
			for (int dy = -width; dy <= width; dy++) {
				for (int dx = -width; dx <= width; dx++) {
					long q = key(x(p) + dx, y(p) + dy);
					assertTrue(fill.contains(q) || outline.contains(q), spec + ": gap in the outline");
				}
			}
		}

		boolean usesDot = spec.dot() || spec.style() == Style.DOT;
		boolean odd = (spec.style() == Style.DOT || spec.thickness() % 2 == 1) && (!usesDot || spec.dotSize() % 2 == 1);

		if (odd) {
			for (long p : fill) {
				assertTrue(fill.contains(key(-x(p), y(p))), spec + ": not mirrored left to right");

				if (spec.style() != Style.T) {
					assertTrue(fill.contains(key(x(p), -y(p))), spec + ": not mirrored top to bottom");
				}
			}
		}

		if ((spec.style() == Style.CROSS || spec.style() == Style.T) && !spec.dot() && spec.gap() > 0) {
			int lo = CrosshairShape.spanStart(spec.thickness());
			int hi = lo + spec.thickness();

			for (int px = hi; px < hi + spec.gap(); px++) {
				assertFalse(fill.contains(key(px, lo)), spec + ": the gap is filled");
			}

			assertTrue(fill.contains(key(hi + spec.gap(), lo)), spec + ": arm missing");
			assertFalse(fill.contains(key(lo, lo)), spec + ": center filled despite the gap");
		}
	}

	@Test
	void centersLikeVanilla() {
		for (int size = 15; size < 4000; size++) {
			assertEquals((size - 15) / 2 + 7, CrosshairShape.centerPixel(size), "size " + size);
		}
	}

	@Test
	void theAttackIndicatorStaysPutForVanillaSizedCrosshairs() {
		for (int height = 15; height < 4000; height++) {
			assertEquals(height / 2 - 7 + 16, CrosshairShape.indicatorTop(height, 5), "height " + height);
		}

		// A taller crosshair pushes it down to stay 4 pixels below.
		assertEquals(CrosshairShape.centerPixel(480) + 12 + 4, CrosshairShape.indicatorTop(480, 12));
	}

	@Test
	void invertStrengthIsAnOpaqueGrey() {
		assertEquals(0xFFFFFFFF, CrosshairShape.invertColor(1));
		assertEquals(0xFF000000, CrosshairShape.invertColor(0));
		assertEquals(0xFF808080, CrosshairShape.invertColor(0.5));
		assertEquals(0xFFFFFFFF, CrosshairShape.invertColor(3));
	}

	@Test
	void outOfRangeSpecsAreClamped() {
		Spec spec = new Spec(Style.CROSS, 0, -3, 0, false, 0, 99);
		assertEquals(1, spec.length());
		assertEquals(0, spec.gap());
		assertEquals(1, spec.thickness());
		assertEquals(1, spec.dotSize());
		assertEquals(4, spec.outline());
	}
}
