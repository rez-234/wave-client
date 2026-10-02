package dev.waveclient.setting;

import java.util.Locale;
import java.util.Objects;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

/** One choice out of an enum, e.g. a crosshair style. Stored in JSON as the constant's name. */
public final class EnumSetting<E extends Enum<E>> extends Setting<EnumSetting<E>> {
	/** Implement on an enum to control how its constants are shown in the GUI. */
	public interface Labeled {
		String label();
	}

	private final E[] values;
	private final E defaultValue;
	private E value;

	public EnumSetting(String id, String name, E defaultValue) {
		super(id, name);
		this.defaultValue = Objects.requireNonNull(defaultValue, "defaultValue");
		this.values = defaultValue.getDeclaringClass().getEnumConstants();
		this.value = defaultValue;
	}

	public E get() {
		return value;
	}

	public void set(E value) {
		if (value != null && value != this.value) {
			this.value = value;
			changed();
		}
	}

	/** Moves to the next (or previous) constant, wrapping around. */
	public void cycle(boolean forward) {
		int next = (value.ordinal() + (forward ? 1 : values.length - 1)) % values.length;
		set(values[next]);
	}

	/** All choices, in declaration order. Do not modify the returned array. */
	public E[] values() {
		return values;
	}

	public E defaultValue() {
		return defaultValue;
	}

	public static String labelOf(Enum<?> constant) {
		if (constant instanceof Labeled labeled) {
			return labeled.label();
		}

		String lower = constant.name().toLowerCase(Locale.ROOT).replace('_', ' ');
		return Character.toUpperCase(lower.charAt(0)) + lower.substring(1);
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
		return new JsonPrimitive(value.name());
	}

	@Override
	public void fromJson(JsonElement json) {
		if (json != null && json.isJsonPrimitive() && json.getAsJsonPrimitive().isString()) {
			parse(json.getAsString());
		}
	}

	@Override
	public boolean parse(String input) {
		String s = input.trim();

		for (E candidate : values) {
			if (candidate.name().equalsIgnoreCase(s) || labelOf(candidate).equalsIgnoreCase(s)) {
				set(candidate);
				return true;
			}
		}

		return false;
	}

	@Override
	public String displayValue() {
		return labelOf(value);
	}
}
