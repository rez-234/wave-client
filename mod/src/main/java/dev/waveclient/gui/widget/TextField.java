package dev.waveclient.gui.widget;

import java.util.Objects;
import java.util.function.Consumer;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.Minecraft;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.network.chat.Style;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.util.Util;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.render.Text;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.util.ColorMath;

/**
 * A single-line text input drawn in the menu's style, backed by {@link TextFieldModel}.
 * Supports selection with the mouse and Shift+arrows, Ctrl word jumps, and the usual
 * select-all, copy, cut and paste shortcuts. Escape clears a non-empty field; on an empty one
 * it is left to the screen.
 */
public final class TextField extends Widget {
	public static final int HEIGHT = 16;
	private static final int PADDING = 6;
	private static final long BLINK_MS = 530;
	private static final int GLFW_KEY_BACKSPACE = 259;
	private static final int GLFW_KEY_DELETE = 261;
	private static final int GLFW_KEY_HOME = 268;
	private static final int GLFW_KEY_END = 269;

	private final TextFieldModel model;
	private final Text placeholder;
	private final Text text = new Text(UiFont.BODY);
	private Consumer<String> onChange = value -> { };
	private Runnable onEnter = () -> { };
	private Painter painter;
	private double scrollX;
	private long blinkStart;
	private boolean selecting;

	public TextField(TextFieldModel model, String placeholder) {
		this.model = Objects.requireNonNull(model, "model");
		this.placeholder = new Text(UiFont.BODY, placeholder);
		this.height = HEIGHT;
	}

	/** Called after every edit made by the player (not by {@link #setValue}). */
	public TextField onChange(Consumer<String> listener) {
		this.onChange = Objects.requireNonNull(listener, "listener");
		return this;
	}

	public TextField onEnter(Runnable listener) {
		this.onEnter = Objects.requireNonNull(listener, "listener");
		return this;
	}

	public String value() {
		return model.value();
	}

	/** Replaces the text without calling the change listener. */
	public void setValue(String value) {
		model.setValue(value);
	}

	public TextFieldModel model() {
		return model;
	}

	@Override
	public void render(Painter painter, boolean hovered, double mouseX, double mouseY, float seconds) {
		this.painter = painter;
		animateHover(hovered, seconds);
		boolean focused = isFocused();
		int border = focused ? Theme.ACCENT : Theme.mix(Theme.BORDER, Theme.TEXT_MUTED, hover * 0.35f);
		painter.roundRect(x, y, width, height, Theme.RADIUS_SMALL, Theme.SURFACE_RAISED, border);

		double innerLeft = x + PADDING;
		int innerWidth = Math.max(1, width - 2 * PADDING);
		double centerY = y + height / 2.0;
		String value = model.value();
		text.set(value);

		if (value.isEmpty()) {
			scrollX = 0;
			placeholder.drawFitted(painter, innerLeft, centerY, innerWidth, Theme.withAlpha(Theme.TEXT_MUTED, focused ? 0x90 : 0xFF));
		}

		double cursorX = prefixWidth(model.cursor());
		double textWidth = text.width(painter);

		if (cursorX - scrollX > innerWidth) {
			scrollX = cursorX - innerWidth;
		} else if (cursorX < scrollX) {
			scrollX = cursorX;
		}

		scrollX = Math.max(0, Math.min(scrollX, Math.max(0, textWidth - innerWidth + 1)));

		painter.pushClip((int) Math.floor(innerLeft) - 1, (int) Math.floor(y), innerWidth + 2, height);

		if (focused && model.hasSelection()) {
			double from = prefixWidth(model.selectionStart()) - scrollX;
			double to = prefixWidth(model.selectionEnd()) - scrollX;
			painter.rect(innerLeft + from, centerY - 5, to - from, 10, ColorMath.withAlpha(Theme.ACCENT, 0x70));
		}

		if (!value.isEmpty()) {
			text.drawCentered(painter, innerLeft - scrollX, centerY, Theme.TEXT);
		}

		if (focused && ((Util.getMillis() - blinkStart) / BLINK_MS) % 2 == 0) {
			double caretWidth = painter.hairline() * Math.max(1, painter.scale() / 2);
			painter.rect(innerLeft + cursorX - scrollX, centerY - 5, caretWidth, 10, Theme.TEXT);
		}

		painter.popClip();
	}

