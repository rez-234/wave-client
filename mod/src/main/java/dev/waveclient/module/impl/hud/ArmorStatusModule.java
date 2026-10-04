package dev.waveclient.module.impl.hud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

import dev.waveclient.hud.HudDefaults;
import dev.waveclient.hud.CachedText;
import dev.waveclient.hud.HudModule;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.ColorSetting;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.setting.Setting;

/**
 * Your armor and held items with their durability. The same information as the inventory
 * screen, so it is allowed on servers that restrict HUD mods.
 */
// Settings register change listeners that capture 'this', but they only run on later edits.
@SuppressWarnings("this-escape")
public final class ArmorStatusModule extends HudModule {
	public enum Layout implements EnumSetting.Labeled {
		VERTICAL("Vertical"),
		HORIZONTAL("Horizontal");

		private final String label;

		Layout(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	public enum Durability implements EnumSetting.Labeled {
		REMAINING("Remaining (213)"),
		PERCENT("Percent (89%)"),
		OFF("Off");

		private final String label;

		Durability(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	private static final EquipmentSlot[] SLOTS = {
			EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET, EquipmentSlot.MAINHAND, EquipmentSlot.OFFHAND
	};
	private static final int MAIN_HAND = 4;
	private static final int OFFHAND = 5;
	private static final int ITEM = 16;
	private static final int TEXT_GAP = 2;
	private static final int ROW_GAP = 1;
	private static final int COLUMN_GAP = 4;
	private static final int TEXT_TOP = 4;
	private static final int REMEASURE_TICKS = 20;

	public final EnumSetting<Layout> layout = add(new EnumSetting<>("layout", "Layout", Layout.VERTICAL));
	public final EnumSetting<Durability> durability = add(new EnumSetting<>("durability", "Durability", Durability.REMAINING));
	public final BooleanSetting colorByDurability = add(new BooleanSetting("colorByDurability", "Color by durability", true)
			.describe("Green when new, turning red as it wears out, like the durability bar."));
	public final BooleanSetting showMainHand = add(new BooleanSetting("showMainHand", "Main hand", true));
	public final BooleanSetting showOffhand = add(new BooleanSetting("showOffhand", "Offhand", false));
	public final ColorSetting textColor = add(new ColorSetting("textColor", "Text color", 0xFFFFFFFF));
	public final BooleanSetting textShadow = add(new BooleanSetting("textShadow", "Text shadow", true));

	private final ItemStack[] stacks = new ItemStack[SLOTS.length];
	private final Item[] shownItems = new Item[SLOTS.length];
	private final int[] shownDamage = new int[SLOTS.length];
	private final int[] shownMax = new int[SLOTS.length];
	private final int[] shownCount = new int[SLOTS.length];
	private final CachedText[] texts = new CachedText[SLOTS.length];
	private final int[] colors = new int[SLOTS.length];
	/** Slot indexes to draw, in order. */
	private final int[] rows = new int[SLOTS.length];
	private final StringBuilder text = new StringBuilder(8);
	private ItemStack[] samples;
	private int rowCount;
	private int width;
	private int height;
	private boolean stale = true;
	private int ticksSinceMeasure;

	public ArmorStatusModule() {
		super("armor_status", "Armor Status", "Shows your armor and held item with their durability.", HudDefaults.ARMOR_STATUS);

		for (int i = 0; i < SLOTS.length; i++) {
			texts[i] = new CachedText();
		}
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

			for (CachedText cached : texts) {
				cached.remeasure();
			}

			// Widths may have changed.
			force |= rowCount > 0;
		}

		refresh(force);
	}

	private void refresh(boolean force) {
		LocalPlayer player = Minecraft.getInstance().player;
		boolean any = false;

		for (int i = 0; i < SLOTS.length; i++) {
			stacks[i] = player != null && slotShown(i) ? player.getItemBySlot(SLOTS[i]) : ItemStack.EMPTY;
			any |= !stacks[i].isEmpty();
		}

		// Something to place in the HUD editor.
		if (!any && isHudEditorOpen()) {
			ItemStack[] placeholders = samples();

			for (int i = 0; i < SLOTS.length; i++) {
				stacks[i] = slotShown(i) ? placeholders[i] : ItemStack.EMPTY;
			}
		}

		boolean changed = force;
		int count = 0;

		for (int i = 0; i < SLOTS.length; i++) {
			ItemStack stack = stacks[i];

			if (stack.isEmpty()) {
				continue;
			}

			rows[count++] = i;
			Item item = stack.getItem();
			int damage = stack.getDamageValue();
			int max = stack.getMaxDamage();
			int stackCount = stack.getCount();

			if (force || item != shownItems[i] || damage != shownDamage[i] || max != shownMax[i] || stackCount != shownCount[i]) {
				shownItems[i] = item;
				shownDamage[i] = damage;
				shownMax[i] = max;
				shownCount[i] = stackCount;
				updateRow(i, stack);
				changed = true;
			}
		}

		if (count != rowCount) {
			rowCount = count;
			changed = true;
		}

		if (changed) {
			measure();
		}
	}

	private boolean slotShown(int slot) {
		return slot < MAIN_HAND || (slot == MAIN_HAND ? showMainHand.get() : showOffhand.get());
	}

	private void updateRow(int slot, ItemStack stack) {
		text.setLength(0);
		boolean damageable = stack.isDamageableItem();

		if (damageable) {
			int max = stack.getMaxDamage();
			int remaining = max - Math.min(max, Math.max(0, stack.getDamageValue()));

			switch (durability.get()) {
				case REMAINING -> text.append(remaining);
				case PERCENT -> text.append(max > 0 ? remaining * 100 / max : 0).append('%');
				case OFF -> { }
			}
		} else if (stack.getCount() > 1) {
			text.append(stack.getCount());
		}

		texts[slot].set(text.toString());
		colors[slot] = damageable && colorByDurability.get() ? 0xFF000000 | stack.getBarColor() : textColor.get();
	}

	private void measure() {
		int w = 0;
		int h = 0;

		for (int r = 0; r < rowCount; r++) {
			int cell = cellWidth(rows[r]);

			if (layout.get() == Layout.VERTICAL) {
				w = Math.max(w, cell);
				h += (r > 0 ? ROW_GAP : 0) + ITEM;
			} else {
				w += (r > 0 ? COLUMN_GAP : 0) + cell;
				h = ITEM;
			}
		}

		width = w;
		height = h;
	}

	private int cellWidth(int slot) {
		int textWidth = texts[slot].width();
		return ITEM + (textWidth > 0 ? TEXT_GAP + textWidth : 0);
	}

	/** Iron armor and a sword, created on first use rather than while items are still being registered. */
	private ItemStack[] samples() {
		if (samples == null) {
			samples = new ItemStack[] {
					new ItemStack(Items.IRON_HELMET), new ItemStack(Items.IRON_CHESTPLATE), new ItemStack(Items.IRON_LEGGINGS),
					new ItemStack(Items.IRON_BOOTS), new ItemStack(Items.IRON_SWORD), new ItemStack(Items.SHIELD)
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
		Font font = Minecraft.getInstance().font;
		// Anchored on the right: items on the right edge, text to their left.
		boolean mirrored = position.anchor().fx > 0.5;
		boolean vertical = layout.get() == Layout.VERTICAL;
		boolean shadow = textShadow.get();
		int x = 0;
		int y = 0;

		for (int r = 0; r < rowCount; r++) {
			int slot = rows[r];
			ItemStack stack = stacks[slot];
			CachedText label = texts[slot];
			int cell = cellWidth(slot);
			int left = vertical ? (mirrored ? width - cell : 0) : x;
			int itemX = mirrored ? left + cell - ITEM : left;
			int textX = mirrored ? left : left + ITEM + TEXT_GAP;

			graphics.renderItem(stack, itemX, y);
			label.draw(graphics, font, textX, y + TEXT_TOP, colors[slot], shadow);

			if (vertical) {
				y += ITEM + ROW_GAP;
			} else {
				x += cell + COLUMN_GAP;
			}
		}
	}
}
