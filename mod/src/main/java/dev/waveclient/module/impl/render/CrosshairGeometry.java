package dev.waveclient.module.impl.render;

import java.util.Arrays;

/**
 * The rectangles that make up a crosshair, in whole pixels relative to the center pixel, which
 * covers [0, 1) on both axes. Shapes are symmetric around the middle of that pixel (exactly so
 * for odd thicknesses). Built once per settings change, so drawing allocates nothing.
 */
public final class CrosshairGeometry {
	public enum Style {
		/** Four arms. */
		CROSS,
		/** Four arms and a center dot. */
		CROSS_DOT,
		/** Left, right and bottom arms. */
		T,
		DOT,
		CIRCLE,
		/** An outlined square. */
		SQUARE
	}

	/** {@code x0, y0, x1, y1} per rectangle, exclusive ends. */
	private final int[] rects;

	private CrosshairGeometry(int[] rects) {
		this.rects = rects;
	}

	/**
	 * @param length    arm length (or the circle's and square's radius)
	 * @param gap       space between the center pixel and each arm
	 * @param thickness arm (or ring) thickness, at least 1
	 * @param dotSize   side of the center dot, at least 1
	 */
	public static CrosshairGeometry of(Style style, int length, int gap, int thickness, int dotSize) {
		int t = Math.max(1, thickness);
		int len = Math.max(1, length);
		int g = Math.max(0, gap);
		Builder out = new Builder();
		// Spans of the given thickness centered on the center pixel's middle.
		int lo = -(t / 2);
		int hi = lo + t;

		switch (style) {
			case CROSS, CROSS_DOT, T -> {
				out.add(-g - len, lo, -g, hi);
				out.add(1 + g, lo, 1 + g + len, hi);
				out.add(lo, 1 + g, hi, 1 + g + len);

				if (style != Style.T) {
					out.add(lo, -g - len, hi, -g);
				}

				if (style == Style.CROSS_DOT) {
					addDot(out, dotSize);
				}
			}
			case DOT -> addDot(out, dotSize);
			case CIRCLE -> addRing(out, len, t);
			case SQUARE -> {
				int outer = len;
				out.add(-outer, -outer, 1 + outer, -outer + t);
				out.add(-outer, 1 + outer - t, 1 + outer, 1 + outer);
				out.add(-outer, -outer + t, -outer + t, 1 + outer - t);
				out.add(1 + outer - t, -outer + t, 1 + outer, 1 + outer - t);
			}
		}

		return new CrosshairGeometry(out.toArray());
	}

	private static void addDot(Builder out, int size) {
		int d = Math.max(1, size);
		int lo = -((d - 1) / 2);
		out.add(lo, lo, lo + d, lo + d);
	}

	/** A pixel ring: pixels whose centers lie between radius - thickness and radius from the center. */
	private static void addRing(Builder out, int radius, int thickness) {
		double outer = radius + 0.5;
		double inner = Math.max(0, radius + 0.5 - thickness);

		for (int y = -radius; y <= radius; y++) {
			int runStart = Integer.MIN_VALUE;

			for (int x = -radius; x <= radius + 1; x++) {
				boolean inside = false;

				if (x <= radius) {
					double distance = Math.hypot(x, y);
					inside = distance < outer && distance >= inner;
				}

				if (inside && runStart == Integer.MIN_VALUE) {
					runStart = x;
				} else if (!inside && runStart != Integer.MIN_VALUE) {
					out.add(runStart, y, x, y + 1);
					runStart = Integer.MIN_VALUE;
				}
			}
		}
	}

	/** Number of rectangles. */
	public int count() {
		return rects.length / 4;
	}

	public int x0(int i) {
		return rects[i * 4];
	}

	public int y0(int i) {
		return rects[i * 4 + 1];
	}

	public int x1(int i) {
		return rects[i * 4 + 2];
	}

	public int y1(int i) {
		return rects[i * 4 + 3];
	}

	/**
	 * How far the shape reaches from the center pixel in any direction (the bounding box is
	 * {@code [1 - extent, extent)} on both axes), for sizing a preview.
	 */
	public int extent() {
		int max = 0;

		for (int value : rects) {
			max = Math.max(max, Math.max(value, 1 - value));
		}

		return max;
	}

	private static final class Builder {
		private int[] data = new int[32];
		private int size;

		void add(int x0, int y0, int x1, int y1) {
			if (x1 <= x0 || y1 <= y0) {
				return;
			}

			if (size + 4 > data.length) {
				data = Arrays.copyOf(data, data.length * 2);
			}

			data[size++] = x0;
			data[size++] = y0;
			data[size++] = x1;
			data[size++] = y1;
		}

		int[] toArray() {
			return Arrays.copyOf(data, size);
		}
	}
}
