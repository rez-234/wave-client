package dev.waveclient.hud;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * Lays out every default HUD spot with each element at a typical worst-case size (longest
 * common text, all armor slots, three effects, a 15-line board) and checks that nothing overlaps.
 */
class HudDefaultsTest {
	private record Box(String name, double left, double top, double right, double bottom) {
		boolean intersects(Box other) {
			return left < other.right && other.left < right && top < other.bottom && other.top < bottom;
		}
	}

	private record Element(String name, HudDefaults.Spot spot, int width, int height) {
		Box place(int screenWidth, int screenHeight) {
			HudPosition position = new HudPosition(spot.anchor(), spot.x(), spot.y());
			double left = position.left(screenWidth, width);
			double top = position.top(screenHeight, height);
			return new Box(name, left, top, left + width, top + height);
		}
	}

	private static final Element SCOREBOARD = new Element("scoreboard", HudDefaults.SCOREBOARD, 124, 15 * 9 + 10);

	private static final List<Element> ELEMENTS = List.of(
			new Element("fps", HudDefaults.FPS, 46, 14),
			new Element("cps", HudDefaults.CPS, 46, 14),
			new Element("ping", HudDefaults.PING, 46, 14),
			new Element("coordinates", HudDefaults.COORDINATES, 76, 34),
			new Element("toggle sprint", HudDefaults.TOGGLE_SPRINT, 112, 14),
			new Element("potion effects", HudDefaults.POTION_EFFECTS, 100, 58),
			new Element("direction", HudDefaults.DIRECTION, 116, 14),
			new Element("clock", HudDefaults.CLOCK, 64, 24),
			new Element("keystrokes", HudDefaults.KEYSTROKES, 64, 76),
			new Element("armor status", HudDefaults.ARMOR_STATUS, 44, 84));

	/** 1920x1080 and 1280x720 at automatic GUI scale. */
	@Test
	void noOverlapsWithAFullSidebar() {
		assertClear(480, 270, true);
		assertClear(640, 360, true);
	}

	/**
	 * 2560x1440 at automatic GUI scale is only 240 tall, and a 15-line board fills most of the
	 * right edge there, so the board is left out; everything else must still fit.
	 */
	@Test
	void noOverlapsAt1440p() {
		assertClear(426, 240, false);
	}

	@Test
	void scoreboardDefaultMatchesVanillaFifteenLineSidebar() {
		for (int height : new int[] { 240, 270, 360 }) {
			Box board = SCOREBOARD.place(480, height);
			// Gui.displayScoreboardSidebar: bottom = height / 2 + lines * 9 / 3, title row 10 above the lines.
			int lines = 15 * 9;
			int bottom = height / 2 + lines / 3;
			assertEquals(bottom, board.bottom(), 1.0, "bottom at " + height);
			assertEquals(bottom - lines - 10, board.top(), 1.0, "top at " + height);
			assertEquals(479, board.right(), 1.0);
		}
	}

	private static void assertClear(int width, int height, boolean withSidebar) {
		List<Box> boxes = new ArrayList<>();

		for (Element element : ELEMENTS) {
			boxes.add(element.place(width, height));
		}

		if (withSidebar) {
			boxes.add(SCOREBOARD.place(width, height));
		}

		String at = " at " + width + "x" + height;
		// One boss bar (name at y 3, bar at 12..17) and the hotbar with hearts, armor and food above it.
		Box bossBar = new Box("boss bar", width / 2.0 - 91, 3, width / 2.0 + 91, 17);
		Box hotbar = new Box("hotbar", width / 2.0 - 91, height - 49, width / 2.0 + 91, height);

		for (int i = 0; i < boxes.size(); i++) {
			Box box = boxes.get(i);
			assertTrue(box.left() >= 0 && box.top() >= 0 && box.right() <= width && box.bottom() <= height, box + " off screen" + at);
			assertTrue(!box.intersects(bossBar), box.name() + " covers the boss bar" + at);
			assertTrue(!box.intersects(hotbar), box.name() + " covers the hotbar" + at);

			for (int j = i + 1; j < boxes.size(); j++) {
				Box other = boxes.get(j);
				assertTrue(!box.intersects(other), box.name() + " overlaps " + other.name() + at + ": " + box + " " + other);
			}
		}
	}
}
