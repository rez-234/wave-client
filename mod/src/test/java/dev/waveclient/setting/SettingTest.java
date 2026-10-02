package dev.waveclient.setting;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicInteger;

import com.google.gson.JsonNull;
import com.google.gson.JsonPrimitive;
import org.junit.jupiter.api.Test;

import dev.waveclient.input.Keybind;

class SettingTest {
	enum Style implements EnumSetting.Labeled {
		CROSS("Cross"), DOT("Dot"), CIRCLE("Circle");

		private final String label;

		Style(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	enum Plain {
		TWELVE_HOUR, TWENTY_FOUR_HOUR
	}

	@Test
	void sliderClampsAndSnapsToStep() {
		SliderSetting s = new SliderSetting("zoom", "Zoom", 4.0, 1.5, 50.0, 0.5);

		s.set(100);
		assertEquals(50.0, s.get());
		s.set(-3);
		assertEquals(1.5, s.get());
		s.set(4.26);
		assertEquals(4.5, s.get());
		s.set(4.24);
		assertEquals(4.0, s.get());
	}

	@Test
	void sliderRemovesFloatingPointNoise() {
		SliderSetting s = new SliderSetting("opacity", "Opacity", 0.0, 0.0, 1.0, 0.1);
		s.set(0.1 + 0.2);
		assertEquals(0.3, s.get());
		assertEquals("0.3", s.displayValue());
	}

	@Test
	void sliderIgnoresNonFiniteValues() {
		SliderSetting s = new SliderSetting("x", "X", 2.0, 0.0, 10.0, 0.0);
		s.set(Double.NaN);
		s.set(Double.POSITIVE_INFINITY);
		assertEquals(2.0, s.get());
		assertFalse(s.parse("NaN"));
		assertFalse(s.parse("abc"));
		assertTrue(s.parse(" 3.5 "));
		assertEquals(3.5, s.get());
	}

	@Test
	void sliderRejectsBadDefinitions() {
		assertThrows(IllegalArgumentException.class, () -> new SliderSetting("a", "A", 1, 5, 5, 1));
		assertThrows(IllegalArgumentException.class, () -> new SliderSetting("a", "A", 1, 0, 5, -1));
		assertThrows(IllegalArgumentException.class, () -> new SliderSetting("a", "A", 1.25, 0, 5, 0.5));
		assertThrows(IllegalArgumentException.class, () -> new SliderSetting("bad id", "A", 1, 0, 5, 1));
	}

	@Test
	void sliderFraction() {
		SliderSetting s = new SliderSetting("x", "X", 0.0, -10.0, 10.0, 1.0);
		s.setFraction(0.75);
		assertEquals(5.0, s.get());
		assertEquals(0.75, s.fraction());
	}

	@Test
	void listenersFireOnlyOnRealChanges() {
		AtomicInteger calls = new AtomicInteger();
		BooleanSetting b = new BooleanSetting("b", "B", false).onChange(calls::incrementAndGet);

		b.set(false);
		assertEquals(0, calls.get());
		b.set(true);
		b.set(true);
		assertEquals(1, calls.get());
		b.toggle();
		assertEquals(2, calls.get());
	}

	@Test
	void booleanParsing() {
		BooleanSetting b = new BooleanSetting("b", "B", false);
		assertTrue(b.parse("ON"));
		assertTrue(b.get());
		assertTrue(b.parse("no"));
		assertFalse(b.get());
		assertTrue(b.parse("toggle"));
		assertTrue(b.get());
		assertFalse(b.parse("maybe"));
		assertTrue(b.get());
	}

	@Test
	void jsonOfWrongTypeIsIgnored() {
		BooleanSetting b = new BooleanSetting("b", "B", true);
		b.fromJson(new JsonPrimitive("false"));
		b.fromJson(new JsonPrimitive(0));
		b.fromJson(JsonNull.INSTANCE);
		b.fromJson(null);
		assertTrue(b.get());

		SliderSetting s = new SliderSetting("s", "S", 1.0, 0.0, 2.0, 0.0);
		s.fromJson(new JsonPrimitive("1.5"));
		assertEquals(1.0, s.get());
		s.fromJson(new JsonPrimitive(1.5));
		assertEquals(1.5, s.get());
	}

	@Test
	void colorHex() {
		assertEquals(0xFF5B8CFFL, ColorSetting.parseHex("#5B8CFF"));
		assertEquals(0x805B8CFFL, ColorSetting.parseHex("805b8cff"));
		assertEquals(-1, ColorSetting.parseHex("#5B8CF"));
		assertEquals(-1, ColorSetting.parseHex("#GGGGGG"));
		assertEquals(-1, ColorSetting.parseHex("+5B8CFF"));
		assertEquals("#805B8CFF", ColorSetting.toHex(0x805B8CFF));

		ColorSetting c = new ColorSetting("c", "C", 0xFFFFFFFF);
		c.fromJson(c.toJson());
		assertTrue(c.parse("#80112233"));
		assertEquals(0x80, c.alpha());
		assertEquals(0x11, c.red());
		assertEquals(0x22, c.green());
		assertEquals(0x33, c.blue());
	}

	@Test
	void colorWithoutAlphaStaysOpaque() {
		ColorSetting c = new ColorSetting("c", "C", 0x00123456, false);
		assertEquals(0xFF123456, c.get());
		c.set(0x10ABCDEF);
		assertEquals(0xFFABCDEF, c.get());
	}

	@Test
	void enumByNameOrLabel() {
		EnumSetting<Style> e = new EnumSetting<>("style", "Style", Style.CROSS);
		assertTrue(e.parse("circle"));
		assertSame(Style.CIRCLE, e.get());
		assertTrue(e.parse("Dot"));
		assertSame(Style.DOT, e.get());
		assertFalse(e.parse("square"));
		assertSame(Style.DOT, e.get());
		e.fromJson(new JsonPrimitive("NOPE"));
		assertSame(Style.DOT, e.get());
		assertEquals("\"DOT\"", e.toJson().toString());
	}

	@Test
	void enumCyclesBothWays() {
		EnumSetting<Style> e = new EnumSetting<>("style", "Style", Style.CIRCLE);
		e.cycle(true);
		assertSame(Style.CROSS, e.get());
		e.cycle(false);
		assertSame(Style.CIRCLE, e.get());
	}

	@Test
	void enumDefaultLabels() {
		assertEquals("Twelve hour", EnumSetting.labelOf(Plain.TWELVE_HOUR));
		assertEquals("Circle", EnumSetting.labelOf(Style.CIRCLE));
	}

	@Test
	void keybindSettingReleasesWhenRebound() {
		AtomicInteger releases = new AtomicInteger();
		KeybindSetting k = new KeybindSetting("k", "K", Keybind.key(67)).onRelease(releases::incrementAndGet);

		k.press();
		assertTrue(k.isDown());
		k.set(Keybind.key(68));
		assertFalse(k.isDown());
		assertEquals(1, releases.get());
	}

	@Test
	void keybindSettingJsonRoundTrip() {
		KeybindSetting k = new KeybindSetting("k", "K", Keybind.NONE);
		assertTrue(k.parse("rshift"));
		assertEquals("\"key:rshift\"", k.toJson().toString());

		KeybindSetting copy = new KeybindSetting("k", "K", Keybind.NONE);
		copy.fromJson(k.toJson());
		assertEquals(Keybind.key(344), copy.get());
		assertFalse(copy.isDefault());
		copy.reset();
		assertTrue(copy.isDefault());
	}
}
