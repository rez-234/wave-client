package dev.waveclient.module.impl.movement;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

import dev.waveclient.module.impl.movement.ToggleKey.Mode;

class ToggleKeyTest {
	@Test
	void togglePressFlipsAndReleaseKeepsIt() {
		ToggleKey key = new ToggleKey();
		key.onPress(Mode.TOGGLE, false, false);
		assertTrue(key.effective(Mode.TOGGLE, false, false, false), "stays down after the key is released");
		key.onPress(Mode.TOGGLE, false, false);
		assertFalse(key.effective(Mode.TOGGLE, false, false, false));
		assertTrue(key.effective(Mode.TOGGLE, true, false, false), "the real key always works");
	}

	@Test
	void holdAndAlways() {
		ToggleKey key = new ToggleKey();
		key.onPress(Mode.HOLD, false, false);
		assertFalse(key.toggled(), "Hold never toggles");
		assertFalse(key.effective(Mode.HOLD, false, false, false));
		assertTrue(key.effective(Mode.ALWAYS, false, false, false));
		assertTrue(key.engaged(Mode.ALWAYS));
	}

	@Test
	void vanillaToggleOptionIsLeftInCharge() {
		ToggleKey key = new ToggleKey();
		key.onPress(Mode.TOGGLE, true, false);
		assertFalse(key.toggled());
		assertFalse(key.effective(Mode.ALWAYS, false, true, false));
		assertTrue(key.effective(Mode.ALWAYS, true, true, false), "vanilla's toggled state comes through as the physical key");
	}

	@Test
	void suppressionPausesWithoutLosingTheToggle() {
		ToggleKey key = new ToggleKey();
		key.onPress(Mode.TOGGLE, false, false);
		assertFalse(key.effective(Mode.TOGGLE, false, false, true), "paused while flying");
		key.onPress(Mode.TOGGLE, false, true);
		assertTrue(key.toggled(), "a press while paused is a normal press, not a flip");
		assertTrue(key.effective(Mode.TOGGLE, false, false, false), "back on afterwards");
		key.clear();
		assertFalse(key.effective(Mode.TOGGLE, false, false, false));
	}

	@Test
	void statusPriority() {
		assertEquals(MovementStatus.DESCENDING, MovementStatus.resolve(true, false, true, true, false, true, false, true));
		assertEquals(MovementStatus.FLYING, MovementStatus.resolve(true, false, false, false, false, true, false, false));
		assertEquals(MovementStatus.DISMOUNTING, MovementStatus.resolve(false, true, true, false, false, false, false, false));
		assertEquals(MovementStatus.SNEAK_TOGGLED, MovementStatus.resolve(false, false, true, true, true, true, false, false));
		assertEquals(MovementStatus.SNEAK_HELD, MovementStatus.resolve(false, false, true, false, true, false, false, false));
		assertEquals(MovementStatus.SPRINT_TOGGLED, MovementStatus.resolve(false, false, false, false, false, true, false, false));
		assertEquals(MovementStatus.SPRINT_HELD, MovementStatus.resolve(false, false, false, false, false, false, true, true));
		assertEquals(MovementStatus.SPRINT_VANILLA, MovementStatus.resolve(false, false, false, false, false, false, false, true));
		assertEquals(MovementStatus.NONE, MovementStatus.resolve(false, false, false, false, false, false, false, false));
		assertEquals(0, MovementStatus.NONE.lines().length, "nothing drawn");
		assertEquals("[Sprinting (Toggled)]", MovementStatus.SPRINT_TOGGLED.lines()[0]);
	}
}
