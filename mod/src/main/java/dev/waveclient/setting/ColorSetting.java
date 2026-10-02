package dev.waveclient.setting;

import java.util.Locale;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

/** An ARGB color, stored in JSON as {@code #AARRGGBB}. */
public final class ColorSetting extends Setting<ColorSetting> {
	private final int defaultValue;
	private final boolean allowAlpha;
	private int value;

	public ColorSetting(String id, String name, int defaultArgb) {
		this(id, name, defaultArgb, true);
	}

	public ColorSetting(String id, String name, int defaultArgb, boolean allowAlpha) {
		super(id, name);
		this.allowAlpha = allowAlpha;
		this.defaultValue = allowAlpha ? defaultArgb : defaultArgb | 0xFF000000;
		this.value = this.defaultValue;
	}

	/** The color as packed ARGB, ready to pass to draw calls. */
	public int get() {
		return value;
	}

	public void set(int argb) {
		int v = allowAlpha ? argb : argb | 0xFF000000;

		if (v != value) {
			value = v;
			changed();
		}
	}

	public boolean allowsAlpha() {
		return allowAlpha;
	}

	public int alpha() {
		return value >>> 24;
	}

	public int red() {
		return (value >> 16) & 0xFF;
	}

	public int green() {
		return (value >> 8) & 0xFF;
	}

	public int blue() {
		return value & 0xFF;
	}

	public int defaultValue() {
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
		return new JsonPrimitive(toHex(value));
	}

	@Override
	public void fromJson(JsonElement json) {
		if (json != null && json.isJsonPrimitive() && json.getAsJsonPrimitive().isString()) {
			parse(json.getAsString());
		}
	}

	@Override
	public boolean parse(String input) {
		long parsed = parseHex(input);

		if (parsed < 0) {
			return false;
		}

		set((int) parsed);
		return true;
	}

	@Override
	public String displayValue() {
		return toHex(value);
	}

	public static String toHex(int argb) {
		return String.format(Locale.ROOT, "#%08X", argb);
	}

	/**
	 * Parses {@code #RRGGBB} (opaque) or {@code #AARRGGBB}; the {@code #} is optional.
	 *
	 * @return the ARGB value, or -1 if the input is not a color
	 */
	public static long parseHex(String input) {
		String s = input.trim();

		if (s.startsWith("#")) {
			s = s.substring(1);
		}

		if (s.length() != 6 && s.length() != 8) {
			return -1;
		}

		for (int i = 0; i < s.length(); i++) {
			if (Character.digit(s.charAt(i), 16) < 0) {
				return -1;
			}
		}

		long v = Long.parseLong(s, 16);
		return s.length() == 6 ? v | 0xFF000000L : v;
	}
}
