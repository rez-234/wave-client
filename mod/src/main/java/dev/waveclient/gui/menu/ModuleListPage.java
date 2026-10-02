package dev.waveclient.gui.menu;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.render.Text;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.module.Category;
import dev.waveclient.module.Module;

/**
 * A grid of {@link ModuleCard}s: every module grouped by category, one category, or search
 * results across all of them.
 */
final class ModuleListPage extends MenuPage {
	static final int PADDING = 12;
	private static final int MIN_CARD_WIDTH = 150;
	private static final int GAP = 8;
	private static final int TITLE_HEIGHT = 30;
	private static final int HEADING_HEIGHT = 20;

	private record Heading(Text text, double y) {
	}

	private final List<Module> modules;
	private final MenuState.Section section;
	private final String query;
	private final Consumer<Module> open;
	private final Text title = new Text(UiFont.HEADING);
	private final Text count = new Text(UiFont.BODY);
	private final Text empty = new Text(UiFont.BODY);
	private final List<Heading> headings = new ArrayList<>();
	private final Map<Module, ModuleCard> cards = new IdentityHashMap<>();
	private double titleCenterY;
	private double emptyY = Double.NaN;

	ModuleListPage(List<Module> modules, MenuState.Section section, String query, Consumer<Module> open) {
		this.modules = modules;
		this.section = section;
		this.query = query;
		this.open = open;
	}

	@Override
	String key() {
		// Search results keep their own scroll, so they never overwrite the list's.
		if (searching()) {
			return "search";
		}

		return section instanceof MenuState.OfCategory of ? "list:" + of.category().name() : "list:all";
	}

	private boolean searching() {
		return !ModuleSearch.normalize(query).isEmpty();
	}

	@Override
	protected int build(Painter painter) {
		headings.clear();
		emptyY = Double.NaN;
		double y = top + PADDING;
		titleCenterY = y + 8;
		List<ModuleSearch.Hit> hits;

		if (searching()) {
			title.set("Search");
			hits = ModuleSearch.search(modules, query);
			count.set(hits.size() == 1 ? "1 result" : hits.size() + " results");
		} else {
			List<Module> shown = new ArrayList<>();

			for (Module module : modules) {
				if (!(section instanceof MenuState.OfCategory of) || module.category() == of.category()) {
					shown.add(module);
				}
			}

			title.set(section instanceof MenuState.OfCategory of ? of.category().label() : "All modules");
			hits = ModuleSearch.search(shown, "");
			count.set(hits.size() == 1 ? "1 module" : hits.size() + " modules");
		}

		y += TITLE_HEIGHT;

		if (hits.isEmpty()) {
			empty.set(searching() ? "Nothing matches “" + query.trim() + "”." : "No modules here yet.");
			emptyY = y + 16;
			return (int) Math.ceil(emptyY + 16 - top);
		}

		int contentWidth = width - 2 * PADDING;
		int columns = Math.max(1, (contentWidth + GAP) / (MIN_CARD_WIDTH + GAP));

		if (section instanceof MenuState.All && !searching()) {
			for (Category category : Category.values()) {
				List<ModuleSearch.Hit> group = new ArrayList<>();

				for (ModuleSearch.Hit hit : hits) {
					if (hit.module().category() == category) {
						group.add(hit);
					}
				}

				if (!group.isEmpty()) {
					headings.add(new Heading(new Text(UiFont.STRONG, category.label()), y + HEADING_HEIGHT / 2.0 - 2));
					y = grid(group, y + HEADING_HEIGHT, columns, contentWidth) + 10;
				}
			}
		} else {
			y = grid(hits, y, columns, contentWidth);
		}

		return (int) Math.ceil(y - top + PADDING);
	}

	/** Lays cards out in rows; returns the y below the last row. */
	private double grid(List<ModuleSearch.Hit> hits, double y, int columns, int contentWidth) {
		int cardWidth = (contentWidth - GAP * (columns - 1)) / columns;

		for (int i = 0; i < hits.size(); i++) {
			ModuleSearch.Hit hit = hits.get(i);
			int column = i % columns;
			int row = i / columns;
			// Reused across layouts (window resizes), so a focused card keeps focus.
			ModuleCard card = cards.computeIfAbsent(hit.module(), module -> new ModuleCard(module, hit.setting(), () -> open.accept(module)));
			card.setBounds(left + PADDING + column * (cardWidth + GAP), y + row * (ModuleCard.HEIGHT + GAP), cardWidth, ModuleCard.HEIGHT);
			widgets.add(card);
		}

		int rows = (hits.size() + columns - 1) / columns;
		return y + rows * (ModuleCard.HEIGHT + GAP) - GAP;
	}

	@Override
	void renderBackground(Painter painter, double mouseX, double mouseY, boolean mouseInside, float seconds) {
		title.drawCentered(painter, left + PADDING, titleCenterY, Theme.TEXT);
		count.drawCentered(painter, left + PADDING + title.width(painter) + 8, titleCenterY, Theme.TEXT_MUTED);

		for (Heading heading : headings) {
			heading.text().drawCentered(painter, left + PADDING, heading.y(), Theme.TEXT_MUTED);
		}

		if (!Double.isNaN(emptyY)) {
			empty.drawFitted(painter, left + PADDING, emptyY, width - 2 * PADDING, Theme.TEXT_MUTED);
		}
	}
}
