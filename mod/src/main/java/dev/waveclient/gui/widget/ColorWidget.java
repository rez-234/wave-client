package dev.waveclient.gui.widget;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.input.KeyEvent;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.render.Text;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.setting.ColorSetting;

/** A swatch and hex code for a {@link ColorSetting}; opens a {@link ColorPickerPopover}. */
public final class ColorWidget extends Widget {
	public static final int HEIGHT = 16;
	private static final int SWATCH_WIDTH = 16;
	private static final int SWATCH_HEIGHT = 10;

	private final ColorSetting setting;
	private final PopoverHost host;
	private final Text hex = new Text(UiFont.BODY);
	private int shown;
	private boolean first = true;

	public ColorWidget(ColorSetting setting, PopoverHost host) {
		this.setting = setting;
		this.host = host;
		this.height = HEIGHT;
	}

	@Override
	public void render(Painter painter, boolean hovered, double mouseX, double mouseY, float seconds) {
		animateHover(hovered, seconds);

		if (first || setting.get() != shown) {
			first = false;
			shown = setting.get();
			hex.set(ColorPickerPopover.format(setting));
		}

		int border = showsFocus(painter) ? Theme.ACCENT : Theme.mix(Theme.BORDER, Theme.TEXT_MUTED, hover * 0.35f);
		painter.roundRect(x, y, width, height, Theme.RADIUS_SMALL, Theme.mix(Theme.SURFACE_RAISED, Theme.SURFACE_HOVER, hover), border);

		double swatchX = x + 4;
		double swatchY = y + (height - SWATCH_HEIGHT) / 2.0;
		painter.checkerboard(swatchX, swatchY, SWATCH_WIDTH, SWATCH_HEIGHT, 2.5);
		painter.rect(swatchX, swatchY, SWATCH_WIDTH, SWATCH_HEIGHT, setting.get());
		painter.outline(swatchX, swatchY, SWATCH_WIDTH, SWATCH_HEIGHT, Theme.withAlpha(0xFF000000, 0x60));

		int textLeft = 4 + SWATCH_WIDTH + 6;
		hex.drawFitted(painter, x + textLeft, y + height / 2.0, Math.max(0, width - textLeft - 4), Theme.TEXT);
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
		if (button != 0) {
			return false;
		}

		open();
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (event.isSelection()) {
			open();
			return true;
		}

		return false;
	}

	private void open() {
		host.openPopover(new ColorPickerPopover(setting), this);
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
