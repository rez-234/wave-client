package dev.waveclient.input;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Friendly names for GLFW key codes, used in the config file and the {@code /wave} command.
 *
 * <p>GLFW codes are stable across Minecraft versions, so the config never depends on game
 * internals. In-game widgets show Minecraft's own localized key names instead.
 */
public final class KeyNames {
	public static final int KEY_FIRST = 32;
	public static final int KEY_LAST = 348;
	public static final int MOUSE_LAST = 7;

	private static final Map<Integer, String> ID_BY_CODE = new HashMap<>();
	private static final Map<Integer, String> LABEL_BY_CODE = new HashMap<>();
	private static final Map<String, Integer> CODE_BY_ID = new HashMap<>();

	static {
		key(32, "space", "Space");
		key(39, "apostrophe", "'");
		key(44, "comma", ",");
		key(45, "minus", "-");
		key(46, "period", ".");
		key(47, "slash", "/");

		for (int i = 0; i <= 9; i++) {
			key(48 + i, Integer.toString(i), Integer.toString(i));
		}

		key(59, "semicolon", ";");
		key(61, "equal", "=");

		for (char c = 'a'; c <= 'z'; c++) {
			key(65 + (c - 'a'), Character.toString(c), Character.toString(Character.toUpperCase(c)));
		}

		key(91, "lbracket", "[");
		key(92, "backslash", "\\");
		key(93, "rbracket", "]");
		key(96, "grave", "`");
		key(256, "escape", "Escape");
		key(257, "enter", "Enter");
		key(258, "tab", "Tab");
		key(259, "backspace", "Backspace");
		key(260, "insert", "Insert");
		key(261, "delete", "Delete");
		key(262, "right", "Right Arrow");
		key(263, "left", "Left Arrow");
		key(264, "down", "Down Arrow");
		key(265, "up", "Up Arrow");
		key(266, "pageup", "Page Up");
		key(267, "pagedown", "Page Down");
		key(268, "home", "Home");
		key(269, "end", "End");
		key(280, "capslock", "Caps Lock");
		key(281, "scrolllock", "Scroll Lock");
		key(282, "numlock", "Num Lock");
		key(283, "printscreen", "Print Screen");
		key(284, "pause", "Pause");

		for (int i = 1; i <= 25; i++) {
			key(289 + i, "f" + i, "F" + i);
		}

		for (int i = 0; i <= 9; i++) {
			key(320 + i, "kp" + i, "Keypad " + i);
		}

		key(330, "kpdecimal", "Keypad .");
		key(331, "kpdivide", "Keypad /");
		key(332, "kpmultiply", "Keypad *");
		key(333, "kpsubtract", "Keypad -");
		key(334, "kpadd", "Keypad +");
		key(335, "kpenter", "Keypad Enter");
		key(336, "kpequal", "Keypad =");
		key(340, "lshift", "Left Shift");
		key(341, "lctrl", "Left Ctrl");
		key(342, "lalt", "Left Alt");
		key(343, "lsuper", "Left Super");
		key(344, "rshift", "Right Shift");
		key(345, "rctrl", "Right Ctrl");
		key(346, "ralt", "Right Alt");
		key(347, "rsuper", "Right Super");
		key(348, "menu", "Menu");
	}

	private KeyNames() {
	}

	private static void key(int code, String id, String label) {
		ID_BY_CODE.put(code, id);
		LABEL_BY_CODE.put(code, label);
		CODE_BY_ID.put(id, code);
	}

	/** The config id for a key code, or the number itself if the key has no name. */
	public static String keyId(int code) {
		String id = ID_BY_CODE.get(code);
		return id != null ? id : Integer.toString(code);
	}

	public static String keyLabel(int code) {
		String label = LABEL_BY_CODE.get(code);
		return label != null ? label : "Key " + code;
	}

	/**
	 * Resolves a key name ({@code rshift}, {@code c}) or a raw GLFW code ({@code 344}).
	 *
	 * @return the GLFW key code, or -1 if unknown
	 */
	public static int keyCode(String idOrCode) {
		String s = idOrCode.trim().toLowerCase(Locale.ROOT);
		Integer named = CODE_BY_ID.get(s);

		if (named != null) {
			return named;
		}

		try {
			int code = Integer.parseInt(s);
			return code >= KEY_FIRST && code <= KEY_LAST ? code : -1;
		} catch (NumberFormatException e) {
			return -1;
		}
	}

	/**
	 * Whether pressing the key normally types a character (letters, digits, punctuation, space,
	 * the keypad's digits and operators), as opposed to function, navigation and modifier keys.
	 */
	public static boolean isPrintable(int code) {
		return (code >= 32 && code <= 162) || (code >= 320 && code <= 336 && code != 335);
	}

	public static String mouseLabel(int button) {
		return switch (button) {
			case 0 -> "Left Mouse";
			case 1 -> "Right Mouse";
			case 2 -> "Middle Mouse";
			default -> "Mouse " + (button + 1);
		};
	}
}