	private double prefixWidth(int index) {
		if (painter == null || index <= 0) {
			return 0;
		}

		String value = model.value();
		Style style = painter.style(text.uiFont());
		return painter.width(FormattedCharSequence.forward(value.substring(0, Math.min(index, value.length())), style));
	}

	private int indexAt(double mouseX) {
		if (painter == null) {
			return model.value().length();
		}

		double local = mouseX - (x + PADDING) + scrollX;
		String value = model.value();
		Style style = painter.style(text.uiFont());

		// The splitter returns how many characters fit; round to the nearer character edge.
		int index = painter.font().getSplitter().plainIndexAtWidth(value, (int) Math.max(0, Math.floor(local)), style);

		if (index < value.length()) {
			double before = prefixWidth(index);
			double after = prefixWidth(value.offsetByCodePoints(index, 1));

			if (local - before > (after - before) / 2) {
				index = value.offsetByCodePoints(index, 1);
			}
		}

		return index;
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
		if (button != 0) {
			return false;
		}

		int index = indexAt(mouseX);

		if (doubleClick) {
			model.selectWordAt(index);
		} else {
			model.moveTo(index, false);
			selecting = true;
		}

		resetBlink();
		return true;
	}

	@Override
	public void mouseDragged(double mouseX, double mouseY, int button) {
		if (selecting) {
			model.moveTo(indexAt(mouseX), true);
		}
	}

	@Override
	public void mouseReleased(double mouseX, double mouseY, int button) {
		selecting = false;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		resetBlink();
		boolean word = event.hasControlDownWithQuirk();
		boolean shift = event.hasShiftDown();

		if (event.isSelectAll()) {
			model.selectAll();
		} else if (event.isCopy()) {
			copySelection();
		} else if (event.isCut()) {
			if (model.hasSelection()) {
				copySelection();
				changed(model.deleteBackward(false));
			}
		} else if (event.isPaste()) {
			changed(model.insert(Minecraft.getInstance().keyboardHandler.getClipboard()));
		} else if (event.key() == GLFW_KEY_BACKSPACE) {
			changed(model.deleteBackward(word));
		} else if (event.key() == GLFW_KEY_DELETE) {
			changed(model.deleteForward(word));
		} else if (event.isLeft()) {
			model.move(-1, word, shift);
		} else if (event.isRight()) {
			model.move(1, word, shift);
		} else if (event.key() == GLFW_KEY_HOME) {
			model.moveTo(0, shift);
		} else if (event.key() == GLFW_KEY_END) {
			model.moveTo(model.value().length(), shift);
		} else if (event.isConfirmation()) {
			onEnter.run();
		} else if (event.isEscape()) {
			if (model.value().isEmpty()) {
				return false;
			}

			model.setValue("");
			changed(true);
		} else {
			// Swallow other keys while typing, so letters never reach anything else.
			return !event.isCycleFocus();
		}

		return true;
	}

	@Override
	public boolean charTyped(CharacterEvent event) {
		if (!event.isAllowedChatCharacter()) {
			return false;
		}

		resetBlink();
		changed(model.insert(event.codepointAsString()));
		return true;
	}

	private void copySelection() {
		if (model.hasSelection()) {
			Minecraft.getInstance().keyboardHandler.setClipboard(model.selectedText());
		}
	}

	private void changed(boolean changed) {
		if (changed) {
			onChange.accept(model.value());
		}
	}

	private void resetBlink() {
		blinkStart = Util.getMillis();
	}

	@Override
	protected void onFocusChanged(boolean focused) {
		resetBlink();
		selecting = false;
	}

	@Override
	public boolean isFocusable() {
		return true;
	}

	@Override
	public boolean capturesKeyboard() {
		return isFocused();
	}

	@Override
	public CursorType cursor(double mouseX, double mouseY) {
		return CursorTypes.IBEAM;
	}
}
