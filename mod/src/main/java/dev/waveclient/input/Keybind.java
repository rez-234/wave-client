package dev.waveclient.input;

import java.util.Locale;
import java.util.Objects;

/**
 * A key or mouse button, identified by its GLFW code.
 *
 * <p>Serialized as {@code none}, {@code key:<name or code>} (e.g. {@code key:rshift}) or
 * {@code mouse:<button>} where button 1 is the left mouse button.
 */
public record Keybind(Type type, int code) {
	public enum Type {
		NONE, KEY, MOUSE
	}

	public static final Keybind NONE = new Keybind(Type.NONE, -1);

	public Keybind {
		Objects.requireNonNull(type, "type");

		switch (type) {
			case NONE -> code = -1;
			case KEY -> {
				if (code < KeyNames.KEY_FIRST || code > KeyNames.KEY_LAST) {
					throw new IllegalArgumentException("Invalid GLFW key code: " + code);
				}
			}
			case MOUSE -> {
				if (code < 0 || code > KeyNames.MOUSE_LAST) {
					throw new IllegalArgumentException("Invalid mouse button: " + code);
				}
			}
		}
	}

	public static Keybind key(int glfwKey) {
		return new Keybind(Type.KEY, glfwKey);
	}

	/** @param button GLFW mouse button, 0 = left, 1 = right, 2 = middle */
	public static Keybind mouse(int button) {
		return new Keybind(Type.MOUSE, button);
	}

	public boolean isBound() {
		return type != Type.NONE;
	}

	public boolean matchesKey(int glfwKey) {
		return type == Type.KEY && code == glfwKey;
	}

	public boolean matchesMouse(int button) {
		return type == Type.MOUSE && code == button;
	}

	public String serialize() {
		return switch (type) {
			case NONE -> "none";
			case KEY -> "key:" + KeyNames.keyId(code);
			case MOUSE -> "mouse:" + (code + 1);
		};
	}

	public String displayName() {
		return switch (type) {
			case NONE -> "None";
			case KEY -> KeyNames.keyLabel(code);
			case MOUSE -> KeyNames.mouseLabel(code);
		};
	}

	/**
	 * Parses the serialized form. As a convenience for commands, a bare key name such as
	 * {@code c} or {@code rshift} and {@code mouse4}-style names are accepted too.
	 *
	 * @return the keybind, or {@code null} if the input is not understood
	 */
	public static Keybind parse(String input) {
		String s = input.trim().toLowerCase(Locale.ROOT);

		if (s.isEmpty()) {
			return null;
		}

		if (s.equals("none") || s.equals("unbound")) {
			return NONE;
		}

		if (s.startsWith("mouse")) {
			String number = s.substring(5);

			if (number.startsWith(":")) {
				number = number.substring(1);
			}

			try {
				int button = Integer.parseInt(number) - 1;
				return button >= 0 && button <= KeyNames.MOUSE_LAST ? mouse(button) : null;
			} catch (NumberFormatException e) {
				return null;
			}
		}

		String keyPart = s.startsWith("key:") ? s.substring(4) : s;
		int code = KeyNames.keyCode(keyPart);
		return code >= 0 ? key(code) : null;
	}
}
