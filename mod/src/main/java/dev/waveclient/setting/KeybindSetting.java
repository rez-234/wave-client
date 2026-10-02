package dev.waveclient.setting;

import java.util.Objects;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

import dev.waveclient.input.Keybind;

/**
 * A key or mouse button binding. Press and release events are delivered by
 * {@link dev.waveclient.input.KeybindDispatcher}, which also tracks whether the key is held.
 */
public final class KeybindSetting extends Setting<KeybindSetting> {
	private static final Runnable NOTHING = () -> { };

	private final Keybind defaultValue;
	private Keybind value;
	private boolean down;
	private Runnable pressAction = NOTHING;
	private Runnable releaseAction = NOTHING;

	public KeybindSetting(String id, String name, Keybind defaultValue) {
		super(id, name);
		this.defaultValue = Objects.requireNonNull(defaultValue, "defaultValue");
		this.value = defaultValue;
	}

	public Keybind get() {
		return value;
	}

	public void set(Keybind keybind) {
		if (keybind == null || keybind.equals(value)) {
			return;
		}

		// Never leave a "held" state behind for a key that is no longer bound.
		release();
		value = keybind;
		changed();
	}

	/** Whether the bound key is currently held (pressed while no screen was open). */
	public boolean isDown() {
		return down;
	}

	/** Runs when the key is pressed while no screen is open. */
	public KeybindSetting onPress(Runnable action) {
		this.pressAction = Objects.requireNonNull(action, "action");
		return this;
	}

	public KeybindSetting onRelease(Runnable action) {
		this.releaseAction = Objects.requireNonNull(action, "action");
		return this;
	}

	/** Called by the dispatcher. */
	public void press() {
		if (!down) {
			down = true;
			pressAction.run();
		}
	}

	/** Called by the dispatcher, and when the binding changes or the window loses focus. */
	public void release() {
		if (down) {
			down = false;
			releaseAction.run();
		}
	}

	public Keybind defaultValue() {
		return defaultValue;
	}

	@Override
	public void reset() {
		set(defaultValue);
	}

	@Override
	public boolean isDefault() {
		return value.equals(defaultValue);
	}

	@Override
	public JsonElement toJson() {
		return new JsonPrimitive(value.serialize());
	}

	@Override
	public void fromJson(JsonElement json) {
		if (json != null && json.isJsonPrimitive() && json.getAsJsonPrimitive().isString()) {
			parse(json.getAsString());
		}
	}

	@Override
	public boolean parse(String input) {
		Keybind parsed = Keybind.parse(input);

		if (parsed == null) {
			return false;
		}

		set(parsed);
		return true;
	}

	@Override
	public String displayValue() {
		return value.displayName();
	}
}
