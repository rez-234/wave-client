package dev.waveclient.module.impl.movement;

import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.client.player.LocalPlayer;

import dev.waveclient.hud.Anchor;
import dev.waveclient.hud.TextHudModule;
import dev.waveclient.module.Category;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.EnumSetting;

/**
 * Toggle sprint and sneak: press the key once and it stays held until pressed again, with a
 * status line such as "[Sprinting (Toggled)]".
 *
 * <p>Only the movement input the game would build if the key were held is changed (see
 * KeyboardInputMixin), so every vanilla rule about when you can sprint or sneak still applies and
 * the server sees exactly a held key. No option is written: turning the module off restores
 * normal keys at once. Sneak emulation pauses while flying, swimming or riding, where the sneak
 * key means descend or dismount.
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
		super("toggle_sprint", "Toggle Sprint", "Press sprint or sneak once to keep it held.", Category.MOVEMENT, Anchor.TOP_LEFT, 4, 96);
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
		boolean sneakToggled = sneak.engaged(sneakMode()) && !sneakSuppressed && !options.toggleCrouch().get();
		boolean sprintEngaged = sprint.engaged(sprintMode.get()) && !options.toggleSprint().get();
		return MovementStatus.resolve(player.getAbilities().flying, player.isPassenger(), player.input.keyPresses.shift(), sneakToggled,
				player.isCrouching(), sprintEngaged, options.keySprint.isDown(), player.isSprinting());
	}

	@Override
	protected void onDisable() {
		sprint.clear();
		sneak.clear();
		sneakSuppressed = false;
		super.onDisable();
	}
}
