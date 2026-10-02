package dev.waveclient.gui.widget;

/**
 * A destructive action that needs a second click within a few seconds, like "Reset to
 * defaults". A second activation that comes almost immediately (a double-click, or Enter held
 * down) doesn't count as confirming.
 */
public final class TwoStepConfirm {
	private final long windowMs;
	private final long minDelayMs;
	private boolean armed;
	private long armedAt;

	/**
	 * @param windowMs   how long the action stays armed after the first click
	 * @param minDelayMs a confirmation sooner than this after arming is ignored
	 */
	public TwoStepConfirm(long windowMs, long minDelayMs) {
		this.windowMs = windowMs;
		this.minDelayMs = minDelayMs;
	}

	/**
	 * Registers a click at time {@code now} (milliseconds).
	 *
	 * @return true when this click confirms the action
	 */
	public boolean click(long now) {
		long since = now - armedAt;

		if (armed && since >= 0 && since < windowMs) {
			if (since < minDelayMs) {
				return false;
			}

			armed = false;
			return true;
		}

		armed = true;
		armedAt = now;
		return false;
	}

	/** Whether the next click would confirm (the label should say so). */
	public boolean isArmed(long now) {
		long since = now - armedAt;
		return armed && since >= 0 && since < windowMs;
	}
}
