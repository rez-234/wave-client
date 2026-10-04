package dev.waveclient.module.impl.hud;

import java.util.ArrayList;
import java.util.Comparator;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.numbers.FixedFormat;
import net.minecraft.network.chat.numbers.NumberFormat;
import net.minecraft.network.chat.numbers.StyledFormat;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.scores.DisplaySlot;
import net.minecraft.world.scores.Objective;
import net.minecraft.world.scores.PlayerScoreEntry;
import net.minecraft.world.scores.PlayerTeam;
import net.minecraft.world.scores.Scoreboard;

import dev.waveclient.hud.HudDefaults;
import dev.waveclient.hud.CachedComponent;
import dev.waveclient.hud.HudModule;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.Setting;
import dev.waveclient.setting.SliderSetting;

/**
 * The sidebar scoreboard as a HUD element you can move and resize in the HUD editor, with the
 * red score numbers hidden. Shows exactly what vanilla would: the same objective (including team
 * color slots), team prefixes and suffixes, order and 15-line limit.
 *
 * <p>The scoreboard is read once a tick and lines are measured only when they change, so drawing
 * allocates nothing.
 */
// Settings register change listeners that capture 'this', but they only run on later edits.
@SuppressWarnings("this-escape")
public final class ScoreboardModule extends HudModule {
	private static final int REMEASURE_TICKS = 20;
	private static final Comparator<PlayerScoreEntry> ORDER = (a, b) -> ScoreboardLayout.compare(a.value(), a.owner(), b.value(), b.owner());

	public final BooleanSetting hideNumbers = add(new BooleanSetting("hideNumbers", "Hide numbers", true)
			.describe("Hide the red score numbers. Text a server shows in their place is kept."));
	public final SliderSetting backgroundOpacity = add(new SliderSetting("backgroundOpacity", "Background", 30, 0, 100, 5).unit("%"));
	public final BooleanSetting textShadow = add(new BooleanSetting("textShadow", "Text shadow", false));

	private final CachedComponent title = new CachedComponent();
	private final CachedComponent[] names = new CachedComponent[ScoreboardLayout.MAX_ROWS];
	private final CachedComponent[] scores = new CachedComponent[ScoreboardLayout.MAX_ROWS];
	private final int[] nameWidths = new int[ScoreboardLayout.MAX_ROWS];
	private final int[] scoreWidths = new int[ScoreboardLayout.MAX_ROWS];
	private final ArrayList<PlayerScoreEntry> entries = new ArrayList<>(32);
	private Component sampleTitle;
	private Component[] sampleNames;
	private int[] sampleValues;
	private int rows;
	private int contentWidth;
	private int width;
	private int height;
	private int spacerWidth = -1;
	private boolean stale = true;
	private int ticksSinceMeasure;

	public ScoreboardModule() {
		// Right edge and vertical center where vanilla puts a 10-line sidebar.
		super("scoreboard", "Scoreboard", "Move and resize the sidebar scoreboard, and hide its numbers.", HudDefaults.SCOREBOARD);

		for (int i = 0; i < ScoreboardLayout.MAX_ROWS; i++) {
			names[i] = new CachedComponent();
			scores[i] = new CachedComponent();
		}
	}

	/** Whether the vanilla sidebar should be hidden right now. */
	public boolean hidesVanilla() {
		return isActive();
	}

	/** It is the sidebar now, and vanilla keeps the sidebar under F3. */
	@Override
	public boolean shownWithDebugScreen() {
		return true;
	}

	@Override
	protected void onSettingChanged(Setting<?> setting) {
		stale = true;
	}

	@Override
	protected void onEnable() {
		stale = true;
	}

	@Override
	public void prepareForEditor() {
		refresh(true);
	}

	@Override
	protected void onTick() {
		boolean force = stale;
		stale = false;

		if (++ticksSinceMeasure >= REMEASURE_TICKS) {
			force = true;
		}

		refresh(force);
	}

	private void refresh(boolean force) {
		if (force) {
			ticksSinceMeasure = 0;
		}

		Minecraft minecraft = Minecraft.getInstance();
		Objective objective = minecraft.level != null && minecraft.player != null ? sidebarObjective(minecraft.level.getScoreboard(), minecraft.player) : null;

		if (objective != null) {
			showObjective(objective, force);
		} else if (isHudEditorOpen()) {
			showSample(force);
		} else {
			// Nothing to show: no size, so the HUD skips it.
			showRows(0, force, rows != 0 || width != 0);
			width = 0;
			height = 0;
		}
	}

	/** The objective vanilla would show: the player's team color slot if it has one, otherwise the sidebar. */
	private static Objective sidebarObjective(Scoreboard scoreboard, Player player) {
		PlayerTeam team = scoreboard.getPlayersTeam(player.getScoreboardName());

		if (team != null) {
			DisplaySlot slot = DisplaySlot.teamColorToSlot(team.getColor());
			Objective teamObjective = slot != null ? scoreboard.getDisplayObjective(slot) : null;

			if (teamObjective != null) {
				return teamObjective;
			}
		}

		return scoreboard.getDisplayObjective(DisplaySlot.SIDEBAR);
	}

