package dev.waveclient.module.impl.hud;

import java.util.Arrays;
import java.util.Collection;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.client.resources.language.I18n;
import net.minecraft.core.Holder;
import net.minecraft.resources.Identifier;
import net.minecraft.util.ARGB;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;

import dev.waveclient.hud.HudDefaults;
import dev.waveclient.hud.CachedText;
import dev.waveclient.hud.HudModule;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.ColorSetting;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.setting.Setting;
import dev.waveclient.util.EffectBlink;
import dev.waveclient.util.Roman;
import dev.waveclient.util.TimeFormat;

/**
 * Your active effects with their level and time left, in the inventory's order. Effects a server
 * hides from the HUD stay hidden, and the list is hidden while the inventory shows them.
 */
// Settings register change listeners that capture 'this', but they only run on later edits.
@SuppressWarnings("this-escape")
public final class PotionEffectsModule extends HudModule {
	public enum LevelStyle implements EnumSetting.Labeled {
		ROMAN("Roman (Speed II)"),
		NUMBER("Number (Speed 2)");

		private final String label;

		LevelStyle(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	private static final int ICON = 18;
	private static final int TEXT_GAP = 4;
	private static final int ROW_GAP = 2;
	private static final int LINE = 10;
	private static final int REMEASURE_TICKS = 20;
	private static final int INFINITE = -1;

	public final BooleanSetting showIcons = add(new BooleanSetting("showIcons", "Icons", true));
	public final BooleanSetting showNames = add(new BooleanSetting("showNames", "Names", true));
	public final BooleanSetting showDuration = add(new BooleanSetting("showDuration", "Time left", true));
	public final EnumSetting<LevelStyle> levelStyle = add(new EnumSetting<>("levelStyle", "Level", LevelStyle.ROMAN)
			.visibleWhen(showNames::get));
	public final BooleanSetting showAmbient = add(new BooleanSetting("showAmbient", "Beacon effects", true)
			.describe("Show effects from beacons and conduits."));
	public final BooleanSetting blink = add(new BooleanSetting("blink", "Blink when ending", true)
			.describe("Fade the icon in and out during the last ten seconds, like the vanilla HUD.")
			.visibleWhen(showIcons::get));
	public final BooleanSetting hideVanilla = add(new BooleanSetting("hideVanilla", "Hide vanilla icons", true)
			.describe("Hide the effect icons the game shows in the top-right corner."));
	public final BooleanSetting colorNames = add(new BooleanSetting("colorNames", "Color names by effect", false)
			.visibleWhen(showNames::get));
	public final ColorSetting nameColor = add(new ColorSetting("nameColor", "Name color", 0xFFFFFFFF)
			.visibleWhen(() -> showNames.get() && !colorNames.get()));
	public final ColorSetting durationColor = add(new ColorSetting("durationColor", "Time color", 0xFFA0A0A0)
			.visibleWhen(showDuration::get));
	public final BooleanSetting textShadow = add(new BooleanSetting("textShadow", "Text shadow", true));

	private MobEffectInstance[] effects = new MobEffectInstance[8];
	private Holder<?>[] shownEffect = new Holder<?>[8];
	private int[] shownAmplifier = new int[8];
	private int[] shownSeconds = new int[8];
	private Identifier[] sprites = new Identifier[8];
	private CachedText[] names = texts(8);
	private CachedText[] durations = texts(8);
	private int[] nameColors = new int[8];
	private final StringBuilder text = new StringBuilder(32);
	private MobEffectInstance[] samples;
	private int count;
	private int width;
	private int height;
	private boolean stale = true;
	private int ticksSinceMeasure;

	public PotionEffectsModule() {
		super("potion_effects", "Potion Effects", "Shows your active effects and how long they last.", HudDefaults.POTION_EFFECTS);
	}

	private static CachedText[] texts(int size) {
		CachedText[] out = new CachedText[size];

		for (int i = 0; i < size; i++) {
			out[i] = new CachedText();
		}

		return out;
	}

	/** Whether the vanilla effect icons should be hidden right now (read by the HUD element that wraps them). */
	public boolean hidesVanillaIcons() {
		return isActive() && hideVanilla.get();
	}

	/** Stays under F3 while it stands in for vanilla's icons, which vanilla keeps under F3. */
	@Override
	public boolean shownWithDebugScreen() {
		return hideVanilla.get();
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
			ticksSinceMeasure = 0;
			force = true;
		}

		refresh(force);
	}

