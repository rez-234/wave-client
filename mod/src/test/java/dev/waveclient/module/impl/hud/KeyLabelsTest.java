package dev.waveclient.module.impl.hud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

class KeyLabelsTest {
	@Test
	void arrowsBecomeGlyphs() {
		assertEquals("↑", KeyLabels.shortName(265));
		assertEquals("←", KeyLabels.shortName(263));
		assertEquals("↓", KeyLabels.shortName(264));
		assertEquals("→", KeyLabels.shortName(262));
	}

	@Test
	void keypadAndModifiers() {
		assertEquals("KP0", KeyLabels.shortName(320));
		assertEquals("KP9", KeyLabels.shortName(329));
		assertEquals("KP+", KeyLabels.shortName(334));
		assertEquals("LShift", KeyLabels.shortName(340));
		assertEquals("RCtrl", KeyLabels.shortName(345));
		assertEquals("Space", KeyLabels.shortName(32));
	}

	@Test
	void lettersKeepTheGameName() {
		assertNull(KeyLabels.shortName(87));
		assertNull(KeyLabels.shortName(290));
	}
}
