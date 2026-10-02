package dev.waveclient.gui.widget;

import java.util.function.Function;

import com.mojang.blaze3d.platform.InputConstants;
import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.input.KeyEvent;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.render.Text;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.input.Keybind;
import dev.waveclient.setting.KeybindSetting;

/**
 * Shows a binding; click it, then press a key (or the middle or a side mouse button) to change
 * it. Escape or a left/right click cancels and Backspace clears; see {@link KeyCapture}.
 * Bindings shared with another Wave Client key are outlined in the danger color.
 */
public final class KeybindWidget extends Widget {
	public static final int HEIGHT = 16;
	private static final String LISTENING = "Press a key…";

	private final KeybindSetting setting;
	private final Function<KeybindSetting, String> conflicts;
	private final Text label = new Text(UiFont.BODY);
	private Keybind shown;
	private boolean listening;
	private String conflict;

	/**
	 * @param conflicts returns a description of other bindings using the same key, or
	 *                  {@code null} if there are none
	 */
	public KeybindWidget(KeybindSetting setting, Function<KeybindSetting, String> conflicts) {
		this.setting = setting;
		this.conflicts = conflicts;
		this.height = HEIGHT;
	}

	public boolean isListening() {
		return listening;
	}

	@Override
	public void render(Painter painter, boolean hovered, double mouseX, double mouseY, float seconds) {
		animateHover(hovered, seconds);

		if (listening) {
			label.set(LISTENING);
		} else if (!setting.get().equals(shown) || label.value().equals(LISTENING)) {
			shown = setting.get();
			label.set(displayName(shown));
		}

		// Recomputed every frame: another binding may change while this one is on screen.
		conflict = listening || !setting.get().isBound() ? null : conflicts.apply(setting);
		int border = listening || isFocused() ? Theme.ACCENT
				: conflict != null ? Theme.DANGER
				: Theme.mix(Theme.BORDER, Theme.TEXT_MUTED, hover * 0.35f);
		painter.roundRect(x, y, width, height, Theme.RADIUS_SMALL, Theme.mix(Theme.SURFACE_RAISED, Theme.SURFACE_HOVER, hover), border);

		int color = listening ? Theme.ACCENT : setting.get().isBound() ? Theme.TEXT : Theme.TEXT_MUTED;
		int maxWidth = Math.max(0, width - 12);
		float textWidth = label.fittedWidth(painter, maxWidth);
		label.drawFitted(painter, x + (width - textWidth) / 2, y + height / 2.0, maxWidth, color);
	}

	/** Minecraft's own (localized) name for the key or button. */
	public static String displayName(Keybind keybind) {
		return switch (keybind.type()) {
			case NONE -> "None";
			case KEY -> InputConstants.Type.KEYSYM.getOrCreate(keybind.code()).getDisplayName().getString();
			case MOUSE -> InputConstants.Type.MOUSE.getOrCreate(keybind.code()).getDisplayName().getString();
		};
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
		if (listening) {
			return captureMouse(button);
		}

		if (button != 0) {
			return false;
		}

		listening = true;
		return true;
	}

	/**
	 * While listening, the screen sends every mouse press here first, wherever it lands.
	 *
	 * @return true (the press is always used up while listening)
	 */
	public boolean captureMouse(int button) {
		apply(KeyCapture.onMouse(button));
		return true;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		if (listening) {
			apply(KeyCapture.onKey(event.key()));
			return true;
		}

		if (event.isSelection()) {
			listening = true;
			return true;
		}

		if (event.key() == KeyCapture.GLFW_KEY_BACKSPACE || event.key() == KeyCapture.GLFW_KEY_DELETE) {
			setting.set(Keybind.NONE);
			return true;
		}

		return false;
	}

	private void apply(KeyCapture.Result result) {
		listening = false;

		if (result.kind() != KeyCapture.Kind.CANCEL) {
			setting.set(result.binding());
		}
	}

	@Override
	protected void onFocusChanged(boolean focused) {
		if (!focused) {
			listening = false;
		}
	}

	@Override
	public boolean isFocusable() {
		return true;
	}

	@Override
	public boolean capturesKeyboard() {
		return listening;
	}

	@Override
	public CursorType cursor(double mouseX, double mouseY) {
		return CursorTypes.POINTING_HAND;
	}

	@Override
	public String tooltip(double mouseX, double mouseY) {
		if (listening) {
			return "Escape cancels, Backspace clears.";
		}

		return conflict != null ? "Also used by " + conflict + "." : null;
	}
}
