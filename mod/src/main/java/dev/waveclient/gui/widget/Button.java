package dev.waveclient.gui.widget;

import java.util.function.BooleanSupplier;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.input.KeyEvent;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.render.Text;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.util.ColorMath;

/** A flat button with a text label. */
public final class Button extends Widget {
	public static final int HEIGHT = 16;
	private static final int PADDING = 8;

	public enum Kind {
		/** Accent fill: the one main action. */
		PRIMARY,
		/** Raised surface with a border. */
		SECONDARY,
		/** Danger-colored outline for destructive actions. */
		DANGER,
		/** No background until hovered: navigation and minor actions. */
		GHOST
	}

	private final Text label;
	private final Kind kind;
	private final Runnable action;
	private BooleanSupplier usable = () -> true;
	private String tooltip;

	public Button(String label, Kind kind, Runnable action) {
		this.label = new Text(UiFont.STRONG, label);
		this.kind = kind;
		this.action = action;
		this.height = HEIGHT;
	}

	public Button usableWhen(BooleanSupplier usable) {
		this.usable = usable;
		return this;
	}

	public Button tooltip(String tooltip) {
		this.tooltip = tooltip;
		return this;
	}

	public Button label(String text) {
		label.set(text);
		return this;
	}

	/** Width that fits the label with padding. */
	public int preferredWidth(Painter painter) {
		return (int) Math.ceil(label.width(painter)) + 2 * PADDING;
	}

	@Override
	public void render(Painter painter, boolean hovered, double mouseX, double mouseY, float seconds) {
		if (width <= 0 || height <= 0) {
			return;
		}

		boolean enabled = usable.getAsBoolean();
		animateHover(hovered && enabled, seconds);
		int text;

		switch (kind) {
			case PRIMARY -> {
				painter.roundRect(x, y, width, height, Theme.RADIUS_SMALL, enabled ? Theme.mix(Theme.ACCENT, Theme.ACCENT_HOVER, hover) : Theme.mix(Theme.ACCENT, Theme.SURFACE, 0.6f));
				text = enabled ? Theme.ON_ACCENT : Theme.mix(Theme.ON_ACCENT, Theme.ACCENT, 0.5f);
			}
			case SECONDARY -> {
				painter.roundRect(x, y, width, height, Theme.RADIUS_SMALL, Theme.mix(Theme.SURFACE_RAISED, Theme.BORDER, hover), Theme.BORDER);
				text = enabled ? Theme.TEXT : Theme.DISABLED;
			}
			case DANGER -> {
				painter.roundRect(x, y, width, height, Theme.RADIUS_SMALL, Theme.mix(Theme.SURFACE, Theme.mix(Theme.SURFACE, Theme.DANGER, 0.18f), hover),
						Theme.mix(Theme.BORDER, Theme.DANGER, enabled ? 0.55f + 0.45f * hover : 0.25f));
				text = enabled ? Theme.DANGER : Theme.DISABLED;
			}
			default -> {
				painter.roundRect(x, y, width, height, Theme.RADIUS_SMALL, ColorMath.withAlpha(Theme.SURFACE_RAISED, Math.round(hover * 255)));
				text = enabled ? Theme.mix(Theme.TEXT_MUTED, Theme.TEXT, hover) : Theme.DISABLED;
			}
		}

		if (showsFocus(painter) && enabled) {
			painter.outline(x - 1, y - 1, width + 2, height + 2, ColorMath.withAlpha(Theme.ACCENT, 0xA0));
		}

		// Icon-sized buttons (a single glyph such as the close button's "×") skip the padding.
		int maxWidth = Math.max(0, width - 2 * PADDING);

		if (label.width(painter) > maxWidth && label.width(painter) <= width) {
			maxWidth = width;
		}

		float labelWidth = label.fittedWidth(painter, maxWidth);
		label.drawFitted(painter, x + (width - labelWidth) / 2, y + height / 2.0, maxWidth, text);
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
		if (button != 0 || !usable.getAsBoolean()) {
			return false;
		}

		action.run();
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (event.isSelection() && usable.getAsBoolean()) {
			action.run();
			return true;
		}

		return false;
	}

	@Override
	public boolean isFocusable() {
		return true;
	}

	@Override
	public CursorType cursor(double mouseX, double mouseY) {
		return usable.getAsBoolean() ? CursorTypes.POINTING_HAND : CursorTypes.NOT_ALLOWED;
	}

	@Override
	public String tooltip(double mouseX, double mouseY) {
		return tooltip;
	}
}
