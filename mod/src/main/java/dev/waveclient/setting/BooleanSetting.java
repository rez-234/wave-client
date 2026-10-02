package dev.waveclient.setting;

import java.util.Locale;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

public final class BooleanSetting extends Setting<BooleanSetting> {
	private final boolean defaultValue;
	private boolean value;

	public BooleanSetting(String id, String name, boolean defaultValue) {
		super(id, name);
		this.defaultValue = defaultValue;
		this.value = defaultValue;
	}

	public boolean get() {
		return value;
	}

	public void set(boolean value) {
		if (this.value != value) {
			this.value = value;
			changed();
		}
	}

	public void toggle() {
		set(!value);
	}

	public boolean defaultValue() {
		return defaultValue;
	}

	@Override
	public void reset() {
		set(defaultValue);
	}

	@Override
	public boolean isDefault() {
		return value == defaultValue;
	}

	@Override
	public JsonElement toJson() {
		return new JsonPrimitive(value);
	}

	@Override
	public void fromJson(JsonElement json) {
		if (json != null && json.isJsonPrimitive() && json.getAsJsonPrimitive().isBoolean()) {
			set(json.getAsBoolean());
		}
	}

	@Override
	public boolean parse(String input) {
		switch (input.trim().toLowerCase(Locale.ROOT)) {
			case "true", "on", "yes", "1" -> set(true);
			case "false", "off", "no", "0" -> set(false);
			case "toggle" -> toggle();
			default -> {
				return false;
			}
		}

		return true;
	}

	@Override
	public String displayValue() {
		return value ? "On" : "Off";
	}
}
