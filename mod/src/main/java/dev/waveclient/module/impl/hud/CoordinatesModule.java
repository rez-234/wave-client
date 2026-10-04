package dev.waveclient.module.impl.hud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;

import dev.waveclient.hud.HudDefaults;
import dev.waveclient.hud.TextHudModule;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.setting.SliderSetting;
import dev.waveclient.util.TextFormat;

/** The player's position, as block coordinates or with decimals. */
public final class CoordinatesModule extends TextHudModule {
	public enum Layout implements EnumSetting.Labeled {
		VERTICAL("One line per axis"),
		HORIZONTAL("Single line");

		private final String label;

		Layout(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	public final EnumSetting<Layout> layout = add(new EnumSetting<>("layout", "Layout", Layout.VERTICAL));
	public final SliderSetting decimals = add(new SliderSetting("decimals", "Decimal places", 0, 0, 3, 1)
			.describe("0 shows block coordinates, like the F3 \"Block\" line."));

	private final StringBuilder text = new StringBuilder(48);
	private long shownX = Long.MIN_VALUE;
	private long shownY = Long.MIN_VALUE;
	private long shownZ = Long.MIN_VALUE;

	public CoordinatesModule() {
		super("coordinates", "Coordinates", "Shows your X, Y and Z position.", HudDefaults.COORDINATES);
	}

	@Override
	protected void updateText(boolean force) {
		LocalPlayer player = Minecraft.getInstance().player;

		if (player == null) {
			return;
		}

		int places = decimals.getInt();
		long qx = quantize(player.getX(), places);
		long qy = quantize(player.getY(), places);
		long qz = quantize(player.getZ(), places);

		if (!force && qx == shownX && qy == shownY && qz == shownZ) {
			return;
		}

		shownX = qx;
		shownY = qy;
		shownZ = qz;

		if (layout.get() == Layout.HORIZONTAL) {
			text.setLength(0);
			text.append("XYZ: ");
			TextFormat.appendScaled(text, qx, places).append(" / ");
			TextFormat.appendScaled(text, qy, places).append(" / ");
			TextFormat.appendScaled(text, qz, places);
			setLines(text.toString());
		} else {
			setLines(axisLine("X: ", qx, places), axisLine("Y: ", qy, places), axisLine("Z: ", qz, places));
		}
	}

	private String axisLine(String label, long quantized, int places) {
		text.setLength(0);
		text.append(label);
		return TextFormat.appendScaled(text, quantized, places).toString();
	}

	/**
	 * The value shown, scaled by 10^places. Block coordinates are floored (like F3); decimal
	 * coordinates are rounded half away from zero, so -1.25 shows as -1.3 like 1.25 shows as 1.3.
	 * The same number drives change detection and display, so they can't disagree.
	 */
	private static long quantize(double value, int places) {
		return places == 0 ? (long) Math.floor(value) : TextFormat.scaleRounded(value, places);
	}
}
