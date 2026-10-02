package dev.waveclient.gui.widget;

import java.util.Locale;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.setting.ColorSetting;
import dev.waveclient.util.ColorMath;

/**
 * Saturation/value square, hue bar, optional alpha bar and a hex field. Every change is
 * applied to the setting immediately, so HUD elements behind the menu update live.
 */
public final class ColorPickerPopover extends Popover {
	private static final int SQUARE_WIDTH = 100;
	private static final int SQUARE_HEIGHT = 72;
	private static final int BAR_WIDTH = 8;
	private static final int GAP = 6;
	private static final int SWATCH = 14;

	private enum Drag {
		NONE, SQUARE, HUE, ALPHA
	}

	private final ColorPickerModel model;
	private final boolean alpha;
	private final TextField hex;
	private Drag drag = Drag.NONE;

	public ColorPickerPopover(ColorSetting setting) {
		this.model = new ColorPickerModel(setting);
		this.alpha = setting.allowsAlpha();
		this.hex = new TextField(new TextFieldModel(9).filter(s -> s.matches("#?[0-9a-fA-F]*")), alpha ? "#AARRGGBB" : "#RRGGBB");
		hex.onChange(this::applyHex).onEnter(() -> hex.setFocused(false));
		hex.setValue(format(setting));
	}

	/** {@code #RRGGBB} when fully opaque, {@code #AARRGGBB} otherwise. */
	public static String format(ColorSetting setting) {
		int argb = setting.get();
		return (argb >>> 24) == 0xFF || !setting.allowsAlpha()
				? String.format(Locale.ROOT, "#%06X", argb & 0xFFFFFF)
				: ColorSetting.toHex(argb);
	}

	private void applyHex(String value) {
		String digits = value.startsWith("#") ? value.substring(1) : value;

		if (digits.length() == 6 || digits.length() == 8) {
			model.setting().parse(value);
		}
	}

	@Override
	protected void measure(Painter painter) {
		width = 2 * PADDING + SQUARE_WIDTH + GAP + BAR_WIDTH + (alpha ? GAP + BAR_WIDTH : 0);
		height = 2 * PADDING + SQUARE_HEIGHT + GAP + TextField.HEIGHT;
	}

	@Override
	protected void layout() {
		int hexLeft = PADDING + SWATCH + 6;
		hex.setBounds(x + hexLeft, y + PADDING + SQUARE_HEIGHT + GAP, width - hexLeft - PADDING, TextField.HEIGHT);
	}

	private double squareX() {
		return x + PADDING;
	}

	private double squareY() {
		return y + PADDING;
	}

	private double hueX() {
		return squareX() + SQUARE_WIDTH + GAP;
	}

	private double alphaX() {
		return hueX() + BAR_WIDTH + GAP;
	}

	@Override
	public void render(Painter painter, double mouseX, double mouseY, float seconds) {
		model.sync();

		if (!hex.isFocused()) {
			hex.setValue(format(model.setting()));
		}

		drawFrame(painter);
		double sx = squareX();
		double sy = squareY();

		painter.saturationValueSquare(sx, sy, SQUARE_WIDTH, SQUARE_HEIGHT, model.hue());
		painter.outline(sx, sy, SQUARE_WIDTH, SQUARE_HEIGHT, Theme.withAlpha(0xFF000000, 0x40));
		ring(painter, sx + model.saturation() * SQUARE_WIDTH, sy + (1 - model.value()) * SQUARE_HEIGHT,
				ColorMath.hsvToRgb(model.hue(), model.saturation(), model.value()));

		painter.hueBar(hueX(), sy, BAR_WIDTH, SQUARE_HEIGHT);
		barMarker(painter, hueX(), sy + model.hue() * SQUARE_HEIGHT);

		int opaque = ColorMath.withAlpha(model.setting().get(), 0xFF);

		if (alpha) {
			painter.checkerboard(alphaX(), sy, BAR_WIDTH, SQUARE_HEIGHT, 2);
			painter.gradient(alphaX(), sy, BAR_WIDTH, SQUARE_HEIGHT, opaque, ColorMath.withAlpha(opaque, 0));
			barMarker(painter, alphaX(), sy + (1 - model.alpha() / 255.0) * SQUARE_HEIGHT);
		}

		double swatchY = hex.y() + (TextField.HEIGHT - SWATCH) / 2.0;
		painter.checkerboard(x + PADDING, swatchY, SWATCH, SWATCH, 3.5);
		painter.rect(x + PADDING, swatchY, SWATCH, SWATCH, model.setting().get());
		painter.outline(x + PADDING, swatchY, SWATCH, SWATCH, Theme.BORDER);

		hex.render(painter, hex.contains(mouseX, mouseY), mouseX, mouseY, seconds);
	}

