package dev.waveclient.module.impl.hud;

import net.minecraft.client.Minecraft;

import dev.waveclient.hud.HudDefaults;
import dev.waveclient.hud.TextHudModule;
import dev.waveclient.setting.EnumSetting;

/** Frames per second, as counted by the game (updated once a second). */
public final class FpsModule extends TextHudModule {
	public enum Style implements EnumSetting.Labeled {
		NUMBER_FIRST("144 FPS"),
		LABEL_FIRST("FPS: 144"),
		NUMBER_ONLY("144");

		private final String label;

		Style(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	public final EnumSetting<Style> style = add(new EnumSetting<>("style", "Style", Style.NUMBER_FIRST));

	private final StringBuilder text = new StringBuilder(16);
	private int shownFps = -1;

	public FpsModule() {
		super("fps", "FPS", "Shows your frames per second.", HudDefaults.FPS);
		setDefaultEnabled(true);
	}

	@Override
	protected void updateText(boolean force) {
		int fps = Minecraft.getInstance().getFps();

		if (!force && fps == shownFps) {
			return;
		}

		shownFps = fps;
		text.setLength(0);

		switch (style.get()) {
			case NUMBER_FIRST -> text.append(fps).append(" FPS");
			case LABEL_FIRST -> text.append("FPS: ").append(fps);
			case NUMBER_ONLY -> text.append(fps);
		}

		setLines(text.toString());
	}
}
