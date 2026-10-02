package dev.waveclient.gui.widget;

import java.util.ArrayList;
import java.util.List;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.input.KeyEvent;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.render.Text;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.setting.EnumSetting;

/** The option list of a {@link DropdownWidget}. Arrow keys move the highlight, Enter picks. */
public final class DropdownPopover extends Popover {
	private static final int ROW = 16;
	private static final int INSET = 3;
	private static final String CHECK = "✓";

	private final EnumSetting<?> setting;
	private final int minWidth;
	private final List<Text> labels = new ArrayList<>();
	private final Text check = new Text(UiFont.BODY, CHECK);
	private int highlighted;
	private double lastMouseX = Double.NaN;
	private double lastMouseY = Double.NaN;

	public DropdownPopover(EnumSetting<?> setting, int minWidth) {
		this.setting = setting;
		this.minWidth = minWidth;

		for (Enum<?> value : setting.values()) {
			labels.add(new Text(UiFont.BODY, EnumSetting.labelOf(value)));
		}

		this.highlighted = setting.get().ordinal();
	}

	@Override
	protected void measure(Painter painter) {
		float widest = 0;

		for (Text label : labels) {
			widest = Math.max(widest, label.width(painter));
		}

		width = Math.max(minWidth, (int) Math.ceil(widest + check.width(painter)) + 2 * PADDING + 8);
		height = labels.size() * ROW + 2 * INSET;
	}

	private int rowAt(double mouseX, double mouseY) {
		if (!contains(mouseX, mouseY)) {
			return -1;
		}

		int row = (int) Math.floor((mouseY - y - INSET) / ROW);
		return row >= 0 && row < labels.size() ? row : -1;
	}

	@Override
	public void render(Painter painter, double mouseX, double mouseY, float seconds) {
		// The pointer only takes over the highlight when it moves, so arrow keys aren't overridden
		// and a list opened from the keyboard starts on the current choice wherever the pointer is.
		if (Double.isNaN(lastMouseX)) {
			lastMouseX = mouseX;
			lastMouseY = mouseY;
		} else if (mouseX != lastMouseX || mouseY != lastMouseY) {
			lastMouseX = mouseX;
			lastMouseY = mouseY;
			int row = rowAt(mouseX, mouseY);

			if (row >= 0) {
				highlighted = row;
			}
		}

		drawFrame(painter);
		int selected = setting.get().ordinal();

		for (int i = 0; i < labels.size(); i++) {
			double rowY = y + INSET + i * ROW;

			if (i == highlighted) {
				painter.roundRect(x + INSET, rowY, width - 2 * INSET, ROW, Theme.RADIUS_SMALL, Theme.SURFACE_HOVER);
			}

			double centerY = rowY + ROW / 2.0;
			labels.get(i).drawCentered(painter, x + PADDING, centerY, i == selected ? Theme.ACCENT : Theme.TEXT);

			if (i == selected) {
				check.drawCentered(painter, x + width - PADDING - check.width(painter), centerY, Theme.ACCENT);
			}
		}
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
		if (!contains(mouseX, mouseY)) {
			return false;
		}

		int row = rowAt(mouseX, mouseY);

		if (button == 0 && row >= 0) {
			select(row);
		}

		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (event.isUp()) {
			highlighted = (highlighted + labels.size() - 1) % labels.size();
		} else if (event.isDown()) {
			highlighted = (highlighted + 1) % labels.size();
		} else if (event.isSelection()) {
			select(highlighted);
		} else {
			return false;
		}

		return true;
	}

	private void select(int index) {
		set(setting, index);
		close();
	}

	private static <E extends Enum<E>> void set(EnumSetting<E> setting, int index) {
		setting.set(setting.values()[index]);
	}

	@Override
	public CursorType cursor(double mouseX, double mouseY) {
		return rowAt(mouseX, mouseY) >= 0 ? CursorTypes.POINTING_HAND : CursorTypes.ARROW;
	}
}
