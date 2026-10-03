package dev.waveclient.input;

/**
 * Whether a hold-or-toggle key (zoom, freelook, snaplook) is engaged, given its presses and
 * releases.
 */
public final class HoldToggle {
	private boolean engaged;

	public boolean engaged() {
		return engaged;
	}

	/** @return whether the key is engaged after this press */
	public boolean press(KeyMode mode) {
		engaged = mode != KeyMode.TOGGLE || !engaged;
		return engaged;
	}

	/** @return whether the key is engaged after this release */
	public boolean release(KeyMode mode) {
		if (mode == KeyMode.HOLD) {
			engaged = false;
		}

		return engaged;
	}

	/**
	 * The mode setting changed. Toggled on and then switched to Hold, the key would never see
	 * the release that ends it, so it disengages unless the key is down right now.
	 *
	 * @return whether the key is still engaged
	 */
	public boolean modeChanged(KeyMode mode, boolean keyDown) {
		if (mode == KeyMode.HOLD && !keyDown) {
			engaged = false;
		}

		return engaged;
	}

	public void reset() {
		engaged = false;
	}
}
