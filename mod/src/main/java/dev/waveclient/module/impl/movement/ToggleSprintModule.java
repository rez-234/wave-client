package dev.waveclient.module.impl.movement;

import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.client.player.LocalPlayer;

import dev.waveclient.hud.HudDefaults;
import dev.waveclient.hud.TextHudModule;
import dev.waveclient.module.Category;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.setting.Setting;

/**
 * Toggle sprint and sneak: press the key once and it stays held until pressed again, with a
 * status line such as "[Sprinting (Toggled)]".
 *
 * <p>Only the movement input the game would build if the key were held is changed (see
 * KeyboardInputMixin), so every vanilla rule about when you can sprint or sneak still applies and
 * the server sees exactly a held key. No option is written: turning the module off restores
 * normal keys at once. Sneak emulation pauses while flying, swimming or riding, where the sneak
 * key means descend or dismount. With sprint on Ctrl, Ctrl+Q (drop stack) and Ctrl+middle-click
 * (pick block with data) don't toggle sprint.
 */
public final class ToggleSprintModule extends TextHudModule {
	public final EnumSetting<ToggleKey.Mode> sprintMode = add(new EnumSetting<>("sprintMode", "Sprint", ToggleKey.Mode.TOGGLE)
			.describe("Toggle: press the sprint key once to keep sprinting. Always: as if the key were always held."));
	public final BooleanSetting toggleSneak = add(new BooleanSetting("toggleSneak", "Toggle sneak", false)
			.describe("Press the sneak key once to keep sneaking."));
	public final BooleanSetting pauseSneakWhileFlying = add(new BooleanSetting("pauseSneakWhileFlying", "Pause sneak while flying", true)
			.describe("The sneak key flies down instead, so a toggled sneak would keep descending.")
			.visibleWhen(toggleSneak::get));
	public final BooleanSetting pauseSneakInWater = add(new BooleanSetting("pauseSneakInWater", "Pause sneak in water", true)
			.describe("The sneak key swims down instead.")
			.visibleWhen(toggleSneak::get));
	public final BooleanSetting pauseSneakWhileRiding = add(new BooleanSetting("pauseSneakWhileRiding", "Pause sneak while riding", true)
			.describe("The sneak key dismounts instead.")
			.visibleWhen(toggleSneak::get));
	public final BooleanSetting keepSprintAfterDeath = add(new BooleanSetting("keepSprintAfterDeath", "Keep sprint after death", true)
			.describe("A toggled sprint stays on after you respawn."));
	public final BooleanSetting showStatus = add(new BooleanSetting("showStatus", "Show status", true)
			.describe("Show a line such as [Sprinting (Toggled)] on the HUD."));

	private static final String[] EDITOR_SAMPLE = MovementStatus.SPRINT_TOGGLED.lines();
	private static final String[] HIDDEN = new String[0];

	private final ToggleKey sprint = new ToggleKey();
	private final ToggleKey sneak = new ToggleKey();
	/** Computed once per tick, so the input mixin only reads a field. */
	private boolean sneakSuppressed;
	private MovementStatus shownStatus;

	public ToggleSprintModule() {
		super("toggle_sprint", "Toggle Sprint", "Press sprint or sneak once to keep it held.", Category.MOVEMENT, HudDefaults.TOGGLE_SPRINT);
	}

	private ToggleKey.Mode sneakMode() {
		return toggleSneak.get() ? ToggleKey.Mode.TOGGLE : ToggleKey.Mode.HOLD;
	}

	/** A real key press with no screen open (from KeyboardHandlerMixin). Repeats are not passed in. */
	public void onKeyPressed(KeyEvent event) {
		if (!isActive()) {
			return;
		}

		Options options = Minecraft.getInstance().options;

		if (options.keySprint.matches(event)) {
			sprint.onPress(sprintMode.get(), options.toggleSprint().get(), false);
		}

		if (options.keyShift.matches(event)) {
			sneak.onPress(sneakMode(), options.toggleCrouch().get(), sneakSuppressed);
		}

		if (options.keyDrop.matches(event) && sprintHeldAsControl(options)) {
			sprint.undoPendingFlip();
		}
	}

