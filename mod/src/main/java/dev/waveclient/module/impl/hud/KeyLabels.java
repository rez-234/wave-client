package dev.waveclient.module.impl.hud;

/**
 * Short labels for keys whose game names don't fit in a keystrokes cell ("Left Arrow",
 * "Keypad 4", "Left Shift"). Keyed by GLFW key code; other keys keep the game's name.
 */
public final class KeyLabels {
	private KeyLabels() {
	}

	/** A short label for the GLFW key, or null to use the game's name. */
	public static String shortName(int glfwKey) {
		if (glfwKey >= 320 && glfwKey <= 329) {
			return "KP" + (glfwKey - 320);
		}

		return switch (glfwKey) {
			case 32 -> "Space";
			case 257 -> "Enter";
			case 258 -> "Tab";
			case 259 -> "Bksp";
			case 260 -> "Ins";
			case 261 -> "Del";
			case 262 -> "→";
			case 263 -> "←";
			case 264 -> "↓";
			case 265 -> "↑";
			case 266 -> "PgUp";
			case 267 -> "PgDn";
			case 268 -> "Home";
			case 269 -> "End";
			case 280 -> "Caps";
			case 330 -> "KP.";
			case 331 -> "KP/";
			case 332 -> "KP*";
			case 333 -> "KP-";
			case 334 -> "KP+";
			case 335 -> "KPEnt";
			case 336 -> "KP=";
			case 340 -> "LShift";
			case 341 -> "LCtrl";
			case 342 -> "LAlt";
			case 344 -> "RShift";
			case 345 -> "RCtrl";
			case 346 -> "RAlt";
			default -> null;
		};
	}
}
