package dev.waveclient.input;

import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import dev.waveclient.module.SettingContainer;
import dev.waveclient.setting.KeybindSetting;
import dev.waveclient.setting.Setting;

/**
 * Delivers raw key and mouse button events to every {@link KeybindSetting}.
 *
 * <p>Presses only count while no screen is open, so typing in chat never toggles modules.
 * Releases are always delivered, so a key held while a screen opens is never stuck down.
 * Events are not consumed; vanilla still sees them.
 */
public final class KeybindDispatcher {
	/** GLFW action codes. */
	public static final int RELEASE = 0;
	public static final int PRESS = 1;

	private static final Logger LOGGER = LoggerFactory.getLogger("Wave Client");
	private static final KeybindSetting[] NONE = new KeybindSetting[0];

	private final List<KeybindSetting> registered = new ArrayList<>();
	private KeybindSetting[] binds = NONE;

	public void register(KeybindSetting setting) {
		if (!registered.contains(setting)) {
			registered.add(setting);
			binds = registered.toArray(NONE);
		}
	}

	/** Registers every keybind setting in the container. */
	public void registerAll(SettingContainer container) {
		for (Setting<?> setting : container.settings()) {
			if (setting instanceof KeybindSetting keybind) {
				register(keybind);
			}
		}
	}

	/** @param action GLFW action: 0 release, 1 press, 2 repeat (ignored) */
	public void onKey(int key, int action, boolean screenOpen) {
		for (KeybindSetting bind : binds) {
			if (bind.get().matchesKey(key)) {
				handle(bind, action, screenOpen);
			}
		}
	}

	/** @param button GLFW mouse button, 0 = left */
	public void onMouseButton(int button, int action, boolean screenOpen) {
		for (KeybindSetting bind : binds) {
			if (bind.get().matchesMouse(button)) {
				handle(bind, action, screenOpen);
			}
		}
	}

	/** Releases every held bind, e.g. when the window loses focus and release events can be missed. */
	public void releaseAll() {
		for (KeybindSetting bind : binds) {
			if (bind.isDown()) {
				safely(bind, false);
			}
		}
	}

	/** Every registered bind, for conflict detection in the GUI. */
	public List<KeybindSetting> all() {
		return List.of(binds);
	}

	private static void handle(KeybindSetting bind, int action, boolean screenOpen) {
		if (action == PRESS && !screenOpen) {
			safely(bind, true);
		} else if (action == RELEASE) {
			safely(bind, false);
		}
	}

	private static void safely(KeybindSetting bind, boolean press) {
		try {
			if (press) {
				bind.press();
			} else {
				bind.release();
			}
		} catch (RuntimeException e) {
			LOGGER.error("Keybind '{}' action failed", bind.id(), e);
		}
	}
}
