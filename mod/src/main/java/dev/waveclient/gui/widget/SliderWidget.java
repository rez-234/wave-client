package dev.waveclient.gui.widget;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.input.KeyEvent;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.render.Text;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.setting.SliderSetting;
import dev.waveclient.util.ColorMath;

/**
 * A slider for a {@link SliderSetting}: the value on the left, the track on the right. Click
 * or drag anywhere on the track; arrow keys step while focused (Shift: ten steps), Home and End
 * jump to the ends.
 */
public final class SliderWidget extends Widget {
	public static final int HEIGHT = 14;
	private static final int VALUE_WIDTH = 38;
	private static final int GAP = 6;
	private static final double TRACK_HEIGHT = 3;
	private static final double KNOB = 8;
	private static final int GLFW_KEY_HOME = 268;
	private static final int GLFW_KEY_END = 269;

	private final SliderSetting setting;
	private final Text value = new Text(UiFont.BODY);
	private boolean dragging;
	private float knobGrow;
	private double shownValue = Double.NaN;

	public SliderWidget(SliderSetting setting) {
		this.setting = setting;
		this.height = HEIGHT;
	}

	private double trackLeft() {
		return x + VALUE_WIDTH + GAP + KNOB / 2;
	}

	private double trackWidth() {
		return Math.max(1, width - VALUE_WIDTH - GAP - KNOB);
	}

	@Override
	public void render(Painter painter, boolean hovered, double mouseX, double mouseY, float seconds) {
		animateHover(hovered || dragging, seconds);
		knobGrow = Anim.approach(knobGrow, dragging || isFocused() ? 1 : hover, seconds, 16);
		double centerY = y + height / 2.0;

		if (setting.get() != shownValue) {
			shownValue = setting.get();
			value.set(setting.displayValue());
		}

		float valueWidth = value.fittedWidth(painter, VALUE_WIDTH);
		value.drawFitted(painter, x + VALUE_WIDTH - valueWidth, centerY, VALUE_WIDTH, setting.isDefault() ? Theme.TEXT_MUTED : Theme.TEXT);

		double left = trackLeft();
		double trackWidth = trackWidth();
		double fraction = setting.fraction();
		double trackTop = centerY - TRACK_HEIGHT / 2;
		painter.pill(left - KNOB / 2, trackTop, trackWidth + KNOB, TRACK_HEIGHT, Theme.TRACK);
		painter.pill(left - KNOB / 2, trackTop, trackWidth * fraction + KNOB, TRACK_HEIGHT, Theme.ACCENT);

		double size = KNOB + knobGrow;
		double knobX = left + trackWidth * fraction - size / 2;

		if (isFocused()) {
			painter.pill(knobX - 1.5, centerY - size / 2 - 1.5, size + 3, size + 3, ColorMath.withAlpha(Theme.ACCENT, 0x50));
		}

		painter.pill(knobX, centerY - size / 2, size, size, Theme.ON_ACCENT);
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
		if (button != 0 || mouseX < x + VALUE_WIDTH) {
			return false;
		}

		dragging = true;
		setFromMouse(mouseX);
		return true;
	}

	@Override
	public void mouseDragged(double mouseX, double mouseY, int button) {
		if (dragging) {
			setFromMouse(mouseX);
		}
	}

	@Override
	public void mouseReleased(double mouseX, double mouseY, int button) {
		dragging = false;
	}

	private void setFromMouse(double mouseX) {
		setting.setFraction(Math.max(0, Math.min(1, (mouseX - trackLeft()) / trackWidth())));
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		double step = setting.keyboardStep() * (event.hasShiftDown() ? 10 : 1);

		if (event.isLeft() || event.isDown()) {
			setting.set(setting.get() - step);
		} else if (event.isRight() || event.isUp()) {
			setting.set(setting.get() + step);
		} else if (event.key() == GLFW_KEY_HOME) {
			setting.set(setting.min());
		} else if (event.key() == GLFW_KEY_END) {
			setting.set(setting.max());
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
	protected void onFocusChanged(boolean focused) {
		if (!focused) {
			dragging = false;
		}
	}

	@Override
	public CursorType cursor(double mouseX, double mouseY) {
		if (dragging) {
			return CursorTypes.RESIZE_EW;
		}

		return mouseX >= x + VALUE_WIDTH ? CursorTypes.POINTING_HAND : CursorTypes.ARROW;
	}

	@Override
	public String tooltip(double mouseX, double mouseY) {
		return "Range " + setting.formatNumber(setting.min()) + " to " + setting.formatNumber(setting.max()) + setting.unit()
				+ ". Arrow keys adjust it.";
	}
}
