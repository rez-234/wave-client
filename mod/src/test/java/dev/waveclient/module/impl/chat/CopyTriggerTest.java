package dev.waveclient.module.impl.chat;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class CopyTriggerTest {
	@Test
	void ctrlClick() {
		assertTrue(CopyTrigger.CTRL_CLICK.matches(0, true, false));
		assertFalse(CopyTrigger.CTRL_CLICK.matches(0, false, false), "a plain click still follows links");
		assertFalse(CopyTrigger.CTRL_CLICK.matches(0, true, true), "Shift+click inserts text, as in vanilla");
		assertFalse(CopyTrigger.CTRL_CLICK.matches(1, true, false));
	}

	@Test
	void rightClick() {
		assertTrue(CopyTrigger.RIGHT_CLICK.matches(1, false, false));
		assertTrue(CopyTrigger.RIGHT_CLICK.matches(1, true, false));
		assertFalse(CopyTrigger.RIGHT_CLICK.matches(0, false, false));
		assertFalse(CopyTrigger.RIGHT_CLICK.matches(1, false, true));
	}
}
