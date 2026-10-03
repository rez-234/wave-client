package dev.waveclient.module.impl.render;

import java.util.Arrays;

import dev.waveclient.setting.EnumSetting;

/**
 * The pixels of a custom crosshair, as rectangles relative to the center pixel, which covers
 * [0, 1) on both axes (+x right, +y down).
 *
 * <p>The shape is drawn into a pixel mask first; its outline is the mask grown by the outline
 * width, minus the mask. Both are then turned into rectangles that never overlap: with the
 * vanilla invert blend an overlapped pixel would be inverted twice (showing the world again), and
 * a translucent color would be blended twice. Built once per settings change.
 */
public final class CrosshairShape {
	public enum Style implements EnumSetting.Labeled {
		CROSS("Cross"),
		T("T"),
		CIRCLE("Circle"),
		SQUARE("Square"),
		DOT("Dot");

		private final String label;

		Style(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	/**
	 * @param length    arm length, or the radius of a circle or square
	 * @param gap       empty pixels between the center and each arm (0 joins them, like vanilla)
	 * @param thickness arm or ring thickness
	 * @param dot       whether to add a center dot
	 * @param outline   outline width, 0 for none
	 */
	public record Spec(Style style, int length, int gap, int thickness, boolean dot, int dotSize, int outline) {
		public Spec {
			length = clamp(length, 1, 32);
			gap = clamp(gap, 0, 32);
			thickness = clamp(thickness, 1, 16);
			dotSize = clamp(dotSize, 1, 16);
			outline = clamp(outline, 0, 4);
		}
	}

	private final int[] fill;
	private final int[] outline;
	private final int minX;
	private final int minY;
	private final int maxX;
	private final int maxY;

	private CrosshairShape(int[] fill, int[] outline, int minX, int minY, int maxX, int maxY) {
		this.fill = fill;
		this.outline = outline;
		this.minX = minX;
		this.minY = minY;
		this.maxX = maxX;
		this.maxY = maxY;
	}

	/** Where a run of {@code n} pixels centered on the center pixel starts; an even run puts its extra pixel on the + side. */
	public static int spanStart(int n) {
		return -((n - 1) / 2);
	}

	public static CrosshairShape of(Spec spec) {
		int radius = spec.gap() + spec.length() + spec.thickness() + spec.dotSize() + spec.outline() + 2;
		Mask mask = new Mask(radius);
		int lo = spanStart(spec.thickness());
		int hi = lo + spec.thickness();
		int gap = spec.gap();
		int length = spec.length();

		switch (spec.style()) {
			case CROSS, T -> {
				// Arms are measured from the edges of the center block, so thickness never eats the gap.
				mask.rect(hi + gap, lo, hi + gap + length, hi);
				mask.rect(lo - gap - length, lo, lo - gap, hi);
				mask.rect(lo, hi + gap, hi, hi + gap + length);

				if (spec.style() == Style.CROSS) {
					mask.rect(lo, lo - gap - length, hi, lo - gap);
				}

				if (gap == 0) {
					// Joined arms: fill the center too, which gives the vanilla plus.
					mask.rect(lo, lo, hi, hi);
				}
			}
			case CIRCLE -> {
				// A ring around the middle of the center pixel.
				double outer = length + 0.5;
				double inner = Math.max(0, outer - spec.thickness());

				for (int y = -length; y <= length; y++) {
					for (int x = -length; x <= length; x++) {
						double distance = Math.hypot(x, y);

						if (distance < outer && distance >= inner) {
							mask.set(x, y);
						}
					}
				}
			}
			case SQUARE -> {
				int t = Math.min(spec.thickness(), length + 1);
				mask.rect(-length, -length, length + 1, -length + t);
				mask.rect(-length, length + 1 - t, length + 1, length + 1);
				mask.rect(-length, -length, -length + t, length + 1);
				mask.rect(length + 1 - t, -length, length + 1, length + 1);
			}
			case DOT -> {
				// Only the dot below.
			}
		}

		if (spec.dot() || spec.style() == Style.DOT) {
			int start = spanStart(spec.dotSize());
			mask.rect(start, start, start + spec.dotSize(), start + spec.dotSize());
		}

		Mask ring = mask.ring(spec.outline());
		int[] fillRects = mask.rects();
		int[] outlineRects = ring.rects();
		int minX = Integer.MAX_VALUE;
		int minY = Integer.MAX_VALUE;
		int maxX = Integer.MIN_VALUE;
		int maxY = Integer.MIN_VALUE;

		for (int[] rects : new int[][] {fillRects, outlineRects}) {
			for (int i = 0; i < rects.length; i += 4) {
				minX = Math.min(minX, rects[i]);
				minY = Math.min(minY, rects[i + 1]);
				maxX = Math.max(maxX, rects[i + 2]);
				maxY = Math.max(maxY, rects[i + 3]);
			}
		}

		if (minX == Integer.MAX_VALUE) {
			minX = 0;
			minY = 0;
			maxX = 0;
			maxY = 0;
		}

		return new CrosshairShape(fillRects, outlineRects, minX, minY, maxX, maxY);
	}

	public int fillCount() {
		return fill.length / 4;
	}

	public int outlineCount() {
		return outline.length / 4;
	}

	/** {@code x0, y0, x1, y1} per rectangle (exclusive ends), pairwise disjoint. */
	public int[] fillRects() {
		return fill.clone();
	}

	/** {@code x0, y0, x1, y1} per rectangle, disjoint from each other and from the fill. */
	public int[] outlineRects() {
		return outline.clone();
	}

	public int minX() {
		return minX;
	}

	public int minY() {
		return minY;
	}

	public int maxX() {
		return maxX;
	}

	/** Exclusive bottom edge of everything drawn, relative to the center pixel's top (5 for the vanilla plus). */
	public int maxY() {
		return maxY;
	}

	/** The center pixel of a screen {@code size} pixels wide or tall, where vanilla centers its crosshair. */
	public static int centerPixel(int size) {
		return (size - 1) / 2;
	}

	/**
	 * The opaque grey that the invert blend turns into "this much inversion": 1 inverts fully, like
	 * vanilla. The invert blend ignores alpha, and a fully transparent pixel isn't drawn at all.
	 */
	public static int invertColor(double strength) {
		int grey = (int) Math.round(Math.max(0, Math.min(1, strength)) * 255);
		return 0xFF000000 | grey << 16 | grey << 8 | grey;
	}

	/**
	 * Top of the attack indicator under the crosshair: vanilla's position, moved down to stay 4
	 * pixels below a crosshair taller than vanilla's.
	 *
	 * @param crosshairBottom the crosshair's exclusive bottom edge below the center pixel's top, in GUI pixels
	 */
	public static int indicatorTop(int guiHeight, int crosshairBottom) {
		int vanilla = guiHeight / 2 - 7 + 16;
		return Math.max(vanilla, centerPixel(guiHeight) + crosshairBottom + 4);
	}

	private static int clamp(int value, int min, int max) {
		return Math.max(min, Math.min(max, value));
	}

	/** A square grid of pixels covering [-radius, radius] on both axes. */
	private static final class Mask {
		private final int radius;
		private final int size;
		private final boolean[] pixels;

		Mask(int radius) {
			this.radius = radius;
			this.size = 2 * radius + 1;
			this.pixels = new boolean[size * size];
		}

		void set(int x, int y) {
			pixels[(y + radius) * size + (x + radius)] = true;
		}

		void rect(int x0, int y0, int x1, int y1) {
			for (int y = y0; y < y1; y++) {
				for (int x = x0; x < x1; x++) {
					set(x, y);
				}
			}
		}

		/** The pixels within {@code width} of this mask (square brush) that aren't in it. */
		Mask ring(int width) {
			Mask ring = new Mask(radius);

			if (width <= 0) {
				return ring;
			}

			for (int y = 0; y < size; y++) {
				for (int x = 0; x < size; x++) {
					if (!pixels[y * size + x] && near(x, y, width)) {
						ring.pixels[y * size + x] = true;
					}
				}
			}

			return ring;
		}

		private boolean near(int x, int y, int width) {
			for (int dy = -width; dy <= width; dy++) {
				for (int dx = -width; dx <= width; dx++) {
					int nx = x + dx;
					int ny = y + dy;

					if (nx >= 0 && ny >= 0 && nx < size && ny < size && pixels[ny * size + nx]) {
						return true;
					}
				}
			}

			return false;
		}

		/** Each row's runs of set pixels, merged with an identical run directly above, as {@code x0, y0, x1, y1}. */
		int[] rects() {
			int[] out = new int[64];
			int n = 0;
			// Runs from the row above: x0, x1, output index.
			int[] above = new int[size * 3];
			int aboveCount = 0;
			int[] current = new int[size * 3];

			for (int y = 0; y < size; y++) {
				int currentCount = 0;
				int x = 0;

				while (x < size) {
					if (!pixels[y * size + x]) {
						x++;
						continue;
					}

					int x0 = x;

					while (x < size && pixels[y * size + x]) {
						x++;
					}

					int index = -1;

					for (int k = 0; k < aboveCount; k += 3) {
						if (above[k] == x0 && above[k + 1] == x) {
							index = above[k + 2];
							break;
						}
					}

					if (index >= 0) {
						out[index + 3] = y + 1 - radius;
					} else {
						if (n + 4 > out.length) {
							out = Arrays.copyOf(out, out.length * 2);
						}

						index = n;
						out[n++] = x0 - radius;
						out[n++] = y - radius;
						out[n++] = x - radius;
						out[n++] = y + 1 - radius;
					}

					current[currentCount++] = x0;
					current[currentCount++] = x;
					current[currentCount++] = index;
				}

				int[] swap = above;
				above = current;
				current = swap;
				aboveCount = currentCount;
			}

			return Arrays.copyOf(out, n);
		}
	}
}
