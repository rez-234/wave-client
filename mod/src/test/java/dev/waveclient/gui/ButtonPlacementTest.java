package dev.waveclient.gui;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import dev.waveclient.gui.ButtonPlacement.Rect;

/** Pause menu geometry from 1.21.11's PauseScreen.createPauseMenu, with and without Mod Menu. */
class ButtonPlacementTest {
	enum Layout {
		VANILLA, MODMENU_REPLACE, MODMENU_INSERT, MODMENU_ICON
	}

	/** Visible buttons of the pause menu; the "Options..." button is first. */
	static List<Rect> pauseMenu(int width, int height, Layout layout) {
		int gx = (width - 212) / 2;
		int gy = (height - 166) / 4;
		int shiftUp = layout == Layout.MODMENU_INSERT ? -12 : 0;
		int shiftDown = layout == Layout.MODMENU_INSERT ? 12 : 0;
		List<Rect> buttons = new ArrayList<>();
		buttons.add(new Rect(gx + 4, gy + 122 + shiftDown, 98, 20));
		buttons.add(new Rect(gx + 110, gy + 122 + shiftDown, 98, 20));
		buttons.add(new Rect(gx + 4, gy + 50 + shiftUp, 204, 20));
		buttons.add(new Rect(gx + 4, gy + 74 + shiftUp, 98, 20));
		buttons.add(new Rect(gx + 110, gy + 74 + shiftUp, 98, 20));

		switch (layout) {
			case MODMENU_REPLACE -> buttons.add(new Rect(gx + 4, gy + 98, 204, 20));
			case MODMENU_INSERT -> {
				buttons.add(new Rect(gx + 4, gy + 98 + shiftUp, 98, 20));
				buttons.add(new Rect(gx + 110, gy + 98 + shiftUp, 98, 20));
				buttons.add(new Rect(width / 2 - 102, gy + 110, 204, 20));
			}
			default -> {
				buttons.add(new Rect(gx + 4, gy + 98, 98, 20));
				buttons.add(new Rect(gx + 110, gy + 98, 98, 20));

				if (layout == Layout.MODMENU_ICON) {
					buttons.add(new Rect(width / 2 + 106, gy + 98, 20, 20));
				}
			}
		}

		buttons.add(new Rect(gx + 4, gy + 146 + shiftDown, 204, 20));
		// The "Game Menu" title.
		buttons.add(new Rect(width / 2 - 26, 40, 52, 9));
		return buttons;
	}

	@Test
	void sitsLeftOfOptionsAtTheSmallestScreen() {
		List<Rect> buttons = pauseMenu(320, 240, Layout.VANILLA);
		Rect spot = ButtonPlacement.choose(buttons.getFirst(), buttons, 320, 240);
		assertEquals(new Rect(34, 140, 20, 20), spot);
	}

	@Test
	void neverOverlapsAnythingWithAnyModMenuStyle() {
		for (Layout layout : Layout.values()) {
			for (int width = 320; width <= 1000; width += 17) {
				for (int height = 240; height <= 600; height += 41) {
					List<Rect> buttons = pauseMenu(width, height, layout);
					Rect options = buttons.getFirst();
					Rect spot = ButtonPlacement.choose(options, buttons, width, height);
					String where = layout + " " + width + "x" + height;
					assertEquals(options.x() - 24, spot.x(), where);
					assertEquals(options.y(), spot.y(), where + ": follows Options when Mod Menu moves it");

					for (Rect button : buttons) {
						assertFalse(button.intersects(spot), where);
					}
				}
			}
		}
	}

	@Test
	void fallsBackWhenTheLeftSpotIsTaken() {
		List<Rect> buttons = pauseMenu(320, 240, Layout.VANILLA);
		buttons.add(new Rect(30, 138, 20, 20));
		assertEquals(new Rect(266, 140, 20, 20), ButtonPlacement.choose(buttons.getFirst(), buttons, 320, 240), "right of the row");

		buttons.add(new Rect(262, 150, 30, 20));
		assertEquals(new Rect(296, 4, 20, 20), ButtonPlacement.choose(buttons.getFirst(), buttons, 320, 240), "top-right corner");

		buttons.add(new Rect(290, 0, 30, 30));
		assertNull(ButtonPlacement.choose(buttons.getFirst(), buttons, 320, 240), "nowhere free: no button");
	}

	@Test
	void staysOnScreen() {
		Rect options = new Rect(10, 100, 98, 20);
		Rect spot = ButtonPlacement.choose(options, List.of(options), 140, 200);
		assertTrue(spot.x() >= 0 && spot.right() <= 140, String.valueOf(spot));
		assertEquals(new Rect(112, 100, 20, 20), spot);
	}

	@Test
	void touchingIsNotOverlapping() {
		Rect a = new Rect(0, 0, 10, 10);
		assertFalse(a.intersects(new Rect(10, 0, 10, 10)));
		assertTrue(a.intersects(new Rect(9, 9, 10, 10)));
	}
}
