package dev.waveclient.gui.widget;

import java.util.Objects;

import dev.waveclient.setting.ColorSetting;
import dev.waveclient.util.ColorMath;

/**
 * The hue/saturation/value/alpha state behind a color picker, writing every edit straight to a
 * {@link ColorSetting}.
 *
 * <p>HSV is kept here rather than re-derived from the setting after each edit: dragging to black
 * or gray would otherwise lose the hue (and black the saturation), making the picker's markers
 * jump. The setting is re-read only when it changes from somewhere else, such as the hex field or
 * a reset.
 */
public final class ColorPickerModel {
	private final ColorSetting setting;
	private final float[] hsv = new float[3];
	private float hue;
	private float saturation;
	private float value;
	private int alpha;
	private int lastSeen;

	public ColorPickerModel(ColorSetting setting) {
		this.setting = Objects.requireNonNull(setting, "setting");
		load(setting.get());
	}

	/** Picks up a value set elsewhere. Call before reading the state each frame. */
	public void sync() {
		if (setting.get() != lastSeen) {
			load(setting.get());
		}
	}

	public ColorSetting setting() {
		return setting;
	}

	public float hue() {
		return hue;
	}

	public float saturation() {
		return saturation;
	}

	public float value() {
		return value;
	}

	/** 0 to 255. Always 255 for settings without alpha. */
	public int alpha() {
		return alpha;
	}

	/** The opaque color at full saturation and value for the current hue, for the picker's square. */
	public int pureHue() {
		return ColorMath.hsvToRgb(hue, 1, 1);
	}

	public void setSaturationValue(float saturation, float value) {
		this.saturation = clamp01(saturation);
		this.value = clamp01(value);
		write();
	}

	public void setHue(float hue) {
		this.hue = clamp01(hue);
		write();
	}

	public void setAlpha(int alpha) {
		this.alpha = setting.allowsAlpha() ? Math.max(0, Math.min(255, alpha)) : 255;
		write();
	}

	private void write() {
		setting.set(ColorMath.withAlpha(ColorMath.hsvToRgb(hue, saturation, value), alpha));
		lastSeen = setting.get();
	}

	private void load(int argb) {
		ColorMath.rgbToHsv(argb, hsv);

		// Black has no saturation or hue, and gray has no hue: keep the previous ones.
		if (hsv[2] > 0) {
			if (hsv[1] > 0) {
				hue = hsv[0];
			}

			saturation = hsv[1];
		}

		value = hsv[2];
		alpha = argb >>> 24;
		lastSeen = argb;
	}

	private static float clamp01(float v) {
		return v < 0 ? 0 : v > 1 ? 1 : v;
	}
}
