package dev.waveclient.module.impl.hud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;

import dev.waveclient.hud.HudDefaults;
import dev.waveclient.hud.TextHudModule;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.util.Facing;

/** The compass direction you are facing. */
public final class DirectionModule extends TextHudModule {
	public enum Format implements EnumSetting.Labeled {
		LONG("North"),
		SHORT("N");

		private final String label;

		Format(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	public final EnumSetting<Format> format = add(new EnumSetting<>("format", "Format", Format.LONG));
	public final BooleanSetting intercardinal = add(new BooleanSetting("intercardinal", "Eight directions", false)
			.describe("Also show northeast, southwest and so on."));
	public final BooleanSetting axes = add(new BooleanSetting("axes", "Show axis", true)
			.describe("The coordinate that grows in that direction, e.g. -Z for north."));
	public final BooleanSetting degrees = add(new BooleanSetting("degrees", "Show degrees", false)
			.describe("The yaw from 0 to 359, where 0 is south."));

	private final StringBuilder text = new StringBuilder(32);
	private Facing shownFacing;
	private int shownDegrees = -1;

	public DirectionModule() {
		super("direction", "Direction", "Shows the direction you are facing.", HudDefaults.DIRECTION);
	}

	@Override
	protected void updateText(boolean force) {
		LocalPlayer player = Minecraft.getInstance().player;

		if (player == null) {
			return;
		}

		float yaw = player.getYRot();
		Facing facing = Facing.of(yaw, intercardinal.get());
		int wholeDegrees = (int) Math.floor(Facing.normalize(yaw)) % 360;

		if (!force && facing == shownFacing && (!degrees.get() || wholeDegrees == shownDegrees)) {
			return;
		}

		shownFacing = facing;
		shownDegrees = wholeDegrees;
		text.setLength(0);
		text.append(format.get() == Format.LONG ? facing.longName() : facing.shortName());

		if (axes.get()) {
			text.append(" (").append(facing.axes()).append(')');
		}

		if (degrees.get()) {
			text.append(' ').append(wholeDegrees).append('°');
		}

		setLines(text.toString());
	}
}
