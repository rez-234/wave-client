package dev.waveclient.input;

import dev.waveclient.setting.EnumSetting;

/** How a module's key engages it: only while held, or pressed once to turn on and again to turn off. */
public enum KeyMode implements EnumSetting.Labeled {
	HOLD("Hold"),
	TOGGLE("Toggle");

	private final String label;

	KeyMode(String label) {
		this.label = label;
	}

	@Override
	public String label() {
		return label;
	}
}