	private void refresh(boolean force) {
		Minecraft minecraft = Minecraft.getInstance();
		LocalPlayer player = minecraft.player;
		ClientLevel level = minecraft.level;
		int n = 0;

		if (player != null) {
			Collection<MobEffectInstance> active = player.getActiveEffects();

			for (MobEffectInstance effect : active) {
				// Like the vanilla HUD: an effect the server marked as having no icon stays hidden.
				if (effect.showIcon() && (showAmbient.get() || !effect.isAmbient())) {
					ensureCapacity(n + 1);
					effects[n++] = effect;
				}
			}
		}

		if (n == 0 && isHudEditorOpen()) {
			MobEffectInstance[] placeholders = samples();
			ensureCapacity(placeholders.length);
			System.arraycopy(placeholders, 0, effects, 0, placeholders.length);
			n = placeholders.length;
		}

		sort(effects, n);

		float tickRate = level != null ? level.tickRateManager().tickrate() : 20.0F;
		boolean changed = force || n != count;

		for (int i = 0; i < n; i++) {
			MobEffectInstance effect = effects[i];
			int seconds = effect.isInfiniteDuration() ? INFINITE : (int) Math.floor(effect.getDuration() / tickRate);

			if (force || effect.getEffect() != shownEffect[i] || effect.getAmplifier() != shownAmplifier[i]) {
				shownEffect[i] = effect.getEffect();
				shownAmplifier[i] = effect.getAmplifier();
				updateName(i, effect);
				changed = true;
			}

			if (force || seconds != shownSeconds[i]) {
				shownSeconds[i] = seconds;
				updateDuration(i, effect, tickRate);
				changed = true;
			}
		}

		for (int i = n; i < count; i++) {
			// Don't keep removed effects alive.
			effects[i] = null;
			shownEffect[i] = null;
		}

		count = n;

		if (changed) {
			measure();
		}
	}

	private void updateName(int row, MobEffectInstance effect) {
		Holder<MobEffect> holder = effect.getEffect();
		sprites[row] = Gui.getMobEffectSprite(holder);
		nameColors[row] = 0xFF000000 | holder.value().getColor();
		text.setLength(0);
		text.append(I18n.get(holder.value().getDescriptionId()));
		int level = effect.getAmplifier() + 1;

		if (level > 1) {
			text.append(' ');

			if (levelStyle.get() == LevelStyle.ROMAN) {
				Roman.append(text, level);
			} else {
				text.append(level);
			}
		}

		if (!names[row].set(text.toString())) {
			names[row].remeasure();
		}
	}

	private void updateDuration(int row, MobEffectInstance effect, float tickRate) {
		String value;

		if (effect.isInfiniteDuration()) {
			value = I18n.get("effect.duration.infinite");
		} else {
			text.setLength(0);
			value = TimeFormat.appendTickDuration(text, effect.getDuration(), tickRate).toString();
		}

		if (!durations[row].set(value)) {
			durations[row].remeasure();
		}
	}

	private void measure() {
		int textWidth = 0;

		for (int i = 0; i < count; i++) {
			if (showNames.get()) {
				textWidth = Math.max(textWidth, names[i].width());
			}

			if (showDuration.get()) {
				textWidth = Math.max(textWidth, durations[i].width());
			}
		}

		int icon = showIcons.get() ? ICON : 0;
		int gap = icon > 0 && textWidth > 0 ? TEXT_GAP : 0;
		width = count == 0 ? 0 : icon + gap + textWidth;
		height = count == 0 ? 0 : count * rowHeight() - ROW_GAP;
	}

