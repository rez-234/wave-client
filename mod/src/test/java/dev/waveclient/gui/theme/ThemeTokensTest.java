package dev.waveclient.gui.theme;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

import dev.waveclient.setting.ColorSetting;

class ThemeTokensTest {
	/** Tests run with the mod project as the working directory; the tokens live in the repo root. */
	private static Path tokens() {
		Path fromMod = Path.of("..", "shared", "design-tokens.json");
		return Files.exists(fromMod) ? fromMod : Path.of("shared", "design-tokens.json");
	}

	@Test
	void themeMatchesSharedDesignTokens() throws IOException {
		Path file = tokens();
		assertTrue(Files.exists(file), "missing " + file.toAbsolutePath());
		JsonObject colors = JsonParser.parseString(Files.readString(file)).getAsJsonObject().getAsJsonObject("color");

		Map<String, Integer> expected = Map.of(
				"background", Theme.BACKGROUND,
				"surface", Theme.SURFACE,
				"surfaceRaised", Theme.SURFACE_RAISED,
				"border", Theme.BORDER,
				"text", Theme.TEXT,
				"textMuted", Theme.TEXT_MUTED,
				"accent", Theme.ACCENT,
				"danger", Theme.DANGER);

		assertEquals(expected.keySet(), colors.keySet(), "token names");

		for (Map.Entry<String, Integer> entry : expected.entrySet()) {
			long fromJson = ColorSetting.parseHex(colors.get(entry.getKey()).getAsString());
			assertEquals(ColorSetting.toHex((int) fromJson), ColorSetting.toHex(entry.getValue()), entry.getKey());
		}
	}

	@Test
	void withAlphaKeepsTheColor() {
		assertEquals(0x805B8CFF, Theme.withAlpha(Theme.ACCENT, 0x80));
		assertEquals(0x005B8CFF, Theme.withAlpha(Theme.ACCENT, -5));
		assertEquals(0xFF5B8CFF, Theme.withAlpha(Theme.ACCENT, 999));
	}
}
