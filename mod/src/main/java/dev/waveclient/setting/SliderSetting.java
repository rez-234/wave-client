package dev.waveclient.setting;

import java.math.BigDecimal;
import java.util.Locale;
import java.util.Objects;

import com.google.gson.JsonElement;
import com.google.gson.JsonPrimitive;

/** A number between {@code min} and {@code max}, snapped to {@code step} (0 means continuous). */
public final class SliderSetting extends Setting<SliderSetting> {
	private final double min;
	private final double max;
	private final double step;
	private final double defaultValue;
	private final int decimals;
	private final double roundingFactor;
	private String unit = "";
	private double value;

	public SliderSetting(String id, String name, double defaultValue, double min, double max, double step) {
		super(id, name);

		if (!(min < max) || !Double.isFinite(min) || !Double.isFinite(max)) {
			throw new IllegalArgumentException("Invalid range [" + min + ", " + max + "] for " + id);
		}

		if (!(step >= 0) || !Double.isFinite(step)) {
			throw new IllegalArgumentException("Invalid step " + step + " for " + id);
		}

		this.min = min;
		this.max = max;
		this.step = step;
		this.decimals = step == 0 ? 2 : Math.max(0, BigDecimal.valueOf(step).stripTrailingZeros().scale());
		this.roundingFactor = Math.pow(10, decimals);
		this.defaultValue = normalize(defaultValue);

		if (this.defaultValue != defaultValue) {
			throw new IllegalArgumentException("Default " + defaultValue + " is not a valid value for " + id);
		}

		this.value = this.defaultValue;
	}

	public double get() {
		return value;
	}

	public float getFloat() {
		return (float) value;
	}

	public int getInt() {
		return (int) Math.round(value);
	}

	/** Clamps and snaps the value. NaN and infinities are ignored. */
	public void set(double value) {
		if (!Double.isFinite(value)) {
			return;
		}

		double normalized = normalize(value);

		if (normalized != this.value) {
			this.value = normalized;
			changed();
		}
	}

	public double min() {
		return min;
	}

	public double max() {
		return max;
	}

	public double step() {
		return step;
	}

	public double defaultValue() {
		return defaultValue;
	}

	/**
	 * Text shown after the number, such as {@code "%"} or {@code "x"}. Include a leading space if
	 * the unit needs one ({@code " ms"}). Typed input may include it.
	 */
	public SliderSetting unit(String unit) {
		this.unit = Objects.requireNonNull(unit, "unit");
		return this;
	}

	public String unit() {
		return unit;
	}

	/** How far one arrow-key press moves the value: the step, or 1% of the range if continuous. */
	public double keyboardStep() {
		return step > 0 ? step : (max - min) / 100;
	}

	/** Position of the value within the range, from 0 to 1. Used by slider widgets. */
	public double fraction() {
		return (value - min) / (max - min);
	}

	public void setFraction(double fraction) {
		set(min + fraction * (max - min));
	}

	private double normalize(double v) {
		double clamped = Math.min(max, Math.max(min, v));

		if (step > 0) {
			clamped = min + Math.round((clamped - min) / step) * step;
			clamped = Math.min(max, Math.max(min, clamped));
		}

		// Remove floating-point noise such as 0.30000000000000004.
		return Math.round(clamped * roundingFactor) / roundingFactor;
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
		if (json != null && json.isJsonPrimitive() && json.getAsJsonPrimitive().isNumber()) {
			set(json.getAsDouble());
		}
	}

	@Override
	public boolean parse(String input) {
		String s = input.trim();

		if (!unit.isBlank() && s.toLowerCase(Locale.ROOT).endsWith(unit.trim().toLowerCase(Locale.ROOT))) {
			s = s.substring(0, s.length() - unit.trim().length()).trim();
		}

		try {
			double parsed = Double.parseDouble(s);

			if (!Double.isFinite(parsed)) {
				return false;
			}

			set(parsed);
			return true;
		} catch (NumberFormatException e) {
			return false;
		}
	}

	@Override
	public String displayValue() {
		return formatNumber(value) + unit;
	}

	/** The value without its unit, with as many decimals as the step has. */
	public String formatNumber(double v) {
		return String.format(Locale.ROOT, "%." + decimals + "f", v);
	}
}