	private static void ring(Painter painter, double cx, double cy, int color) {
		painter.pill(cx - 4, cy - 4, 8, 8, Theme.withAlpha(0xFF000000, 0x90));
		painter.pill(cx - 3.5, cy - 3.5, 7, 7, 0xFFFFFFFF);
		painter.pill(cx - 2.5, cy - 2.5, 5, 5, color);
	}

	private static void barMarker(Painter painter, double barX, double cy) {
		painter.roundRect(barX - 1.5, cy - 2, BAR_WIDTH + 3, 4, 1, 0xFFFFFFFF, Theme.withAlpha(0xFF000000, 0xFF));
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
		if (!contains(mouseX, mouseY)) {
			return false;
		}

		if (button != 0) {
			return true;
		}

		if (hex.contains(mouseX, mouseY)) {
			hex.setFocused(true);
			hex.mouseClicked(mouseX, mouseY, button, doubleClick);
			return true;
		}

		hex.setFocused(false);

		if (inside(mouseX, mouseY, squareX(), SQUARE_WIDTH)) {
			drag = Drag.SQUARE;
		} else if (inside(mouseX, mouseY, hueX(), BAR_WIDTH)) {
			drag = Drag.HUE;
		} else if (alpha && inside(mouseX, mouseY, alphaX(), BAR_WIDTH)) {
			drag = Drag.ALPHA;
		}

		mouseDragged(mouseX, mouseY, button);
		return true;
	}

	/** Hit test for the square and bars, with a little slack around them. */
	private boolean inside(double mouseX, double mouseY, double left, int width) {
		return mouseX >= left - 2 && mouseX < left + width + 2 && mouseY >= squareY() - 2 && mouseY < squareY() + SQUARE_HEIGHT + 2;
	}

	@Override
	public void mouseDragged(double mouseX, double mouseY, int button) {
		float vertical = (float) clamp01((mouseY - squareY()) / SQUARE_HEIGHT);

		switch (drag) {
			case SQUARE -> model.setSaturationValue((float) clamp01((mouseX - squareX()) / SQUARE_WIDTH), 1 - vertical);
			case HUE -> model.setHue(vertical);
			case ALPHA -> model.setAlpha(Math.round((1 - vertical) * 255));
			case NONE -> hex.mouseDragged(mouseX, mouseY, button);
		}
	}

	@Override
	public void mouseReleased(double mouseX, double mouseY, int button) {
		drag = Drag.NONE;
		hex.mouseReleased(mouseX, mouseY, button);
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (event.isEscape()) {
			return false;
		}

		return hex.isFocused() && hex.keyPressed(event);
	}

	@Override
	public boolean charTyped(CharacterEvent event) {
		return hex.isFocused() && hex.charTyped(event);
	}

	@Override
	public CursorType cursor(double mouseX, double mouseY) {
		if (drag != Drag.NONE) {
			return CursorTypes.CROSSHAIR;
		}

		if (hex.contains(mouseX, mouseY)) {
			return CursorTypes.IBEAM;
		}

		boolean picker = inside(mouseX, mouseY, squareX(), SQUARE_WIDTH) || inside(mouseX, mouseY, hueX(), BAR_WIDTH)
				|| (alpha && inside(mouseX, mouseY, alphaX(), BAR_WIDTH));
		return picker ? CursorTypes.CROSSHAIR : CursorTypes.ARROW;
	}

	@Override
	public void onClosed() {
		hex.setFocused(false);
	}

	private static double clamp01(double v) {
		return v < 0 ? 0 : v > 1 ? 1 : v;
	}
}
