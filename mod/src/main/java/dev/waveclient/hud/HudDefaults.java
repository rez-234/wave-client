package dev.waveclient.hud;

/**
 * Where each HUD element starts on a fresh config, kept in one place so the layout can be
 * checked as a whole (HudDefaultsTest): at the automatic GUI size of 1080p and 720p the defaults
 * don't overlap each other, the boss bar, the hotbar or a full 15-line sidebar. At 1440p (240 GUI
 * pixels tall) a 15-line sidebar takes most of the right edge, so only the rest is checked there.
 *
 * <p>Left column, top down: FPS, CPS, ping, coordinates, toggle sprint, potion effects. Top
 * center: direction, under the boss bar. Right: clock at the top, the sidebar where vanilla puts
 * a 15-line board, keystrokes and armor at the bottom. Chat isn't avoided: it is only shown
 * briefly, and every element can be moved in the HUD editor.
 */
public final class HudDefaults {
	public record Spot(Anchor anchor, int x, int y) {
	}

	public static final Spot FPS = new Spot(Anchor.TOP_LEFT, 4, 4);
	public static final Spot CPS = new Spot(Anchor.TOP_LEFT, 4, 22);
	public static final Spot PING = new Spot(Anchor.TOP_LEFT, 4, 40);
	public static final Spot COORDINATES = new Spot(Anchor.TOP_LEFT, 4, 58);
	public static final Spot TOGGLE_SPRINT = new Spot(Anchor.TOP_LEFT, 4, 96);
	public static final Spot POTION_EFFECTS = new Spot(Anchor.TOP_LEFT, 4, 114);
	/** Below one boss bar. */
	public static final Spot DIRECTION = new Spot(Anchor.TOP_CENTER, 0, 24);
	public static final Spot CLOCK = new Spot(Anchor.TOP_RIGHT, -4, 4);
	/** Vanilla's place for a 15-line sidebar (vanilla centers it 1.5 px higher per line it has). */
	public static final Spot SCOREBOARD = new Spot(Anchor.MIDDLE_RIGHT, -1, -28);
	public static final Spot KEYSTROKES = new Spot(Anchor.BOTTOM_RIGHT, -4, -4);
	/** Left of the keystrokes. */
	public static final Spot ARMOR_STATUS = new Spot(Anchor.BOTTOM_RIGHT, -72, -4);

	private HudDefaults() {
	}
}
