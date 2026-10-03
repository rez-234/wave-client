package dev.waveclient.module.impl.chat;

import dev.waveclient.setting.EnumSetting;

/** The click that copies a chat message. */
public enum CopyTrigger implements EnumSetting.Labeled {
	/** Cmd on macOS. Shift+click stays vanilla's "insert into chat". */
	CTRL_CLICK("Ctrl/Cmd + click"),
	RIGHT_CLICK("Right-click");

	private final String label;

	CopyTrigger(String label) {
		this.label = label;
	}

	@Override
	public String label() {
		return label;
	}

	/**
	 * @param editModifierDown Ctrl, or Cmd on macOS (where Ctrl+click arrives as a right-click)
	 */
	public boolean matches(int button, boolean editModifierDown, boolean shiftDown) {
		return switch (this) {
			case CTRL_CLICK -> button == 0 && editModifierDown && !shiftDown;
			case RIGHT_CLICK -> button == 1 && !shiftDown;
		};
	}
}
