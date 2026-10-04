package dev.waveclient.module.impl.movement;

import dev.waveclient.setting.EnumSetting;

/**
 * Emulates holding the sprint or sneak key: pressed once it stays down until pressed again.
 * The real key always works as normal, and when the matching vanilla toggle option is on,
 * vanilla's own toggle is left in charge.
 */
public final class ToggleKey {
	public enum Mode implements EnumSetting.Labeled {
		/** No emulation: only the real key. */
		HOLD("Hold (vanilla)"),
		TOGGLE("Toggle"),
		/** As if the key were always held. */
		ALWAYS("Always");

		private final String label;

		Mode(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	private boolean toggled;
	/** The last press flipped the toggle and the key hasn't been released since. */
	private boolean flipPending;

	/**
	 * A real press of the key.
	 *
	 * @param vanillaToggle whether vanilla's own toggle option for this key is on
	 * @param suppressed    whether emulation is paused (e.g. sneak while flying); a press then
	 *                      acts as a normal press and doesn't flip the toggle
	 */
	public void onPress(Mode mode, boolean vanillaToggle, boolean suppressed) {
		if (mode == Mode.TOGGLE && !vanillaToggle && !suppressed) {
			toggled = !toggled;
			flipPending = true;
		}
	}

	/**
	 * The key was held as a modifier for another key (Ctrl+Q drops a stack), not pressed to
	 * toggle: takes back the flip from its press, if it is still held.
	 */
	public void undoPendingFlip() {
		if (flipPending) {
			toggled = !toggled;
			flipPending = false;
		}
	}

	/** The key is up: a later chord no longer undoes its last press. */
	public void released() {
		flipPending = false;
	}

	/**
	 * Whether the key counts as down this tick.
	 *
	 * @param physicalDown what vanilla read for the key (includes vanilla's own toggle)
	 */
	public boolean effective(Mode mode, boolean physicalDown, boolean vanillaToggle, boolean suppressed) {
		if (physicalDown) {
			return true;
		}

		if (vanillaToggle || suppressed) {
			return false;
		}

		return mode == Mode.ALWAYS || (mode == Mode.TOGGLE && toggled);
	}

	/** Whether the emulated key is held, ignoring the real key. */
	public boolean engaged(Mode mode) {
		return mode == Mode.ALWAYS || (mode == Mode.TOGGLE && toggled);
	}

	public boolean toggled() {
		return toggled;
	}

	public void clear() {
		toggled = false;
		flipPending = false;
	}
}
