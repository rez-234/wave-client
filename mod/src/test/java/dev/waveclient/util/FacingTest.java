package dev.waveclient.util;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class FacingTest {
	@Test
	void cardinalDirectionsFollowMinecraftsYaw() {
		assertEquals(Facing.SOUTH, Facing.of(0, false));
		assertEquals(Facing.WEST, Facing.of(90, false));
		assertEquals(Facing.NORTH, Facing.of(180, false));
		assertEquals(Facing.NORTH, Facing.of(-180, false));
		assertEquals(Facing.EAST, Facing.of(-90, false));
		assertEquals(Facing.EAST, Facing.of(270, false));
		assertEquals(Facing.SOUTH, Facing.of(44, false));
		assertEquals(Facing.WEST, Facing.of(46, false));
		assertEquals(Facing.SOUTH, Facing.of(359, false));
		assertEquals(Facing.SOUTH, Facing.of(720 + 10, false), "yaw keeps growing as you spin");
	}

	@Test
	void intercardinalDirections() {
		assertEquals(Facing.SOUTH_WEST, Facing.of(45, true));
		assertEquals(Facing.NORTH_WEST, Facing.of(135, true));
		assertEquals(Facing.NORTH_EAST, Facing.of(-135, true));
		assertEquals(Facing.SOUTH_EAST, Facing.of(-45, true));
		assertEquals(Facing.SOUTH, Facing.of(22, true));
		assertEquals(Facing.SOUTH_WEST, Facing.of(23, true));
	}

	@Test
	void names() {
		assertEquals("Northwest", Facing.NORTH_WEST.longName());
		assertEquals("NW", Facing.NORTH_WEST.shortName());
		assertEquals("-Z", Facing.NORTH.axes());
		assertEquals(350, Facing.normalize(-10), 1e-9);
	}
}
