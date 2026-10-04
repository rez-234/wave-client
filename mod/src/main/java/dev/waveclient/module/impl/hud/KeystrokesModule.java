package dev.waveclient.module.impl.hud;

import java.util.List;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.Window;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.util.Util;
import org.joml.Matrix3x2fStack;
import org.lwjgl.glfw.GLFW;

import dev.waveclient.WaveClient;
import dev.waveclient.hud.HudDefaults;
import dev.waveclient.hud.CachedText;
import dev.waveclient.hud.HudModule;
import dev.waveclient.input.ClickInput;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.ColorSetting;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.setting.Setting;
import dev.waveclient.setting.SliderSetting;
import dev.waveclient.util.ColorMath;

/**
 * Movement keys, mouse buttons and jump, lit up while pressed.
 *
 * <p>Keys are read from the keyboard and mouse each frame, so a quick tap always shows; with
 * "Show toggled keys as held" a toggled attack or use (Accessibility settings) lights up too.
 * Labels follow your controls, with short names for long ones such as the arrow keys, and are
 * rebuilt only when a binding changes.
 */
// Settings register change listeners that capture 'this', but they only run on later edits.
@SuppressWarnings("this-escape")
public final class KeystrokesModule extends HudModule {
	private static final long FADE_NANOS = 80_000_000L;
	private static final int REMEASURE_TICKS = 20;
	private static final int KEYS = KeystrokesLayout.Key.values().length;
	private static final int GLYPH_HEIGHT = 7;

	public final BooleanSetting showMouse = add(new BooleanSetting("showMouse", "Mouse buttons", true));
	public final BooleanSetting showCps = add(new BooleanSetting("showCps", "Clicks per second", true)
			.describe("Show the CPS under each mouse button.")
			.visibleWhen(showMouse::get));
	public final EnumSetting<ClickInput.Source> cpsSource = add(new EnumSetting<>("cpsSource", "Count", ClickInput.Source.MOUSE_BUTTONS)
			.visibleWhen(() -> showMouse.get() && showCps.get()));
	public final BooleanSetting showSpace = add(new BooleanSetting("showSpace", "Jump bar", true));
	public final BooleanSetting showToggleState = add(new BooleanSetting("showToggleState", "Show toggled keys as held", false)
			.describe("Light up keys the game treats as held, such as a toggled attack or use from the Accessibility settings, instead of the keys your fingers are on."));
	public final SliderSetting keySize = add(new SliderSetting("keySize", "Key size", 20, 14, 32, 1));
	public final SliderSetting gap = add(new SliderSetting("gap", "Gap", 2, 0, 4, 1));
	public final BooleanSetting animate = add(new BooleanSetting("animate", "Fade presses", true));
	public final ColorSetting backgroundColor = add(new ColorSetting("backgroundColor", "Key color", 0x80101114));
	public final ColorSetting pressedColor = add(new ColorSetting("pressedColor", "Pressed key color", 0xD0FFFFFF));
	public final ColorSetting textColor = add(new ColorSetting("textColor", "Text color", 0xFFFFFFFF));
	public final ColorSetting pressedTextColor = add(new ColorSetting("pressedTextColor", "Pressed text color", 0xFF101114));
	public final BooleanSetting textShadow = add(new BooleanSetting("textShadow", "Text shadow", true)
			.describe("Only on keys that aren't pressed."));

	private KeystrokesLayout layout;
	private final InputConstants.Key[] boundKeys = new InputConstants.Key[KEYS];
	private final CachedText[] labels = new CachedText[KEYS];
	private final float[] labelScale = new float[KEYS];
	/** Labels still wider than their key at the smallest scale, drawn clipped to it. */
	private final boolean[] labelClipped = new boolean[KEYS];
	private final float[] pressed = new float[KEYS];
	private final CachedText leftCps = new CachedText();
	private final CachedText rightCps = new CachedText();
	private final StringBuilder text = new StringBuilder(8);
	private int shownLeftCps = -1;
	private int shownRightCps = -1;
	private boolean stale = true;
	private int ticksSinceMeasure;
	private long lastFrameNanos;

