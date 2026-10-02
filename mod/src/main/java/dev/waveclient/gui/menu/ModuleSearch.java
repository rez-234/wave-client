package dev.waveclient.gui.menu;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

import dev.waveclient.module.Module;
import dev.waveclient.setting.Setting;

/**
 * Filters modules for the mod menu's search box.
 *
 * <p>A module matches when the query, or else every word of it, is found in its name, category,
 * description or the name of one of its settings. Better matches come first: the name itself,
 * then a word of the name, then a setting, then the description. Ties keep registration order.
 */
public final class ModuleSearch {
	/** Rank of a match; lower is better. */
	public enum Rank {
		NAME_PREFIX, NAME_WORD_PREFIX, NAME_CONTAINS, CATEGORY, SETTING, DESCRIPTION, SPREAD
	}

	/**
	 * @param setting the setting whose name matched, when the module's own name didn't; shown on
	 *                the card so it's clear why the module is listed
	 */
	public record Hit(Module module, Rank rank, Setting<?> setting) {
	}

	private ModuleSearch() {
	}

	/** Lowercases, trims and collapses whitespace. */
	public static String normalize(String query) {
		return query.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
	}

	/** @return matches, best first; every module in order if the query is blank */
	public static List<Hit> search(List<Module> modules, String query) {
		String q = normalize(query);
		List<Hit> hits = new ArrayList<>();

		for (Module module : modules) {
			Hit hit = q.isEmpty() ? new Hit(module, Rank.NAME_PREFIX, null) : match(module, q);

			if (hit != null) {
				hits.add(hit);
			}
		}

		// List.sort is stable, so equal ranks keep registration order.
		hits.sort(Comparator.comparing(Hit::rank));
		return hits;
	}

	static Hit match(Module module, String q) {
		Hit hit = matchTerm(module, q);

		if (hit != null || q.indexOf(' ') < 0) {
			return hit;
		}

		// Several words that don't appear together, e.g. "zoom smooth".
		for (String word : q.split(" ")) {
			if (matchTerm(module, word) == null) {
				return null;
			}
		}

		return new Hit(module, Rank.SPREAD, null);
	}

	/**
	 * The name matches anywhere ("bright" finds Fullbright); everything else only at the start of
	 * a word, so a single letter doesn't match half the descriptions.
	 */
	private static Hit matchTerm(Module module, String term) {
		String name = lower(module.name());

		if (name.startsWith(term)) {
			return new Hit(module, Rank.NAME_PREFIX, null);
		}

		if (hasWordStartingWith(name, term)) {
			return new Hit(module, Rank.NAME_WORD_PREFIX, null);
		}

		if (name.contains(term)) {
			return new Hit(module, Rank.NAME_CONTAINS, null);
		}

		if (startsWord(lower(module.category().label()), term)) {
			return new Hit(module, Rank.CATEGORY, null);
		}

		for (Setting<?> setting : searchable(module)) {
			if (startsWord(lower(setting.name()), term)) {
				return new Hit(module, Rank.SETTING, setting);
			}
		}

		if (startsWord(lower(module.description()), term)) {
			return new Hit(module, Rank.DESCRIPTION, null);
		}

		return null;
	}

	/**
	 * Settings worth matching: every module has a "Toggle key", so it would match "key" or
	 * "toggle" everywhere; hidden settings aren't shown when the module opens.
	 */
	private static List<Setting<?>> searchable(Module module) {
		List<Setting<?>> result = new ArrayList<>(module.settings().size());

		for (Setting<?> setting : module.settings()) {
			if (setting != module.toggleKey && setting.isVisible()) {
				result.add(setting);
			}
		}

		return result;
	}

	private static boolean startsWord(String text, String q) {
		return text.startsWith(q) || hasWordStartingWith(text, q);
	}

	/** Words are split at anything that isn't a letter or digit, so "sprint/sneak" has two. */
	private static boolean hasWordStartingWith(String text, String q) {
		for (int i = 1; i < text.length(); i++) {
			if (!Character.isLetterOrDigit(text.charAt(i - 1)) && text.startsWith(q, i)) {
				return true;
			}
		}

		return false;
	}

	private static String lower(String s) {
		return s.toLowerCase(Locale.ROOT);
	}
}
