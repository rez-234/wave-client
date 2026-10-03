package dev.waveclient.module.impl.hud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.player.LocalPlayer;

import dev.waveclient.hud.Anchor;
import dev.waveclient.hud.TextHudModule;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.EnumSetting;

/**
 * Your latency to the server, as the server reports it in the player list (updated every few
 * seconds, the same number the tab list's bars show).
 */
public final class PingModule extends TextHudModule {
	public enum Style implements EnumSetting.Labeled {
		NUMBER_FIRST("42 ms"),
		LABEL_FIRST("Ping: 42 ms"),
		NUMBER_ONLY("42");

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
	public final BooleanSetting hideInSingleplayer = add(new BooleanSetting("hideInSingleplayer", "Hide in singleplayer", true)
			.describe("Singleplayer worlds have no network latency to show."));

	/** Shown in the HUD editor when there is no latency to show, so the element can be placed. */
	private static final int EDITOR_SAMPLE = 42;
	/** The server sent no latency for us, or a negative one: vanilla's tab list shows this as unknown. */
	private static final int UNKNOWN = -2;
	private static final int HIDDEN = -1;

	private final StringBuilder text = new StringBuilder(16);
	private int shownLatency = Integer.MIN_VALUE;

	public PingModule() {
		super("ping", "Ping", "Shows your latency to the server.", Anchor.TOP_LEFT, 4, 78);
	}

	@Override
	protected void updateText(boolean force) {
		int latency = latency();

		if (latency == HIDDEN && editorOpen()) {
			latency = EDITOR_SAMPLE;
		}

		if (!force && latency == shownLatency) {
			return;
		}

		shownLatency = latency;

		if (latency == HIDDEN) {
			setLines();
			return;
		}

		text.setLength(0);

		if (style.get() == Style.LABEL_FIRST) {
			text.append("Ping: ");
		}

		if (latency == UNKNOWN) {
			text.append('?');
		} else {
			text.append(latency);
		}

		if (style.get() != Style.NUMBER_ONLY) {
			text.append(" ms");
		}

		setLines(text.toString());
	}

	/** The latency in milliseconds, {@link #UNKNOWN}, or {@link #HIDDEN} when there is nothing to show. */
	private int latency() {
		Minecraft minecraft = Minecraft.getInstance();
		LocalPlayer player = minecraft.player;
		ClientPacketListener connection = minecraft.getConnection();

		if (player == null || connection == null) {
			return HIDDEN;
		}

		if (minecraft.isSingleplayer() && hideInSingleplayer.get()) {
			return HIDDEN;
		}

		PlayerInfo info = connection.getPlayerInfo(player.getUUID());
		int latency = info != null ? info.getLatency() : -1;
		return latency >= 0 ? latency : UNKNOWN;
	}
}
