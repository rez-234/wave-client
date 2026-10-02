package dev.waveclient.gui.widget;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;

import org.junit.jupiter.api.Test;

import dev.waveclient.input.Keybind;

class KeyCaptureTest {
	@Test
	void keys() {
		assertSame(KeyCapture.Result.CANCEL, KeyCapture.onKey(256));
		assertSame(KeyCapture.Result.UNBIND, KeyCapture.onKey(259));
		assertSame(KeyCapture.Result.UNBIND, KeyCapture.onKey(261));
		assertEquals(Keybind.key(67), KeyCapture.onKey(67).binding());
		assertEquals(KeyCapture.Kind.BIND, KeyCapture.onKey(344).kind());
		assertSame(KeyCapture.Result.CANCEL, KeyCapture.onKey(-1), "GLFW_KEY_UNKNOWN");
	}

	@Test
	void mouseButtons() {
		assertSame(KeyCapture.Result.CANCEL, KeyCapture.onMouse(0));
		assertSame(KeyCapture.Result.CANCEL, KeyCapture.onMouse(1));
		assertEquals(Keybind.mouse(2), KeyCapture.onMouse(2).binding());
		assertEquals(Keybind.mouse(4), KeyCapture.onMouse(4).binding());
		assertSame(KeyCapture.Result.CANCEL, KeyCapture.onMouse(99));
	}
}
