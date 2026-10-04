package dev.waveclient.module.impl.hud;

import dev.waveclient.WaveClient;
import dev.waveclient.hud.HudDefaults;
import dev.waveclient.hud.TextHudModule;
import dev.waveclient.input.ClickInput;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.EnumSetting;

/** Clicks per second over the last second. Clicks in menus don't count. */
public final class CpsModule extends TextHudModule {
	public enum Style implements EnumSetting.Labeled {
		NUMBER_FIRST("12 CPS"),
		LABEL_FIRST("CPS: 12"),
		NUMBER_ONLY("12");

		private final String label;

		Style(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	public final EnumSetting<ClickInput.Source> source = add(new EnumSetting<>("source", "Count", ClickInput.Source.MOUSE_BUTTONS)
			.describe("Mouse buttons counts left and right clicks. Attack and use keys counts whatever those controls are bound to."));
	public final BooleanSetting showRight = add(new BooleanSetting("showRight", "Show right clicks", false)
			.describe("Show left and right clicks, as 12 | 3 CPS."));
	public final EnumSetting<Style> style = add(new EnumSetting<>("style", "Style", Style.NUMBER_FIRST));

	private final StringBuilder text = new StringBuilder(16);
	private int shownLeft = -1;
	private int shownRight = -1;

	public CpsModule() {
		super("cps", "CPS", "Shows how many times you click per second.", HudDefaults.CPS);
	}

	@Override
	protected void updateText(boolean force) {
		ClickInput clicks = WaveClient.get().clickInput();
		int left = clicks.left(source.get());
		int right = showRight.get() ? clicks.right(source.get()) : 0;

		if (!force && left == shownLeft && right == shownRight) {
			return;
		}

		shownLeft = left;
		shownRight = right;
		text.setLength(0);

		if (style.get() == Style.LABEL_FIRST) {
			text.append("CPS: ");
		}

		text.append(left);

		if (showRight.get()) {
			text.append(" | ").append(right);
		}

		if (style.get() == Style.NUMBER_FIRST) {
			text.append(" CPS");
		}

		setLines(text.toString());
	}
}
