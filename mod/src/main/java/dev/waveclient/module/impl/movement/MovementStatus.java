package dev.waveclient.module.impl.movement;

/** The status line Toggle Sprint shows, e.g. "[Sprinting (Toggled)]". */
public enum MovementStatus {
	NONE(null),
	FLYING("[Flying]"),
	DESCENDING("[Descending]"),
	RIDING("[Riding]"),
	DISMOUNTING("[Dismounting]"),
	SNEAK_TOGGLED("[Sneaking (Toggled)]"),
	SNEAK_HELD("[Sneaking (Key Held)]"),
	SPRINT_TOGGLED("[Sprinting (Toggled)]"),
	SPRINT_HELD("[Sprinting (Key Held)]"),
	SPRINT_VANILLA("[Sprinting (Vanilla)]");

	private final String[] lines;

	MovementStatus(String text) {
		this.lines = text == null ? new String[0] : new String[] {text};
	}

	/** Prebuilt lines for the HUD (empty for {@link #NONE}). Don't modify. */
	public String[] lines() {
		return lines;
	}

	/**
	 * Picks the status, most specific first.
	 *
	 * @param shiftDown          the sneak input (real or emulated) this tick
	 * @param sneakToggled       the emulated sneak is engaged and not paused
	 * @param crouching          the player is crouching
	 * @param sprintEngaged      the emulated sprint is toggled on (or set to always)
	 * @param sprintKeyDown      the real sprint key is held
	 * @param sprinting          the player is sprinting
	 */
	public static MovementStatus resolve(boolean flying, boolean passenger, boolean shiftDown, boolean sneakToggled, boolean crouching,
			boolean sprintEngaged, boolean sprintKeyDown, boolean sprinting) {
		if (flying) {
			return shiftDown ? DESCENDING : FLYING;
		}

		if (passenger) {
			return shiftDown ? DISMOUNTING : RIDING;
		}

		if (sneakToggled) {
			return SNEAK_TOGGLED;
		}

		if (crouching) {
			return SNEAK_HELD;
		}

		if (sprintEngaged) {
			return SPRINT_TOGGLED;
		}

		if (sprinting) {
			return sprintKeyDown ? SPRINT_HELD : SPRINT_VANILLA;
		}

		return NONE;
	}
}
