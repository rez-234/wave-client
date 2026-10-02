package dev.waveclient.gui.widget;

import java.util.function.BooleanSupplier;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.input.KeyEvent;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.util.ColorMath;

/** An on/off switch. Reads its state every frame, so changes from anywhere else show up. */
public final class SwitchWidget extends Widget {
	public static final int WIDTH = 20;
	public static final int HEIGHT = 11;
	private static final double PADDING = 1.5;

	private final BooleanSupplier state;
	private final Runnable toggle;
	private final BooleanSupplier usable;
	private float knob = Float.NaN;

	/**
	 * @param usable when false the switch is drawn dimmed and ignores input (e.g. a module the
	 *               server blocks)
	 */
	public SwitchWidget(BooleanSupplier state, Runnable toggle, BooleanSupplier usable) {
		this.state = state;
		this.toggle = toggle;
		this.usable = usable;
		this.width = WIDTH;
		this.height = HEIGHT;
	}

	public SwitchWidget(BooleanSupplier state, Runnable toggle) {
		this(state, toggle, () -> true);
	}

	public boolean isOn() {
		return state.getAsBoolean();
	}

	@Override
	public void render(Painter painter, boolean hovered, double mouseX, double mouseY, float seconds) {
		boolean on = state.getAsBoolean();
		boolean enabled = usable.getAsBoolean();
		animateHover(hovered && enabled, seconds);

		if (Float.isNaN(knob)) {
			knob = on ? 1 : 0;
		}

		knob = Anim.approach(knob, on ? 1 : 0, seconds, 16);

		int track = Theme.mix(Theme.TRACK, Theme.ACCENT, knob);

		if (enabled) {
			track = Theme.mix(track, knob > 0.5f ? Theme.ACCENT_HOVER : Theme.mix(Theme.TRACK, Theme.TEXT_MUTED, 0.4f), hover * 0.6f);
		} else {
			track = Theme.mix(track, Theme.SURFACE, 0.55f);
		}

		painter.pill(x, y, width, height, track);

		double size = height - 2 * PADDING;
		double knobX = x + PADDING + knob * (width - 2 * PADDING - size);
		int knobColor = enabled ? Theme.ON_ACCENT : Theme.TEXT_MUTED;

		if (showsFocus(painter) && enabled) {
			painter.pill(knobX - 1, y + PADDING - 1, size + 2, size + 2, ColorMath.withAlpha(Theme.ON_ACCENT, 0x40));
		}

		painter.pill(knobX, y + PADDING, size, size, knobColor);
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
		if (button != 0 || !usable.getAsBoolean()) {
			return false;
		}

		toggle.run();
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (event.isSelection() && usable.getAsBoolean()) {
			toggle.run();
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
}
