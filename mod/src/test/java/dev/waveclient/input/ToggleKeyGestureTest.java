package dev.waveclient.input;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ToggleKeyGestureTest {
	@Test
	void freshPressAndReleaseCloses() {
		ToggleKeyGesture gesture = new ToggleKeyGesture(false);
		gesture.onPress();
		assertTrue(gesture.onRelease());
	}

	@Test
	void theOpeningPressIsIgnoredIncludingRepeats() {
		ToggleKeyGesture gesture = new ToggleKeyGesture(true);
		gesture.onPress();
		gesture.onPress();
		gesture.onPress();
		assertFalse(gesture.onRelease(), "releasing the key that opened the screen doesn't close it");

		gesture.onPress();
		assertTrue(gesture.onRelease(), "the next press and release does");
	}

	@Test
	void repeatsOfAFreshPressStillClose() {
		ToggleKeyGesture gesture = new ToggleKeyGesture(false);
		gesture.onPress();
		gesture.onPress();
		gesture.onPress();
		assertTrue(gesture.onRelease());
	}

	@Test
	void usedAsAModifierDoesNotClose() {
		ToggleKeyGesture gesture = new ToggleKeyGesture(false);
		gesture.onPress();
		gesture.onOtherInput();
		assertFalse(gesture.onRelease(), "Right Shift + arrow");

		gesture.onPress();
		assertTrue(gesture.onRelease(), "the modifier state doesn't leak into the next press");
	}

	@Test
	void otherInputWithoutTheKeyHeldChangesNothing() {
		ToggleKeyGesture gesture = new ToggleKeyGesture(false);
		gesture.onOtherInput();
		gesture.onPress();
		assertTrue(gesture.onRelease());
	}

	@Test
	void releaseWithoutPressDoesNotClose() {
		assertFalse(new ToggleKeyGesture(false).onRelease());
	}
}
