package dev.waveclient.gui.menu;

import java.util.ArrayList;
import java.util.List;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.widget.Widget;

/**
 * One scrollable view in the mod menu's content area: the module list or a settings page.
 *
 * <p>Widgets are positioned in page coordinates: screen GUI pixels as they would be with the
 * page scrolled to the top. The screen translates drawing by the scroll offset and adds it to
 * mouse positions, so pages never deal with scrolling themselves.
 */
abstract class MenuPage {
	protected final List<Widget> widgets = new ArrayList<>();
	protected int left;
	protected int top;
	protected int width;

	/** Identifies the page for remembering its scroll position. */
	abstract String key();

	/**
	 * Positions everything for a content area starting at ({@code left}, {@code top}) and
	 * {@code width} wide.
	 *
	 * @return the height of the content
	 */
	final int layout(Painter painter, int left, int top, int width) {
		this.left = left;
		this.top = top;
		this.width = width;
		widgets.clear();
		return build(painter);
	}

	/** Adds widgets and positions them; returns the content height. */
	protected abstract int build(Painter painter);

	/**
	 * Whether the layout must be rebuilt, e.g. because a setting's visibility changed. Checked
	 * every frame.
	 */
	boolean needsLayout() {
		return false;
	}

	/** Draws everything that isn't a widget (titles, labels, cards' backgrounds). */
	abstract void renderBackground(Painter painter, double mouseX, double mouseY, boolean mouseInside, float seconds);

	List<Widget> widgets() {
		return widgets;
	}

	/** The widget under the pointer, topmost first, or {@code null}. */
	Widget widgetAt(double mouseX, double mouseY) {
		for (int i = widgets.size() - 1; i >= 0; i--) {
			Widget widget = widgets.get(i);

			if (widget.contains(mouseX, mouseY)) {
				return widget;
			}
		}

		return null;
	}

	/** Mouse button 4 ("back") or Backspace with nothing focused. */
	boolean goBack() {
		return false;
	}
}
