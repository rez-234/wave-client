package dev.waveclient.input;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class HoldToggleTest {
	@Test
	void holdEngagesWhileDown() {
		HoldToggle key = new HoldToggle();
		assertTrue(key.press(KeyMode.HOLD));
		assertTrue(key.press(KeyMode.HOLD), "a repeated press stays engaged");
		assertFalse(key.release(KeyMode.HOLD));
	}

	@Test
	void togglePressesFlip() {
		HoldToggle key = new HoldToggle();
		assertTrue(key.press(KeyMode.TOGGLE));
		assertTrue(key.release(KeyMode.TOGGLE), "release keeps it on");
		assertFalse(key.press(KeyMode.TOGGLE));
		assertFalse(key.release(KeyMode.TOGGLE));
	}

	@Test
	void switchingToHoldWhileToggledOnDisengages() {
		HoldToggle key = new HoldToggle();
		key.press(KeyMode.TOGGLE);
		key.release(KeyMode.TOGGLE);
		assertTrue(key.modeChanged(KeyMode.HOLD, true), "still held: the release will end it");
		assertFalse(key.modeChanged(KeyMode.HOLD, false));
		key.press(KeyMode.HOLD);
		assertTrue(key.modeChanged(KeyMode.TOGGLE, false), "switching to Toggle keeps it on");
		key.reset();
		assertFalse(key.engaged());
	}
}
