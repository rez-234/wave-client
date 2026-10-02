package dev.waveclient.hud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

class SnapEngineTest {
	private static final double EPS = 1e-9;

	private static SnapEngine.Result snap(double x, double y, double w, double h, SnapEngine.Rect... others) {
		return SnapEngine.snap(new SnapEngine.Rect(x, y, w, h), 400, 300, List.of(others), 4);
	}

	@Test
	void nothingNearbyLeavesThePositionAlone() {
		SnapEngine.Result r = snap(100.5, 77.25, 40, 10);
		assertEquals(100.5, r.x(), EPS);
		assertEquals(77.25, r.y(), EPS);
		assertFalse(r.snappedX());
		assertFalse(r.snappedY());
	}

	@Test
	void screenEdges() {
		SnapEngine.Result r = snap(3, 288, 40, 10);
		assertEquals(0, r.x(), EPS);
		assertEquals(0, r.guideX(), EPS);
		assertEquals(290, r.y(), EPS);
		assertEquals(300, r.guideY(), EPS);
	}

	@Test
	void screenCenterLines() {
		SnapEngine.Result r = snap(182, 146, 40, 10);
		assertEquals(180, r.x(), EPS);
		assertEquals(200, r.guideX(), EPS);
		assertEquals(145, r.y(), EPS);
		assertEquals(150, r.guideY(), EPS);
	}

	@Test
	void otherElementsEdgesAndCenters() {
		SnapEngine.Rect other = new SnapEngine.Rect(100, 100, 60, 20);
		// Left edge to the other's right edge (side by side).
		SnapEngine.Result beside = snap(162, 50, 30, 10, other);
		assertEquals(160, beside.x(), EPS);
		assertEquals(160, beside.guideX(), EPS);
		// Centers aligned.
		SnapEngine.Result centered = snap(117, 50, 30, 10, other);
		assertEquals(115, centered.x(), EPS);
		assertEquals(130, centered.guideX(), EPS);
	}

	@Test
	void closestTargetWins() {
		SnapEngine.Rect a = new SnapEngine.Rect(100, 0, 10, 10);
		SnapEngine.Rect b = new SnapEngine.Rect(103, 0, 10, 10);
		SnapEngine.Result r = snap(102, 150, 10, 10, a, b);
		assertEquals(103, r.x(), EPS);
	}

	@Test
	void exactlyAtTheSnapDistanceStillSnaps() {
		assertTrue(snap(4, 100, 40, 10).snappedX());
		assertFalse(snap(4.01, 100, 40, 10).snappedX());
	}
}