	private void showObjective(Objective objective, boolean force) {
		Scoreboard scoreboard = objective.getScoreboard();
		NumberFormat format = objective.numberFormatOrDefault(StyledFormat.SIDEBAR_DEFAULT);

		// Like vanilla: drop hidden entries, then sort, then keep 15.
		for (PlayerScoreEntry entry : scoreboard.listPlayerScores(objective)) {
			if (!entry.isHidden()) {
				entries.add(entry);
			}
		}

		entries.sort(ORDER);
		int count = Math.min(ScoreboardLayout.MAX_ROWS, entries.size());
		boolean changed = title.set(objective.getDisplayName());

		for (int i = 0; i < count; i++) {
			PlayerScoreEntry entry = entries.get(i);
			changed |= names[i].set(PlayerTeam.formatNameForTeam(scoreboard.getPlayersTeam(entry.owner()), entry.ownerName()));
			NumberFormat effective = entry.numberFormatOverride() != null ? entry.numberFormatOverride() : format;
			changed |= scores[i].set(hidesScore(effective) ? CommonComponents.EMPTY : entry.formatValue(format));
		}

		entries.clear();
		showRows(count, force, changed);
	}

	/** Numbers are hidden; text a server put in their place (a fixed format) is not. */
	private boolean hidesScore(NumberFormat format) {
		return hideNumbers.get() && !(format instanceof FixedFormat);
	}

	/** Something to place in the HUD editor when the server shows no scoreboard. */
	private void showSample(boolean force) {
		if (sampleTitle == null) {
			sampleTitle = Component.literal("Wave Client").withStyle(ChatFormatting.YELLOW, ChatFormatting.BOLD);
			sampleNames = new Component[] {
					Component.literal("Map: ").append(Component.literal("Skyways").withStyle(ChatFormatting.GREEN)),
					Component.literal("Players: ").append(Component.literal("8/12").withStyle(ChatFormatting.GREEN)),
					CommonComponents.EMPTY,
					Component.literal("Kills: ").append(Component.literal("12").withStyle(ChatFormatting.GREEN)),
					Component.literal("Deaths: ").append(Component.literal("3").withStyle(ChatFormatting.RED))
			};
			sampleValues = new int[] {5, 4, 3, 2, 1};
		}

		boolean changed = title.set(sampleTitle);

		for (int i = 0; i < sampleNames.length; i++) {
			changed |= names[i].set(sampleNames[i]);
			changed |= scores[i].set(hidesScore(StyledFormat.SIDEBAR_DEFAULT) ? CommonComponents.EMPTY : StyledFormat.SIDEBAR_DEFAULT.format(sampleValues[i]));
		}

		showRows(sampleNames.length, force, changed);
	}

	private void showRows(int count, boolean force, boolean changed) {
		// Release lines no longer shown.
		for (int i = count; i < rows; i++) {
			names[i].set(CommonComponents.EMPTY);
			scores[i].set(CommonComponents.EMPTY);
		}

		if (force || spacerWidth < 0) {
			title.remeasure();

			for (int i = 0; i < count; i++) {
				names[i].remeasure();
				scores[i].remeasure();
			}

			spacerWidth = Minecraft.getInstance().font.width(": ");
		}

		if (!changed && !force && count == rows) {
			return;
		}

		rows = count;

		for (int i = 0; i < count; i++) {
			nameWidths[i] = names[i].width();
			scoreWidths[i] = scores[i].width();
		}

		contentWidth = ScoreboardLayout.contentWidth(title.width(), nameWidths, scoreWidths, count, spacerWidth);
		width = ScoreboardLayout.width(contentWidth);
		height = ScoreboardLayout.height(count);
	}

	@Override
	public int width() {
		return width;
	}

	@Override
	public int height() {
		return height;
	}

	@Override
	public void render(GuiGraphics graphics) {
		if (width == 0) {
			return;
		}

		Font font = Minecraft.getInstance().font;
		boolean shadow = textShadow.get();
		double opacity = backgroundOpacity.get() / 100.0;
		int body = ScoreboardLayout.bodyAlpha(opacity);
		int band = ScoreboardLayout.titleAlpha(opacity);

		if (band != 0) {
			graphics.fill(0, 0, width, ScoreboardLayout.TITLE_BAND - 1, band << 24);
		}

		if (body != 0) {
			graphics.fill(0, ScoreboardLayout.TITLE_BAND - 1, width, height, body << 24);
		}

		// White where a line has no color of its own, as in vanilla.
		title.draw(graphics, font, ScoreboardLayout.titleX(contentWidth, title.width()), ScoreboardLayout.TITLE_Y, -1, shadow);

		for (int row = 0; row < rows; row++) {
			int y = ScoreboardLayout.rowY(row);
			names[row].draw(graphics, font, ScoreboardLayout.PAD, y, -1, shadow);

			if (scoreWidths[row] > 0) {
				scores[row].draw(graphics, font, ScoreboardLayout.scoreX(contentWidth, scoreWidths[row]), y, -1, shadow);
			}
		}
	}
}
