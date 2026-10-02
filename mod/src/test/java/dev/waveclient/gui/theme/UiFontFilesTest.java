package dev.waveclient.gui.theme;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Stream;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;

/** Keeps the shipped font definitions in step with {@link UiFont}. */
class UiFontFilesTest {
	private static final Path FONT_DIR = Path.of("src", "main", "resources", "assets", "waveclient", "font");

	@Test
	void everyStyleHasADefinitionPerScale() throws IOException {
		Set<Path> expected = new HashSet<>();

		for (UiFont font : UiFont.values()) {
			assertTrue(Files.isRegularFile(FONT_DIR.resolve("inter").resolve(font.file())), font.file());

			for (int scale = UiFont.MIN_SCALE; scale <= UiFont.MAX_SCALE; scale++) {
				Path file = FONT_DIR.resolve(font.definition(scale) + ".json");
				expected.add(file);
				JsonObject json = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
				JsonArray providers = json.getAsJsonArray("providers");
				JsonObject ttf = providers.get(0).getAsJsonObject();
				assertEquals("ttf", ttf.get("type").getAsString(), file.toString());
				assertEquals("waveclient:inter/" + font.file(), ttf.get("file").getAsString(), file.toString());
				assertEquals(font.size(), ttf.get("size").getAsDouble(), 0, file.toString());
				assertEquals(scale, ttf.get("oversample").getAsDouble(), 0, file + ": sharp only when oversample equals the GUI scale");
				JsonObject fallback = providers.get(1).getAsJsonObject();
				assertEquals("reference", fallback.get("type").getAsString());
				assertEquals("minecraft:default", fallback.get("id").getAsString(), "characters Inter lacks come from the vanilla font");
			}
		}

		try (Stream<Path> files = Files.list(FONT_DIR.resolve("ui"))) {
			assertEquals(expected, new HashSet<>(files.toList()), "no stray definitions");
		}

		assertTrue(Files.isRegularFile(FONT_DIR.resolve("inter").resolve("ofl.txt")), "the font license ships with the font (lowercase: resource paths can't have capitals)");
	}

	@Test
	void largeScalesUseADivisorOrTheVanillaFont() {
		assertEquals(0, UiFont.oversample(1), "too small to read");
		assertEquals(2, UiFont.oversample(2));
		assertEquals(10, UiFont.oversample(10));
		assertEquals(6, UiFont.oversample(12), "each texel is a 2x2 block");
		assertEquals(7, UiFont.oversample(14));
		assertEquals(9, UiFont.oversample(18));
		assertEquals(0, UiFont.oversample(11), "prime: no even mapping");
		assertEquals(0, UiFont.oversample(13));
		assertEquals("ui/heading_7", UiFont.HEADING.definition(14));
		assertTrue(!UiFont.supports(1) && UiFont.supports(2) && !UiFont.supports(17));

		for (int scale = 1; scale <= 40; scale++) {
			int oversample = UiFont.oversample(scale);
			assertTrue(oversample == 0 || (scale % oversample == 0 && oversample >= UiFont.MIN_SCALE && oversample <= UiFont.MAX_SCALE), "scale " + scale);
		}
		assertEquals(6.0, UiFont.STRONG.capHeight(2), 1e-9, "8 * 0.7275 * 2 = 11.6 screen pixels, hinted to 12");
		assertEquals(UiFont.STRONG.capHeight(6), UiFont.STRONG.capHeight(12), 1e-9, "measured at the oversample actually used");
	}
}
