package dev.waveclient.gui.widget;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.input.KeyEvent;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.render.Text;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.setting.EnumSetting;

/**
 * Shows the chosen option of an {@link EnumSetting}; click to pick from a list. While focused,
 * the arrow keys step through the options without opening it.
 */
public final class DropdownWidget extends Widget {
	public static final int HEIGHT = 16;
	private static final double CARET_WIDTH = 5;

	private final EnumSetting<?> setting;
	private final PopoverHost host;
	private final Text label = new Text(UiFont.BODY);
	private Enum<?> shown;

	public DropdownWidget(EnumSetting<?> setting, PopoverHost host) {
		this.setting = setting;
		this.host = host;
		this.height = HEIGHT;
	}

	@Override
	public void render(Painter painter, boolean hovered, double mouseX, double mouseY, float seconds) {
		animateHover(hovered, seconds);

		if (setting.get() != shown) {
			shown = setting.get();
			label.set(setting.displayValue());
		}

		int border = showsFocus(painter) ? Theme.ACCENT : Theme.mix(Theme.BORDER, Theme.TEXT_MUTED, hover * 0.35f);
		painter.roundRect(x, y, width, height, Theme.RADIUS_SMALL, Theme.mix(Theme.SURFACE_RAISED, Theme.SURFACE_HOVER, hover), border);

		double centerY = y + height / 2.0;
		painter.caretDown(x + width - 6 - CARET_WIDTH / 2, centerY, CARET_WIDTH, Theme.TEXT_MUTED);
		label.drawFitted(painter, x + 6, centerY, Math.max(0, (int) (width - 16 - CARET_WIDTH)), Theme.TEXT);
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
		if (button != 0) {
			return false;
		}

		host.openPopover(new DropdownPopover(setting, width), this);
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (event.isLeft() || event.isUp()) {
			setting.cycle(false);
		} else if (event.isRight() || event.isDown()) {
			setting.cycle(true);
		} else if (event.isSelection()) {
			host.openPopover(new DropdownPopover(setting, width), this);
		} else {
			return false;
		}

		return true;
	}

	@Override
	public boolean isFocusable() {
		return true;
	}

	@Override
	public CursorType cursor(double mouseX, double mouseY) {
		return CursorTypes.POINTING_HAND;
	}
}
