package dev.waveclient.gui.widget;

import dev.waveclient.input.Keybind;

/**
 * What a key or mouse press means while a keybind button is waiting for input.
 *
 * <ul>
 *   <li>Escape, or a left or right click, cancels and keeps the old binding. Left and right
 *       click are how the player uses the menu, and binding them would break the game's
 *       attack and use keys anyway.</li>
 *   <li>Backspace or Delete clears the binding.</li>
 *   <li>Any other key, or the middle or a side mouse button, becomes the new binding.</li>
 * </ul>
 */
public final class KeyCapture {
	public static final int GLFW_KEY_ESCAPE = 256;
	public static final int GLFW_KEY_BACKSPACE = 259;
	public static final int GLFW_KEY_DELETE = 261;

	/** The outcome of one press. {@code binding} is set only for {@link Kind#BIND}. */
	public record Result(Kind kind, Keybind binding) {
		public static final Result CANCEL = new Result(Kind.CANCEL, null);
		public static final Result UNBIND = new Result(Kind.UNBIND, Keybind.NONE);

		static Result bind(Keybind binding) {
			return new Result(Kind.BIND, binding);
		}
	}

	public enum Kind {
		BIND, UNBIND, CANCEL
	}

	private KeyCapture() {
	}

	public static Result onKey(int glfwKey) {
		return switch (glfwKey) {
			case GLFW_KEY_ESCAPE -> Result.CANCEL;
			case GLFW_KEY_BACKSPACE, GLFW_KEY_DELETE -> Result.UNBIND;
			default -> {
				try {
					yield Result.bind(Keybind.key(glfwKey));
				} catch (IllegalArgumentException e) {
					// GLFW_KEY_UNKNOWN (-1) and other codes Keybind can't store.
					yield Result.CANCEL;
				}
			}
		};
	}

	/** @param button GLFW mouse button, 0 = left */
	public static Result onMouse(int button) {
		if (button <= 1) {
			return Result.CANCEL;
		}

		try {
			return Result.bind(Keybind.mouse(button));
		} catch (IllegalArgumentException e) {
			return Result.CANCEL;
		}
	}
}
