package dev.waveclient.gui.widget;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ScrollStateTest {
	private static final double EPS = 1e-9;

	@Test
	void offsetStaysInRange() {
		ScrollState s = new ScrollState();
		s.setBounds(300, 100);
		s.scrollBy(-50);
		assertEquals(0, s.target(), EPS);
		s.scrollBy(1000);
		assertEquals(200, s.target(), EPS);

		s.jumpTo(150);
		s.setBounds(180, 100);
		assertEquals(80, s.offset(), EPS, "shrinking content pulls the offset back");
		s.setBounds(50, 100);
		assertFalse(s.canScroll());
		assertEquals(0, s.offset(), EPS);
	}

	@Test
	void easesTowardsTheTargetAndSettles() {
		ScrollState s = new ScrollState();
		s.setBounds(1000, 100);
		s.scrollBy(100);
		s.update(1 / 60.0);
		assertTrue(s.offset() > 0 && s.offset() < 100);

		for (int i = 0; i < 120; i++) {
			s.update(1 / 60.0);
		}

		assertEquals(100, s.offset(), EPS, "lands exactly on the target");
		s.update(0);
		s.update(Double.NaN);
		assertEquals(100, s.offset(), EPS);
	}

	@Test
	void revealScrollsTheLeastAmount() {
		ScrollState s = new ScrollState();
		s.setBounds(1000, 100);
		s.reveal(150, 170);
		assertEquals(70, s.target(), EPS, "bottom edge aligned");
		s.reveal(20, 40);
		assertEquals(20, s.target(), EPS, "top edge aligned");
		s.reveal(30, 60);
		assertEquals(20, s.target(), EPS, "already visible");
		s.reveal(500, 800);
		assertEquals(500, s.target(), EPS, "taller than the viewport: show its top");
	}

	@Test
	void thumbGeometry() {
		ScrollState s = new ScrollState();
		s.setBounds(400, 100);
		ScrollState.Thumb thumb = s.thumb(10, 100, 8);
		assertEquals(10, thumb.y(), EPS);
		assertEquals(25, thumb.height(), EPS);

		s.jumpTo(300);
		thumb = s.thumb(10, 100, 8);
		assertEquals(110, thumb.bottom(), EPS);

		s.setBounds(100_000, 100);
		assertEquals(8, s.thumb(0, 100, 8).height(), EPS, "never smaller than the minimum");
	}

	@Test
	void draggingTheThumbKeepsTheGrabPoint() {
		ScrollState s = new ScrollState();
		s.setBounds(400, 100);
		s.beginThumbDrag(15, 0, 100, 8);
		assertTrue(s.isDraggingThumb());
		assertEquals(0, s.offset(), EPS, "grabbing the thumb doesn't move it");

		s.dragThumb(15 + 37.5, 0, 100, 8);
		assertEquals(150, s.offset(), EPS);
		s.dragThumb(500, 0, 100, 8);
		assertEquals(300, s.offset(), EPS);
		s.endThumbDrag();
		s.dragThumb(0, 0, 100, 8);
		assertEquals(300, s.offset(), EPS, "no effect after release");
	}

	@Test
	void pressingTheTrackCentersTheThumbThere() {
		ScrollState s = new ScrollState();
		s.setBounds(400, 100);
		s.beginThumbDrag(50, 0, 100, 8);
		ScrollState.Thumb thumb = s.thumb(0, 100, 8);
		assertEquals(50, thumb.y() + thumb.height() / 2, EPS);
		s.dragThumb(60, 0, 100, 8);
		assertEquals(60, s.thumb(0, 100, 8).y() + 12.5, EPS);
	}
}
