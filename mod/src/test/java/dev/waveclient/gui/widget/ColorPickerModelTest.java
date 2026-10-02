package dev.waveclient.gui.widget;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

import dev.waveclient.setting.ColorSetting;

class ColorPickerModelTest {
	private static final float EPS = 1e-3f;

	@Test
	void editsWriteThroughToTheSetting() {
		ColorSetting color = new ColorSetting("c", "C", 0xFFFFFFFF);
		ColorPickerModel model = new ColorPickerModel(color);
		model.setHue(0);
		model.setSaturationValue(1, 1);
		assertEquals(0xFFFF0000, color.get());

		model.setAlpha(0x40);
		assertEquals(0x40FF0000, color.get());
	}

	@Test
	void draggingToBlackKeepsHueAndSaturation() {
		ColorSetting color = new ColorSetting("c", "C", 0xFF00FF00);
		ColorPickerModel model = new ColorPickerModel(color);
		assertEquals(1 / 3f, model.hue(), EPS);

		model.setSaturationValue(0.7f, 0);
		assertEquals(0xFF000000, color.get());
		model.sync();
		assertEquals(1 / 3f, model.hue(), EPS, "the marker on the hue bar doesn't jump to red");
		assertEquals(0.7f, model.saturation(), EPS, "the marker in the square doesn't jump to the corner");

		model.setSaturationValue(0.7f, 1);
		assertEquals(0.3f, ((color.get() >> 16) & 0xFF) / 255f, 0.01f, "coming back up restores the green");
	}

	@Test
	void externalChangesAreSynced() {
		ColorSetting color = new ColorSetting("c", "C", 0xFFFF0000);
		ColorPickerModel model = new ColorPickerModel(color);
		color.parse("#0000FF");
		model.sync();
		assertEquals(4 / 6f, model.hue(), EPS);
		assertEquals(1, model.value(), EPS);

		color.parse("#808080");
		model.sync();
		assertEquals(4 / 6f, model.hue(), EPS, "gray keeps the previous hue");
		assertEquals(0, model.saturation(), EPS);
	}

	@Test
	void opaqueSettingsIgnoreAlpha() {
		ColorSetting color = new ColorSetting("c", "C", 0xFF336699, false);
		ColorPickerModel model = new ColorPickerModel(color);
		model.setAlpha(0x10);
		assertEquals(255, model.alpha());
		assertEquals(0xFF, color.get() >>> 24);
	}
}
