package dev.waveclient.module.impl.hud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

import dev.waveclient.module.impl.hud.KeystrokesLayout.Cell;
import dev.waveclient.module.impl.hud.KeystrokesLayout.Key;

class KeystrokesLayoutTest {
	@Test
	void fullLayout() {
		KeystrokesLayout layout = KeystrokesLayout.of(true, true, 22, 2);
		assertEquals(70, layout.width());
		assertEquals(22 + 2 + 22 + 2 + 22 + 2 + 11, layout.height());
		assertEquals(List.of(Key.FORWARD, Key.LEFT, Key.BACK, Key.RIGHT, Key.ATTACK, Key.USE, Key.JUMP),
				layout.cells().stream().map(Cell::key).toList());

		Cell w = layout.cells().get(0);
		Cell s = layout.cells().get(2);
		assertEquals(s.x(), w.x(), "W sits above S");

		Cell lmb = layout.cells().get(4);
		Cell rmb = layout.cells().get(5);
		assertEquals(layout.width(), rmb.x() + rmb.width(), "flush with the right edge");
		assertEquals(lmb.width(), rmb.width());
		assertTrue(lmb.x() + lmb.width() < rmb.x(), "a gap between the mouse buttons");
	}

	@Test
	void optionalRows() {
		KeystrokesLayout layout = KeystrokesLayout.of(false, false, 20, 1);
		assertEquals(4, layout.cells().size());
		assertEquals(41, layout.height());
		assertFalse(layout.cells().stream().anyMatch(c -> c.key() == Key.JUMP));
	}

	@Test
	void cellsNeverOverlapAndStayInside() {
		KeystrokesLayout layout = KeystrokesLayout.of(true, true, 18, 3);

		for (Cell a : layout.cells()) {
			assertTrue(a.x() >= 0 && a.y() >= 0 && a.x() + a.width() <= layout.width() && a.y() + a.height() <= layout.height());

			for (Cell b : layout.cells()) {
				if (a != b) {
					boolean overlap = a.x() < b.x() + b.width() && b.x() < a.x() + a.width() && a.y() < b.y() + b.height() && b.y() < a.y() + a.height();
					assertFalse(overlap, a + " / " + b);
				}
			}
		}
	}
}
