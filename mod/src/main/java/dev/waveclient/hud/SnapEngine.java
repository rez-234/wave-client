package dev.waveclient.hud;

import java.util.List;

/**
 * Snaps a rectangle being dragged in the HUD editor to the screen's edges and center lines and
 * to the edges and centers of other elements. Each axis is snapped independently, to the closest
 * target within the snap distance; the target line is reported so the editor can draw a guide.
 */
public final class SnapEngine {
	public record Rect(double x, double y, double w, double h) {
	}

	/**
	 * @param guideX the vertical line the x position snapped to, or NaN if it didn't snap
	 * @param guideY the horizontal line the y position snapped to, or NaN if it didn't snap
	 */
	public record Result(double x, double y, double guideX, double guideY) {
		public boolean snappedX() {
			return !Double.isNaN(guideX);
		}

		public boolean snappedY() {
			return !Double.isNaN(guideY);
		}
	}

	private SnapEngine() {
	}

	public static Result snap(Rect moving, double screenWidth, double screenHeight, List<Rect> others, double distance) {
		double[] xTargets = new double[3 + others.size() * 3];
		double[] yTargets = new double[3 + others.size() * 3];
		xTargets[0] = 0;
		xTargets[1] = screenWidth / 2;
		xTargets[2] = screenWidth;
		yTargets[0] = 0;
		yTargets[1] = screenHeight / 2;
		yTargets[2] = screenHeight;

		for (int i = 0; i < others.size(); i++) {
			Rect other = others.get(i);
			xTargets[3 + i * 3] = other.x();
			xTargets[4 + i * 3] = other.x() + other.w() / 2;
			xTargets[5 + i * 3] = other.x() + other.w();
			yTargets[3 + i * 3] = other.y();
			yTargets[4 + i * 3] = other.y() + other.h() / 2;
			yTargets[5 + i * 3] = other.y() + other.h();
		}

		double[] x = axis(moving.x(), moving.w(), xTargets, distance);
		double[] y = axis(moving.y(), moving.h(), yTargets, distance);
		return new Result(x[0], y[0], x[1], y[1]);
	}

	/** @return {snapped start, guide line or NaN} */
	private static double[] axis(double start, double size, double[] targets, double distance) {
		double[] edges = {0, size / 2, size};
		double bestShift = 0;
		double bestDistance = Double.POSITIVE_INFINITY;
		double guide = Double.NaN;

		for (double target : targets) {
			for (double edge : edges) {
				double shift = target - (start + edge);
				double abs = Math.abs(shift);

				if (abs <= distance && abs < bestDistance) {
					bestDistance = abs;
					bestShift = shift;
					guide = target;
				}
			}
		}

		return new double[] {start + bestShift, guide};
	}
}
