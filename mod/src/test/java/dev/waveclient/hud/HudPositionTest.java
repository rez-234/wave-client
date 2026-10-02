package dev.waveclient.hud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;

import java.util.concurrent.atomic.AtomicInteger;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

class HudPositionTest {
	private static final double EPS = 1e-9;

	@Test
	void anchorFromThirds() {
		assertSame(Anchor.TOP_LEFT, Anchor.nearest(0.1, 0.1));
		assertSame(Anchor.TOP_CENTER, Anchor.nearest(0.5, 0.0));
		assertSame(Anchor.MIDDLE_RIGHT, Anchor.nearest(0.9, 0.5));
		assertSame(Anchor.CENTER, Anchor.nearest(0.5, 0.5));
		assertSame(Anchor.BOTTOM_LEFT, Anchor.nearest(0.0, 1.0));
		assertSame(Anchor.BOTTOM_RIGHT, Anchor.nearest(0.99, 0.99));
	}

	@Test
	void topLeftOffsets() {
		HudPosition p = new HudPosition(Anchor.TOP_LEFT, 4, 4);
		assertEquals(4, p.left(400, 50), EPS);
		assertEquals(4, p.top(300, 10), EPS);
	}

	@Test
	void bottomRightKeepsDistanceToCornerAcrossResolutions() {
		HudPosition p = new HudPosition(Anchor.BOTTOM_RIGHT, -4, -4);
		assertEquals(346, p.left(400, 50), EPS);
		assertEquals(286, p.top(300, 10), EPS);
		assertEquals(746, p.left(800, 50), EPS);
		assertEquals(586, p.top(600, 10), EPS);
	}

	@Test
	void centerAnchorCentersTheElement() {
		HudPosition p = new HudPosition(Anchor.CENTER, 0, 0);
		assertEquals(175, p.left(400, 50), EPS);
		assertEquals(145, p.top(300, 10), EPS);
	}

	@Test
	void scaleIsAppliedAroundTheAnchor() {
		HudPosition p = new HudPosition(Anchor.BOTTOM_RIGHT, -4, -4, 2.0);
		assertEquals(296, p.left(400, 50), EPS);
		assertEquals(276, p.top(300, 10), EPS);
	}

	@Test
	void elementsStayOnScreen() {
		HudPosition p = new HudPosition(Anchor.TOP_LEFT, -100, 5000);
		assertEquals(0, p.left(400, 50), EPS);
		assertEquals(290, p.top(300, 10), EPS);

		HudPosition huge = new HudPosition(Anchor.CENTER, 0, 0);
		assertEquals(0, huge.left(100, 500), EPS);
	}

	@Test
	void moveToPicksAnchorAndRoundTrips() {
		HudPosition p = new HudPosition(Anchor.TOP_LEFT, 0, 0);

		p.moveTo(346, 286, 400, 300, 50, 10);
		assertSame(Anchor.BOTTOM_RIGHT, p.anchor());
		assertEquals(-4, p.offsetX(), EPS);
		assertEquals(-4, p.offsetY(), EPS);
		assertEquals(346, p.left(400, 50), EPS);
		assertEquals(286, p.top(300, 10), EPS);

		p.moveTo(175, 145, 400, 300, 50, 10);
		assertSame(Anchor.CENTER, p.anchor());
		assertEquals(0, p.offsetX(), EPS);
		assertEquals(0, p.offsetY(), EPS);

		p.setScale(2.0);
		p.moveTo(10, 140, 400, 300, 50, 10);
		assertSame(Anchor.MIDDLE_LEFT, p.anchor());
		assertEquals(10, p.left(400, 50), EPS);
		assertEquals(140, p.top(300, 10), EPS);
	}

	@Test
	void scaleIsClampedAndStepped() {
		HudPosition p = new HudPosition(Anchor.TOP_LEFT, 0, 0);
		p.setScale(10);
		assertEquals(HudPosition.MAX_SCALE, p.scale(), EPS);
		p.setScale(0.1);
		assertEquals(HudPosition.MIN_SCALE, p.scale(), EPS);
		p.setScale(1.234);
		assertEquals(1.25, p.scale(), EPS);
		p.setScale(Double.NaN);
		assertEquals(1.25, p.scale(), EPS);
	}

	@Test
	void changesNotifyOnce() {
		AtomicInteger changes = new AtomicInteger();
		HudPosition p = new HudPosition(Anchor.TOP_LEFT, 4, 4);
		p.setChangeSink(changes::incrementAndGet);

		p.set(Anchor.TOP_LEFT, 4, 4);
		p.setScale(1.0);
		assertEquals(0, changes.get());
		p.set(Anchor.TOP_RIGHT, -4, 4);
		p.setScale(1.5);
		p.reset();
		p.reset();
		assertEquals(3, changes.get());
	}

	@Test
	void jsonRoundTripAndLenientParsing() {
		HudPosition p = new HudPosition(Anchor.TOP_LEFT, 4, 4);
		p.set(Anchor.BOTTOM_CENTER, 1.23456, -20);
		p.setScale(1.5);
		JsonObject json = p.toJson();
		assertEquals(1.23, json.get("x").getAsDouble(), EPS);

		HudPosition copy = new HudPosition(Anchor.TOP_LEFT, 4, 4);
		copy.fromJson(json);
		assertSame(Anchor.BOTTOM_CENTER, copy.anchor());
		assertEquals(1.23, copy.offsetX(), EPS);
		assertEquals(-20, copy.offsetY(), EPS);
		assertEquals(1.5, copy.scale(), EPS);

		HudPosition lenient = new HudPosition(Anchor.TOP_LEFT, 4, 4);
		lenient.fromJson(JsonParser.parseString("{\"anchor\":\"sideways\",\"x\":\"far\",\"y\":7,\"scale\":true}").getAsJsonObject());
		assertSame(Anchor.TOP_LEFT, lenient.anchor());
		assertEquals(4, lenient.offsetX(), EPS);
		assertEquals(7, lenient.offsetY(), EPS);
		assertEquals(1.0, lenient.scale(), EPS);
	}
}