	private int rowHeight() {
		int lines = (showNames.get() ? 1 : 0) + (showDuration.get() ? 1 : 0);
		int content = Math.max(showIcons.get() ? ICON : 0, lines == 0 ? 0 : (lines - 1) * LINE + 8);
		return content + ROW_GAP;
	}

	private void ensureCapacity(int size) {
		if (size <= effects.length) {
			return;
		}

		int grown = Math.max(size, effects.length * 2);
		effects = Arrays.copyOf(effects, grown);
		shownEffect = Arrays.copyOf(shownEffect, grown);
		shownAmplifier = Arrays.copyOf(shownAmplifier, grown);
		shownSeconds = Arrays.copyOf(shownSeconds, grown);
		sprites = Arrays.copyOf(sprites, grown);
		nameColors = Arrays.copyOf(nameColors, grown);
		CachedText[] moreNames = texts(grown);
		CachedText[] moreDurations = texts(grown);
		System.arraycopy(names, 0, moreNames, 0, names.length);
		System.arraycopy(durations, 0, moreDurations, 0, durations.length);
		names = moreNames;
		durations = moreDurations;
	}

	/** Insertion sort into the inventory's order (beneficial effects aren't separated, unlike the vanilla HUD). */
	private static void sort(MobEffectInstance[] list, int size) {
		for (int i = 1; i < size; i++) {
			MobEffectInstance item = list[i];
			int j = i - 1;

			while (j >= 0 && list[j].compareTo(item) > 0) {
				list[j + 1] = list[j];
				j--;
			}

			list[j + 1] = item;
		}
	}

	/** Speed II and Strength, created on first use rather than while effects are still being registered. */
	private MobEffectInstance[] samples() {
		if (samples == null) {
			samples = new MobEffectInstance[] {
					new MobEffectInstance(MobEffects.SPEED, 90 * 20, 1),
					new MobEffectInstance(MobEffects.STRENGTH, 45 * 20, 0)
			};
		}

		return samples;
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
		Minecraft minecraft = Minecraft.getInstance();

		// The inventory lists them itself; vanilla hides its HUD icons then too.
		if (minecraft.screen != null && minecraft.screen.showsActiveEffects()) {
			return;
		}

		Font font = minecraft.font;
		boolean mirrored = position.anchor().fx > 0.5;
		boolean icons = showIcons.get();
		boolean nameShown = showNames.get();
		boolean durationShown = showDuration.get();
		boolean shadow = textShadow.get();
		int rowHeight = rowHeight();
		int lines = (nameShown ? 1 : 0) + (durationShown ? 1 : 0);
		int textBlock = lines == 0 ? 0 : (lines - 1) * LINE + 8;
		int iconX = mirrored ? width - ICON : 0;

		for (int i = 0; i < count; i++) {
			MobEffectInstance effect = effects[i];
			int y = i * rowHeight;

			if (icons) {
				float alpha = blink.get() ? EffectBlink.alpha(effect.isInfiniteDuration() ? -1 : effect.getDuration(), effect.isAmbient()) : 1.0F;
				graphics.blitSprite(RenderPipelines.GUI_TEXTURED, sprites[i], iconX, y, ICON, ICON, ARGB.white(alpha));
			}

			int textY = y + Math.max(0, (rowHeight - ROW_GAP - textBlock) / 2);

			if (nameShown) {
				CachedText name = names[i];
				name.draw(graphics, font, textX(name, mirrored, icons), textY, colorNames.get() ? nameColors[i] : nameColor.get(), shadow);
				textY += LINE;
			}

			if (durationShown) {
				CachedText duration = durations[i];
				duration.draw(graphics, font, textX(duration, mirrored, icons), textY, durationColor.get(), shadow);
			}
		}
	}

	private int textX(CachedText line, boolean mirrored, boolean icons) {
		int iconSpace = icons ? ICON + TEXT_GAP : 0;
		return mirrored ? width - iconSpace - line.width() : iconSpace;
	}
}
