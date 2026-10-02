package dev.waveclient.gui.menu;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

import dev.waveclient.module.Category;
import dev.waveclient.module.Module;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.SliderSetting;

class ModuleSearchTest {
	static final class Fake extends Module {
		final BooleanSetting hidden;

		Fake(String id, String name, String description, Category category, String... settingNames) {
			super(id, name, description, category);
			int i = 0;

			for (String settingName : settingNames) {
				add(new SliderSetting("s" + i++, settingName, 1, 0, 2, 1));
			}

			hidden = add(new BooleanSetting("hiddenSetting", "Secret option", false).visibleWhen(() -> false));
		}
	}

	private final Module zoom = new Fake("zoom", "Zoom", "Magnify the view.", Category.CAMERA, "Zoom factor", "Smooth transition");
	private final Module fullbright = new Fake("fullbright", "Fullbright", "See in the dark.", Category.RENDER, "Brightness");
	private final Module sprint = new Fake("sprint", "Toggle sprint/sneak", "Sprint without holding the key.", Category.MOVEMENT);
	private final Module fps = new Fake("fps", "FPS", "Frames per second counter.", Category.HUD, "Background color");
	private final List<Module> all = List.of(zoom, fullbright, sprint, fps);

	private List<Module> modules(String query) {
		return ModuleSearch.search(all, query).stream().map(ModuleSearch.Hit::module).toList();
	}

	@Test
	void blankQueryListsEverythingInOrder() {
		assertEquals(all, modules(""));
		assertEquals(all, modules("   "));
	}

	@Test
	void nameMatchesComeFirst() {
		assertEquals(List.of(fullbright, fps, zoom), modules("f"), "names first, then Zoom's \"Zoom factor\"");
		assertEquals(List.of(sprint), modules("sneak"), "word after a slash");
		assertEquals(List.of(fullbright), modules("BRIGHT"), "case-insensitive substring");
	}

	@Test
	void settingMatchesSayWhichSetting() {
		ModuleSearch.Hit hit = ModuleSearch.search(all, "smooth").getFirst();
		assertSame(zoom, hit.module());
		assertEquals(ModuleSearch.Rank.SETTING, hit.rank());
		assertEquals("Smooth transition", hit.setting().name());

		assertNull(ModuleSearch.search(all, "zoom").getFirst().setting(), "name matches don't point at a setting");
	}

	@Test
	void categoryAndDescriptionMatch() {
		assertEquals(List.of(fps), modules("hud"));
		assertEquals(List.of(fullbright), modules("dark"));
	}

	@Test
	void toggleKeyAndHiddenSettingsAreNotSearched() {
		assertEquals(List.of(sprint), modules("toggle"), "only the module that is called Toggle ...");
		assertEquals(List.of(sprint), modules("toggle key"), "... found by its name and description, not every module's Toggle key");
		assertTrue(modules("secret").isEmpty());
	}

	@Test
	void outsideTheNameOnlyWordStartsMatch() {
		assertTrue(modules("ark").isEmpty(), "\"dark\" in a description doesn't match \"ark\"");
		assertEquals(List.of(fullbright), modules("ight"), "but the name matches anywhere");
	}

	@Test
	void wordsMayMatchDifferentPlaces() {
		assertEquals(List.of(zoom), modules("magnify  smooth"));
		assertTrue(modules("zoom dark").isEmpty());
	}
}
