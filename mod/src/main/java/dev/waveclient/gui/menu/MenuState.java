package dev.waveclient.gui.menu;

import java.util.HashMap;
import java.util.Map;

import dev.waveclient.module.Category;

/**
 * What the mod menu was showing when it last closed, so reopening it lands in the same place.
 * Kept in memory only; a restart starts from "All".
 */
public final class MenuState {
	/** Which list the sidebar has selected. */
	public sealed interface Section permits All, OfCategory, ClientSettings {
	}

	public record All() implements Section {
	}

	public record OfCategory(Category category) implements Section {
	}

	public record ClientSettings() implements Section {
	}

	public static final Section ALL = new All();
	public static final Section CLIENT_SETTINGS = new ClientSettings();

	private Section section = ALL;
	/** Id of the module whose settings are open, or {@code null} for the list. */
	private String openModule;
	private final Map<String, Double> scroll = new HashMap<>();

	public Section section() {
		return section;
	}

	public void setSection(Section section) {
		this.section = section;
	}

	public String openModule() {
		return openModule;
	}

	public void setOpenModule(String moduleId) {
		this.openModule = moduleId;
	}

	public double scroll(String pageKey) {
		return scroll.getOrDefault(pageKey, 0.0);
	}

	public void setScroll(String pageKey, double offset) {
		scroll.put(pageKey, offset);
	}
}