	/** A real mouse button press with no screen open (from MouseHandlerMixin). */
	public void onMousePressed(MouseButtonInfo button) {
		if (!isActive()) {
			return;
		}

		Options options = Minecraft.getInstance().options;
		MouseButtonEvent event = new MouseButtonEvent(0, 0, button);

		if (options.keySprint.matchesMouse(event)) {
			sprint.onPress(sprintMode.get(), options.toggleSprint().get(), false);
		}

		if (options.keyShift.matchesMouse(event)) {
			sneak.onPress(sneakMode(), options.toggleCrouch().get(), sneakSuppressed);
		}

		if (options.keyPickItem.matchesMouse(event) && sprintHeldAsControl(options)) {
			sprint.undoPendingFlip();
		}
	}

	/** Sprint is on Ctrl and held, so vanilla reads it as the Ctrl of a drop or pick chord. */
	private static boolean sprintHeldAsControl(Options options) {
		InputConstants.Key key = KeyBindingHelper.getBoundKeyOf(options.keySprint);
		return options.keySprint.isDown() && key.getType() == InputConstants.Type.KEYSYM
				&& (key.getValue() == InputConstants.KEY_LCONTROL || key.getValue() == InputConstants.KEY_RCONTROL);
	}

	/** The sprint input for this tick; {@code physical} is what the game read from the key. */
	public boolean effectiveSprint(boolean physical) {
		return sprint.effective(sprintMode.get(), physical, Minecraft.getInstance().options.toggleSprint().get(), false);
	}

	/** The sneak input for this tick. */
	public boolean effectiveShift(boolean physical) {
		return sneak.effective(sneakMode(), physical, Minecraft.getInstance().options.toggleCrouch().get(), sneakSuppressed);
	}

	@Override
	protected void onTick() {
		LocalPlayer player = Minecraft.getInstance().player;

		if (!Minecraft.getInstance().options.keySprint.isDown()) {
			sprint.released();
		}

		if (player == null) {
			sneak.clear();
			sneakSuppressed = false;
		} else {
			sneakSuppressed = (pauseSneakWhileFlying.get() && player.getAbilities().flying)
					|| (pauseSneakInWater.get() && player.isInWater())
					|| (pauseSneakWhileRiding.get() && player.isPassenger());

			if (player.isDeadOrDying()) {
				sneak.clear();

				if (!keepSprintAfterDeath.get()) {
					sprint.clear();
				}
			}
		}

		super.onTick();
	}

	@Override
	protected void updateText(boolean force) {
		MovementStatus status = status();

		if (!force && status == shownStatus) {
			return;
		}

		shownStatus = status;

		if (!showStatus.get()) {
			setLines(HIDDEN);
		} else if (status == MovementStatus.NONE && editorOpen()) {
			// Something to place in the HUD editor.
			setLines(EDITOR_SAMPLE);
		} else {
			setLines(status.lines());
		}
	}

	private MovementStatus status() {
		Minecraft minecraft = Minecraft.getInstance();
		LocalPlayer player = minecraft.player;

		if (player == null) {
			return MovementStatus.NONE;
		}

		Options options = minecraft.options;
		boolean vanillaSneak = options.toggleCrouch().get();
		boolean vanillaSprint = options.toggleSprint().get();
		// With vanilla's toggle on, the key mapping's down state is the toggle, not a held key.
		boolean sneakToggled = vanillaSneak
				? options.keyShift.isDown() && player.isCrouching()
				: sneak.engaged(sneakMode()) && !sneakSuppressed;
		boolean sprintEngaged = vanillaSprint ? options.keySprint.isDown() : sprint.engaged(sprintMode.get());
		boolean sprintKeyHeld = !vanillaSprint && options.keySprint.isDown();
		return MovementStatus.resolve(player.getAbilities().flying, player.isPassenger(), player.input.keyPresses.shift(), sneakToggled,
				player.isCrouching(), sprintEngaged, sprintKeyHeld, player.isSprinting());
	}

	@Override
	protected void onSettingChanged(Setting<?> setting) {
		// A toggle left on from the old mode would otherwise come back without a key press.
		if (setting == sprintMode) {
			sprint.clear();
		} else if (setting == toggleSneak) {
			sneak.clear();
		}

		super.onSettingChanged(setting);
	}

	@Override
	protected void onDisable() {
		sprint.clear();
		sneak.clear();
		sneakSuppressed = false;
		super.onDisable();
	}
}
