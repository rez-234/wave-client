package dev.waveclient.module.impl.hud;

import java.time.LocalTime;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;

import dev.waveclient.hud.Anchor;
import dev.waveclient.hud.TextHudModule;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.util.TimeFormat;

/** The real time of day, the time in the game world, or both. */
public final class ClockModule extends TextHudModule {
	public enum Source implements EnumSetting.Labeled {
		REAL("Real time"),
		GAME("Game time"),
		BOTH("Both");

		private final String label;

		Source(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	public final EnumSetting<Source> source = add(new EnumSetting<>("source", "Show", Source.REAL));
	public final BooleanSetting twelveHour = add(new BooleanSetting("twelveHour", "12-hour clock", false)
			.describe("2:05 PM instead of 14:05."));
	public final BooleanSetting seconds = add(new BooleanSetting("seconds", "Show seconds", false)
			.describe("Applies to the real time only.")
			.visibleWhen(() -> source.get() != Source.GAME));

	/** The Nether and the End have no day cycle; the vanilla clock item spins there. */
	private static final int NO_GAME_TIME = -2;

	private final StringBuilder real = new StringBuilder(16);
	private final StringBuilder game = new StringBuilder(16);
	private long checkedSecond = Long.MIN_VALUE;
	private int shownRealKey = -1;
	private int shownGameKey = -1;

	public ClockModule() {
		super("clock", "Clock", "Shows the time of day, in real life or in the game.", Anchor.TOP_RIGHT, -4, 4);
	}

	@Override
	protected void updateText(boolean force) {
		Source shown = source.get();
		boolean changed = force;

		// LocalTime.now() allocates, so only ask for it once a second.
		long second = System.currentTimeMillis() / 1000;

		if (shown != Source.GAME && (second != checkedSecond || force)) {
			checkedSecond = second;
			LocalTime now = LocalTime.now();
			int key = now.toSecondOfDay();

			// Without seconds, only a new minute changes the text.
			if (!seconds.get()) {
				key /= 60;
			}

			if (key != shownRealKey || force) {
				shownRealKey = key;
				real.setLength(0);
				TimeFormat.appendClock(real, now.getHour(), now.getMinute(), now.getSecond(), twelveHour.get(), seconds.get());
				changed = true;
			}
		}

		if (shown != Source.REAL) {
			ClientLevel level = Minecraft.getInstance().level;

			if (level != null) {
				long dayTime = level.getDayTime();
				boolean fixed = level.dimensionType().hasFixedTime();
				int key = fixed ? NO_GAME_TIME : TimeFormat.gameHour(dayTime) * 60 + TimeFormat.gameMinute(dayTime);

				if (key != shownGameKey || force) {
					shownGameKey = key;
					game.setLength(0);
					game.append("Game ");

					if (fixed) {
						game.append("--:--");
					} else {
						TimeFormat.appendClock(game, TimeFormat.gameHour(dayTime), TimeFormat.gameMinute(dayTime), 0, twelveHour.get(), false);
					}

					changed = true;
				}
			}
		}

		if (!changed) {
			return;
		}

		switch (shown) {
			case REAL -> setLines(real.toString());
			case GAME -> setLines(game.toString());
			case BOTH -> setLines(real.toString(), game.toString());
		}
	}
}
