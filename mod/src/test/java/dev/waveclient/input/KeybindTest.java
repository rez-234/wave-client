package dev.waveclient.input;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import dev.waveclient.setting.KeybindSetting;

class KeybindTest {
	@Test
	void serializeAndParseRoundTrip() {
		for (Keybind bind : List.of(Keybind.NONE, Keybind.key(344), Keybind.key(67), Keybind.key(48), Keybind.key(299), Keybind.mouse(0), Keybind.mouse(4))) {
			assertEquals(bind, Keybind.parse(bind.serialize()), bind.serialize());
		}
	}

	@Test
	void friendlyForms() {
		assertEquals("key:rshift", Keybind.key(344).serialize());
		assertEquals("key:c", Keybind.key(67).serialize());
		assertEquals("mouse:4", Keybind.mouse(3).serialize());
		assertEquals(Keybind.key(67), Keybind.parse("C"));
		assertEquals(Keybind.key(344), Keybind.parse("344"));
		assertEquals(Keybind.key(344), Keybind.parse("key:344"));
		assertEquals(Keybind.mouse(3), Keybind.parse("mouse4"));
		assertEquals(Keybind.NONE, Keybind.parse("unbound"));
	}

	@Test
	void invalidInputReturnsNull() {
		assertNull(Keybind.parse(""));
		assertNull(Keybind.parse("key:doesnotexist"));
		assertNull(Keybind.parse("mouse:0"));
		assertNull(Keybind.parse("mouse:9"));
		assertNull(Keybind.parse("mouse"));
		assertNull(Keybind.parse("12"));
		assertNull(Keybind.parse("999"));
	}

	@Test
	void constructorValidatesCodes() {
		assertThrows(IllegalArgumentException.class, () -> Keybind.key(-1));
		assertThrows(IllegalArgumentException.class, () -> Keybind.key(400));
		assertThrows(IllegalArgumentException.class, () -> Keybind.mouse(8));
		assertEquals(-1, new Keybind(Keybind.Type.NONE, 55).code());
	}

	@Test
	void displayNames() {
		assertEquals("Right Shift", Keybind.key(344).displayName());
		assertEquals("Left Mouse", Keybind.mouse(0).displayName());
		assertEquals("Mouse 5", Keybind.mouse(4).displayName());
		assertEquals("None", Keybind.NONE.displayName());
	}

	@Test
	void dispatcherOnlyPressesWithoutScreen() {
		List<String> events = new ArrayList<>();
		KeybindSetting zoom = new KeybindSetting("zoom", "Zoom", Keybind.key(67))
				.onPress(() -> events.add("press"))
				.onRelease(() -> events.add("release"));
		KeybindDispatcher dispatcher = new KeybindDispatcher();
		dispatcher.register(zoom);
		dispatcher.register(zoom);
		assertEquals(1, dispatcher.all().size());

		dispatcher.onKey(67, KeybindDispatcher.PRESS, true);
		assertFalse(zoom.isDown());

		dispatcher.onKey(67, KeybindDispatcher.PRESS, false);
		dispatcher.onKey(67, 2, false);
		assertTrue(zoom.isDown());

		// Released while a screen is open: still delivered, so it can't get stuck.
		dispatcher.onKey(67, KeybindDispatcher.RELEASE, true);
		assertFalse(zoom.isDown());

		dispatcher.onKey(68, KeybindDispatcher.PRESS, false);
		assertEquals(List.of("press", "release"), events);
	}

	@Test
	void dispatcherHandlesMouseAndReleaseAll() {
		KeybindSetting side = new KeybindSetting("side", "Side", Keybind.mouse(3));
		KeybindDispatcher dispatcher = new KeybindDispatcher();
		dispatcher.register(side);

		dispatcher.onKey(3, KeybindDispatcher.PRESS, false);
		assertFalse(side.isDown());
		dispatcher.onMouseButton(3, KeybindDispatcher.PRESS, false);
		assertTrue(side.isDown());
		dispatcher.releaseAll();
		assertFalse(side.isDown());
	}

	@Test
	void failingActionDoesNotPropagate() {
		KeybindSetting broken = new KeybindSetting("broken", "Broken", Keybind.key(66))
				.onPress(() -> {
					throw new IllegalStateException("boom");
				});
		KeybindSetting other = new KeybindSetting("other", "Other", Keybind.key(66));
		KeybindDispatcher dispatcher = new KeybindDispatcher();
		dispatcher.register(broken);
		dispatcher.register(other);

		dispatcher.onKey(66, KeybindDispatcher.PRESS, false);
		assertTrue(other.isDown());
	}
}
