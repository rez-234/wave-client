package dev.waveclient.input;

/**
 * Decides when the key that opened a screen should close it again: on release, and only for a
 * press made inside the screen with nothing else happening while it was held.
 *
 * <ul>
 *   <li>The press that opened the screen may still be held when the screen appears. Its
 *       auto-repeats and its release are ignored; otherwise holding the key a moment too long
 *       would flicker the screen shut.</li>
 *   <li>If anything else is pressed, clicked or dragged while the key is held, the key was being
 *       used as a modifier (e.g. Right Shift + arrow to nudge further), so releasing it doesn't
 *       close the screen.</li>
 * </ul>
 */
public final class ToggleKeyGesture {
	private boolean ignoreUntilReleased;
	private boolean held;
	private boolean usedAsModifier;

	/** @param heldWhenOpened whether the toggle key is still down as the screen opens */
	public ToggleKeyGesture(boolean heldWhenOpened) {
		this.ignoreUntilReleased = heldWhenOpened;
	}

	/** The toggle key was pressed (or auto-repeated). */
	public void onPress() {
		if (!ignoreUntilReleased && !held) {
			held = true;
			usedAsModifier = false;
		}
	}

	/** Any other key, click, scroll or drag. */
	public void onOtherInput() {
		if (held) {
			usedAsModifier = true;
		}
	}

	/**
	 * The toggle key was released.
	 *
	 * @return whether the screen should close now
	 */
	public boolean onRelease() {
		boolean close = !ignoreUntilReleased && held && !usedAsModifier;
		ignoreUntilReleased = false;
		held = false;
		usedAsModifier = false;
		return close;
	}
}
