package dev.waveclient.input;

import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;
import net.minecraft.util.Util;

import dev.waveclient.setting.EnumSetting;
import dev.waveclient.util.ClickCounter;

/**
 * Clicks per second for the CPS and keystrokes displays.
 *
 * <p>A click is counted where the game acts on a press: the {@code KeyMapping.click} calls in
 * MouseHandler and KeyboardHandler, which run only with no screen open. Clicks in menus, held
 * buttons, auto-repeat and the game's own use-item repeat don't count.
 */
public final class ClickInput {
	public enum Source implements EnumSetting.Labeled {
		MOUSE_BUTTONS("Mouse buttons"),
		ATTACK_USE_KEYS("Attack and use keys");

		private final String label;

		Source(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	private static final int LEFT_BUTTON = 0;
	private static final int RIGHT_BUTTON = 1;

	private final ClickCounter leftMouse = new ClickCounter();
	private final ClickCounter rightMouse = new ClickCounter();
	private final ClickCounter attack = new ClickCounter();
	private final ClickCounter use = new ClickCounter();

	/** A press the game acted on. Keyboard callers pass presses only, never auto-repeats. */
	public void onClick(InputConstants.Key key) {
		long now = Util.getMillis();

		if (key.getType() == InputConstants.Type.MOUSE) {
			if (key.getValue() == LEFT_BUTTON) {
				leftMouse.click(now);
			} else if (key.getValue() == RIGHT_BUTTON) {
				rightMouse.click(now);
			}
		}

		Options options = Minecraft.getInstance().options;

		if (key.equals(KeyBindingHelper.getBoundKeyOf(options.keyAttack))) {
			attack.click(now);
		}

		if (key.equals(KeyBindingHelper.getBoundKeyOf(options.keyUse))) {
			use.click(now);
		}
	}

	/** Left clicks (or attack presses) in the last second. */
	public int left(Source source) {
		return (source == Source.MOUSE_BUTTONS ? leftMouse : attack).count(Util.getMillis());
	}

	/** Right clicks (or use presses) in the last second. */
	public int right(Source source) {
		return (source == Source.MOUSE_BUTTONS ? rightMouse : use).count(Util.getMillis());
	}
}
