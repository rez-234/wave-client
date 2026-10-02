package dev.waveclient.hud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class HudEditControllerTest {
	private static final double EPS = 1e-9;
	private static final double SW = 400;
	private static final double SH = 300;

	static final class Box implements HudEditController.Element {
		final HudPosition position;
		int width;
		int height;
		boolean editable = true;

		Box(Anchor anchor, double x, double y, int width, int height) {
			this.position = new HudPosition(anchor, x, y);
			this.width = width;
			this.height = height;
		}

		@Override
		public HudPosition position() {
			return position;
		}

		@Override
		public int width() {
			return width;
		}

		@Override
		public int height() {
			return height;
		}

		@Override
		public boolean isEditable() {
			return editable;
		}
	}

	private Box fps;
	private Box coords;
	private HudEditController editor;

	@BeforeEach
	void setUp() {
		fps = new Box(Anchor.TOP_LEFT, 4, 4, 40, 14);
		coords = new Box(Anchor.TOP_LEFT, 4, 22, 60, 34);
		editor = new HudEditController(List.of(fps, coords));
		editor.setScreenSize(SW, SH);
	}

	private HudEditController.Bounds b(Box box) {
		return editor.bounds(box);
	}

	@Test
	void hitTestingPrefersTheTopmostElement() {
		Box over = new Box(Anchor.TOP_LEFT, 10, 10, 20, 20);
		HudEditController stacked = new HudEditController(List.of(fps, over));
		stacked.setScreenSize(SW, SH);
		assertSame(over, stacked.elementAt(15, 15));
		assertSame(fps, stacked.elementAt(5, 5));
		assertNull(stacked.elementAt(200, 200));
	}

	@Test
	void emptyElementsCannotBeGrabbed() {
		fps.width = 0;
		assertNull(editor.elementAt(5, 5));
		assertFalse(editor.press(5, 5));
	}

	@Test
	void draggingMovesWithoutJumpingToTheCursor() {
		assertTrue(editor.press(10, 8));
		assertSame(fps, editor.selected());
		editor.drag(110, 108, false);
		assertEquals(104, b(fps).x(), EPS);
		assertEquals(104, b(fps).y(), EPS);
		editor.release();
		assertNull(editor.dragging());
		assertSame(fps, editor.selected());
	}

	@Test
	void draggingIntoTheBottomRightReanchors() {
		// fps is grabbed 6px right of and 4px below its top-left corner; drop it at (340, 270),
		// leaving gaps of 20 (right) and 16 (bottom) to the corner.
		editor.press(10, 8);
		editor.drag(340 + 6, 270 + 4, false);
		editor.release();
		assertSame(Anchor.BOTTOM_RIGHT, fps.position.anchor());
		assertEquals(20, SW - b(fps).right(), EPS);
		assertEquals(16, SH - b(fps).bottom(), EPS);

		// The element keeps its distance to the corner when the window grows.
		editor.setScreenSize(SW * 2, SH * 2);
		assertEquals(20, SW * 2 - b(fps).right(), EPS);
		assertEquals(16, SH * 2 - b(fps).bottom(), EPS);
	}

	@Test
	void editedPositionsSurviveSavingAtTheSamePixel() {
		// An odd screen width puts the center guide on a half pixel, the classic rounding trap.
		HudEditController e = new HudEditController(List.of(fps, coords));
		e.setScreenSize(427, 240);
		e.press(10, 8);
		e.drag(213.5 - 20 + 6 + 1, 120 + 4, true);
		e.release();
		e.scroll(e.bounds(fps).x() + 1, e.bounds(fps).y() + 1, 1);

		HudPosition reloaded = new HudPosition(Anchor.TOP_LEFT, 0, 0);
		reloaded.fromJson(fps.position.toJson());
		assertEquals(fps.position.pixelLeft(427, fps.width), reloaded.pixelLeft(427, fps.width));
		assertEquals(fps.position.pixelTop(240, fps.height), reloaded.pixelTop(240, fps.height));
		assertEquals(fps.position.left(427, fps.width), Math.rint(fps.position.left(427, fps.width)), 1e-6,
				"stored on a whole pixel");
	}

	@Test
	void draggingIsClampedToTheScreen() {
		editor.press(10, 8);
		editor.drag(-500, -500, false);
		assertEquals(0, b(fps).x(), EPS);
		assertEquals(0, b(fps).y(), EPS);
		editor.drag(5000, 5000, false);
		assertEquals(SW - 40, b(fps).x(), EPS);
		assertEquals(SH - 14, b(fps).y(), EPS);
	}

	@Test
	void snapsToScreenEdgesAndShowsGuides() {
		editor.press(10, 8);
		// Grab offset is (6, 4); dropping at x=8 would put the left edge at 2.
		editor.drag(8, 150, true);
		assertEquals(0, b(fps).x(), EPS);
		assertEquals(0, editor.guideX(), EPS);

		editor.release();
		assertTrue(Double.isNaN(editor.guideX()));
	}

	@Test
	void snapsToScreenCenter() {
		editor.press(10, 8);
		// Element is 40 wide: center at x = 200 means left = 180. Try left = 182.
		editor.drag(182 + 6, 100, true);
		assertEquals(180, b(fps).x(), EPS);
		assertEquals(SW / 2, editor.guideX(), EPS);
	}

	@Test
	void snapsToOtherElementsEdges() {
		// coords spans x 4..64, y 22..56. Drag fps so its top lands 2px below coords' bottom.
		editor.press(10, 8);
		editor.drag(150 + 6, 58 + 4, true);
		assertEquals(56, b(fps).y(), EPS);
		assertEquals(56, editor.guideY(), EPS);
	}

	@Test
	void altDisablesSnapping() {
		editor.press(10, 8);
		editor.drag(8, 150, false);
		assertEquals(2, b(fps).x(), EPS);
		assertTrue(Double.isNaN(editor.guideX()));
	}

	@Test
	void cornerHandleScalesFromTheTopLeft() {
		HudEditController.Bounds before = b(coords);
		double handleX = before.right() - 1;
		double handleY = before.bottom() - 1;
		assertSame(coords, editor.handleAt(handleX, handleY));

		assertTrue(editor.press(handleX, handleY));
		assertTrue(editor.isScaling());
		editor.drag(before.x() + 120, before.y() + 10, true);
		editor.release();

		assertEquals(2.0, coords.position.scale(), EPS);
		assertEquals(before.x(), b(coords).x(), EPS);
		assertEquals(before.y(), b(coords).y(), EPS);
		assertEquals(120, b(coords).w(), EPS);
	}

	@Test
	void scrollScalesAroundTheCenter() {
		fps.position.set(Anchor.TOP_LEFT, 100, 100);
		HudEditController.Bounds before = b(fps);
		assertTrue(editor.scroll(110, 105, 1));
		assertEquals(1.05, fps.position.scale(), EPS);
		HudEditController.Bounds after = b(fps);
		assertEquals(before.x() + before.w() / 2, after.x() + after.w() / 2, 1.0);
		assertEquals(before.y() + before.h() / 2, after.y() + after.h() / 2, 1.0);

		assertFalse(editor.scroll(300, 250, 1), "nothing under the mouse");
		assertFalse(editor.scroll(110, 105, 0));
	}

	@Test
	void nudgeMovesTheSelectionByPixels() {
		assertFalse(editor.nudge(1, 0), "nothing selected");
		editor.press(10, 8);
		editor.release();
		assertTrue(editor.nudge(10, -1));
		assertEquals(14, b(fps).x(), EPS);
		assertEquals(3, b(fps).y(), EPS);
	}

	@Test
	void nudgeIsIgnoredWhileDragging() {
		editor.press(10, 8);
		assertFalse(editor.nudge(1, 0));
	}

	@Test
	void resetRestoresDefaults() {
		editor.press(10, 8);
		editor.drag(300, 200, false);
		editor.release();
		editor.scroll(b(fps).x() + 1, b(fps).y() + 1, 1);
		assertTrue(editor.resetSelected());
		assertSame(Anchor.TOP_LEFT, fps.position.anchor());
		assertEquals(4, b(fps).x(), EPS);
		assertEquals(1.0, fps.position.scale(), EPS);

		coords.position.set(Anchor.CENTER, 0, 0);
		editor.resetAll();
		assertEquals(22, b(coords).y(), EPS);
	}

	@Test
	void clickingEmptySpaceClearsTheSelection() {
		editor.press(10, 8);
		editor.release();
		assertFalse(editor.press(300, 250));
		assertNull(editor.selected());
		assertFalse(editor.resetSelected());
	}

	@Test
	void aClickWithoutMovementChangesNothing() {
		// fps sits exactly 4px from the edges, the snap distance: jitter must not snap it.
		editor.press(10, 8);
		editor.drag(11.5, 8.5, true);
		editor.release();
		assertEquals(4, b(fps).x(), EPS);
		assertEquals(4, b(fps).y(), EPS);

		HudEditController.Bounds before = b(coords);
		editor.press(before.right() - 3, before.bottom() - 3);
		editor.drag(before.right() - 2, before.bottom() - 2, true);
		editor.release();
		assertEquals(1.0, coords.position.scale(), EPS, "grabbing the handle doesn't resize");
	}

	@Test
	void handleScalingNearTheRightEdgeGrowsInwardAndIsReversible() {
		Box topRight = new Box(Anchor.TOP_RIGHT, -4, 4, 60, 34);
		HudEditController e = new HudEditController(List.of(topRight));
		e.setScreenSize(SW, SH);
		HudEditController.Bounds start = e.bounds(topRight);
		double hx = start.right() - 1;
		double hy = start.bottom() - 1;

		e.press(hx, hy);
		e.drag(hx + 60, hy, true);
		HudEditController.Bounds grown = e.bounds(topRight);
		assertEquals(2.0, topRight.position.scale(), EPS, "an element in the corner can still grow");
		assertEquals(SW, grown.right(), EPS, "it grows inward and stays on screen");
		assertEquals(start.y(), grown.y(), EPS);

		e.drag(hx, hy, true);
		e.release();
		assertEquals(1.0, topRight.position.scale(), EPS, "dragging back undoes the resize");
		assertEquals(start.x(), e.bounds(topRight).x(), EPS);
		assertEquals(start.y(), e.bounds(topRight).y(), EPS);
	}

	@Test
	void handleScalingIsCappedAtTheScreenSize() {
		HudEditController.Bounds start = b(coords);
		editor.press(start.right() - 1, start.bottom() - 1);
		editor.drag(5000, 5000, true);
		HudEditController.Bounds big = b(coords);
		assertTrue(big.right() <= SW && big.bottom() <= SH, "fits on screen");
		assertEquals(3.0, coords.position.scale(), EPS, "300% is the largest scale");
	}

	@Test
	void coveredHandlesCannotBeGrabbed() {
		// top covers fps's bottom-right corner.
		Box top = new Box(Anchor.TOP_LEFT, 30, 10, 40, 20);
		HudEditController e = new HudEditController(List.of(fps, top));
		e.setScreenSize(SW, SH);
		HudEditController.Bounds fpsBounds = e.bounds(fps);
		double x = fpsBounds.right() - 1;
		double y = fpsBounds.bottom() - 1;

		assertSame(top, e.elementAt(x, y));
		assertNull(e.handleAt(x, y));
		assertTrue(e.press(x, y));
		assertSame(top, e.dragging());
		assertFalse(e.isScaling());
	}

	@Test
	void scrollingUpAndBackDownReturnsToTheSameSpot() {
		fps.position.set(Anchor.CENTER, 13, -7);
		HudEditController.Bounds start = b(fps);

		for (int i = 0; i < 7; i++) {
			editor.scroll(start.x() + 2, start.y() + 2, 1);
		}

		for (int i = 0; i < 7; i++) {
			HudEditController.Bounds now = b(fps);
			editor.scroll(now.x() + 2, now.y() + 2, -1);
		}

		assertEquals(1.0, fps.position.scale(), EPS);
		assertEquals(start.x(), b(fps).x(), EPS);
		assertEquals(start.y(), b(fps).y(), EPS);
	}

	@Test
	void fractionalScrollAddsUpToWholeSteps() {
		fps.position.set(Anchor.TOP_LEFT, 100, 100);

		for (int i = 0; i < 9; i++) {
			editor.scroll(110, 105, 0.1);
		}

		assertEquals(1.0, fps.position.scale(), EPS, "0.9 of a notch: no change yet");
		editor.scroll(110, 105, 0.1);
		assertEquals(1.05, fps.position.scale(), EPS);

		editor.scroll(110, 105, 3);
		assertEquals(1.2, fps.position.scale(), EPS, "a 3-notch event is 3 steps");

		editor.scroll(110, 105, 0.5);
		editor.scroll(110, 105, -0.5);
		assertEquals(1.2, fps.position.scale(), EPS, "changing direction drops the partial step");
	}

	@Test
	void resetIsIgnoredWhileDragging() {
		editor.press(10, 8);
		editor.drag(100, 100, false);
		assertFalse(editor.resetSelected());
		editor.release();
		assertTrue(editor.resetSelected());

		HudEditController.Bounds c = b(coords);
		editor.press(c.right() - 1, c.bottom() - 1);
		editor.drag(c.right() + 30, c.bottom() + 30, true);
		assertTrue(editor.isScaling());
		assertFalse(editor.resetSelected(), "not during a resize either");
	}

	@Test
	void anElementHiddenWhileEditingCannotBeMovedOrReset() {
		editor.press(10, 8);
		fps.editable = false;
		editor.drag(200, 200, false);
		assertNull(editor.dragging());
		assertEquals(4, fps.position.offsetX(), EPS);
		assertFalse(editor.nudge(5, 0));
		assertFalse(editor.resetSelected());
	}

	@Test
	void elementsThatAreNotEditableAreIgnored() {
		fps.editable = false;
		assertNull(editor.elementAt(5, 5));
		assertFalse(editor.press(5, 5));

		// And they are not snap targets: nothing to snap to near fps's old spot.
		HudEditController.Bounds c = b(coords);
		editor.press(c.x() + 1, c.y() + 1);
		editor.drag(c.x() + 1 + 40, 4 + 14 + 2 + 1, true);
		assertTrue(Double.isNaN(editor.guideY()) || editor.guideY() != 18, "no guide from the hidden element");
	}
}