	public KeystrokesModule() {
		super("keystrokes", "Keystrokes", "Shows your movement keys and mouse buttons as you press them.", HudDefaults.KEYSTROKES);

		for (int i = 0; i < KEYS; i++) {
			labels[i] = new CachedText();
		}

		relayout();
	}

	private void relayout() {
		layout = KeystrokesLayout.of(showMouse.get(), showSpace.get(), keySize.getInt(), gap.getInt());
		stale = true;
	}

	@Override
	protected void onSettingChanged(Setting<?> setting) {
		if (setting == showMouse || setting == showSpace || setting == keySize || setting == gap) {
			relayout();
		} else {
			stale = true;
		}
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

	/** Rebuilds the labels whose binding changed (all of them when forced), and the CPS text. */
	private void refresh(boolean force) {
		if (force) {
			ticksSinceMeasure = 0;
		}

		Options options = Minecraft.getInstance().options;
		List<KeystrokesLayout.Cell> cells = layout.cells();

		for (int c = 0; c < cells.size(); c++) {
			KeystrokesLayout.Cell cell = cells.get(c);
			int i = cell.key().ordinal();
			InputConstants.Key bound = KeyBindingHelper.getBoundKeyOf(mapping(options, cell.key()));

			if (bound != boundKeys[i] || force) {
				boundKeys[i] = bound;

				if (!labels[i].set(label(cell.key(), bound))) {
					labels[i].remeasure();
				}

				int room = cell.width() - 4;
				labelScale[i] = labels[i].width() > room ? Math.max(0.5F, (float) room / labels[i].width()) : 1.0F;
				labelClipped[i] = labels[i].width() * labelScale[i] > cell.width();
			}
		}

		if (showMouse.get() && showCps.get()) {
			ClickInput clicks = WaveClient.get().clickInput();
			int left = clicks.left(cpsSource.get());
			int right = clicks.right(cpsSource.get());

			if (left != shownLeftCps || force) {
				shownLeftCps = left;
				setCps(leftCps, left);
			}

			if (right != shownRightCps || force) {
				shownRightCps = right;
				setCps(rightCps, right);
			}
		}
	}

	private void setCps(CachedText target, int cps) {
		text.setLength(0);
		text.append(cps).append(" CPS");

		if (!target.set(text.toString())) {
			target.remeasure();
		}
	}

	private static KeyMapping mapping(Options options, KeystrokesLayout.Key key) {
		return switch (key) {
			case FORWARD -> options.keyUp;
			case LEFT -> options.keyLeft;
			case BACK -> options.keyDown;
			case RIGHT -> options.keyRight;
			case ATTACK -> options.keyAttack;
			case USE -> options.keyUse;
			case JUMP -> options.keyJump;
		};
	}

	private static String label(KeystrokesLayout.Key key, InputConstants.Key bound) {
		if (key == KeystrokesLayout.Key.JUMP) {
			// Drawn as a bar.
			return "";
		}

		if (bound.getType() == InputConstants.Type.MOUSE) {
			return switch (bound.getValue()) {
				case 0 -> "LMB";
				case 1 -> "RMB";
				case 2 -> "MMB";
				default -> "M" + (bound.getValue() + 1);
			};
		}

		if (bound.getType() == InputConstants.Type.KEYSYM) {
			if (bound.getValue() == InputConstants.UNKNOWN.getValue()) {
				return "-";
			}

			String shortName = KeyLabels.shortName(bound.getValue());

			if (shortName != null) {
				return shortName;
			}
		}

		return bound.getDisplayName().getString();
	}

	@Override
	public int width() {
		return layout.width();
	}

	@Override
	public int height() {
		return layout.height();
	}

	@Override
	public void render(GuiGraphics graphics) {
		Minecraft minecraft = Minecraft.getInstance();
		Options options = minecraft.options;
		Window window = minecraft.getWindow();
		Font font = minecraft.font;
		boolean inGame = minecraft.screen == null;
		boolean cps = showMouse.get() && showCps.get();

		long now = Util.getNanos();
		float step = animate.get() ? Math.min(1.0F, Math.max(0.0F, (now - lastFrameNanos) / (float) FADE_NANOS)) : 1.0F;
		lastFrameNanos = now;

		List<KeystrokesLayout.Cell> cells = layout.cells();

		for (int c = 0; c < cells.size(); c++) {
			KeystrokesLayout.Cell cell = cells.get(c);
			int i = cell.key().ordinal();
			boolean down = inGame && isDown(window, mapping(options, cell.key()), boundKeys[i]);
			float target = down ? 1.0F : 0.0F;
			float amount = pressed[i] < target ? Math.min(target, pressed[i] + step) : Math.max(target, pressed[i] - step);
			pressed[i] = amount;

			int fill = ColorMath.lerp(backgroundColor.get(), pressedColor.get(), amount);

			if ((fill >>> 24) != 0) {
				graphics.fill(cell.x(), cell.y(), cell.x() + cell.width(), cell.y() + cell.height(), fill);
			}

			int color = ColorMath.lerp(textColor.get(), pressedTextColor.get(), amount);
			boolean shadow = textShadow.get() && amount < 0.5F;

			if (cell.key() == KeystrokesLayout.Key.JUMP) {
				int bar = Math.min(cell.width() - 8, 3 * keySize.getInt() / 2);
				int barX = cell.x() + (cell.width() - bar) / 2;
				int barY = cell.y() + cell.height() / 2;
				graphics.fill(barX, barY, barX + bar, barY + 1, color);
				continue;
			}

			boolean mouseKey = cell.key() == KeystrokesLayout.Key.ATTACK || cell.key() == KeystrokesLayout.Key.USE;
			CachedText cpsText = !cps || !mouseKey ? null : cell.key() == KeystrokesLayout.Key.ATTACK ? leftCps : rightCps;
			// Label and a half-size CPS line under it, centered together.
			int block = cpsText != null ? GLYPH_HEIGHT + 2 + 4 : GLYPH_HEIGHT;
			int top = cell.y() + (cell.height() - block) / 2;
			if (labelClipped[i]) {
				// Rare (an unusual key name), so the scissor's allocation doesn't matter.
				graphics.enableScissor(cell.x(), cell.y(), cell.x() + cell.width(), cell.y() + cell.height());
				drawCentered(graphics, font, labels[i], labelScale[i], cell.x() + cell.width() / 2.0F, top, color, shadow);
				graphics.disableScissor();
			} else {
				drawCentered(graphics, font, labels[i], labelScale[i], cell.x() + cell.width() / 2.0F, top, color, shadow);
			}

			if (cpsText != null) {
				drawCentered(graphics, font, cpsText, 0.5F, cell.x() + cell.width() / 2.0F, top + GLYPH_HEIGHT + 2, color, shadow);
			}
		}
	}

	private static void drawCentered(GuiGraphics graphics, Font font, CachedText text, float scale, float centerX, int top, int color, boolean shadow) {
		if (text.isEmpty()) {
			return;
		}

		if (scale == 1.0F) {
			// Whole pixels keep the text crisp.
			text.draw(graphics, font, Math.round(centerX - text.width() / 2.0F), top, color, shadow);
			return;
		}

		Matrix3x2fStack pose = graphics.pose();
		pose.pushMatrix();
		pose.translate(centerX, top + (1 - scale) * GLYPH_HEIGHT / 2);
		pose.scale(scale, scale);
		text.draw(graphics, font, -text.width() / 2, 0, color, shadow);
		pose.popMatrix();
	}

	/**
	 * Whether the key is down: the physical key or button, or with "Show toggled keys as held"
	 * the game's own state. Scancode bindings can't be polled, so they use the game's state.
	 */
	private boolean isDown(Window window, KeyMapping mapping, InputConstants.Key bound) {
		if (bound == null || showToggleState.get()) {
			return mapping.isDown();
		}

		int value = bound.getValue();

		return switch (bound.getType()) {
			case KEYSYM -> value != InputConstants.UNKNOWN.getValue() && InputConstants.isKeyDown(window, value);
			case MOUSE -> GLFW.glfwGetMouseButton(window.handle(), value) == GLFW.GLFW_PRESS;
			case SCANCODE -> mapping.isDown();
		};
	}
}
