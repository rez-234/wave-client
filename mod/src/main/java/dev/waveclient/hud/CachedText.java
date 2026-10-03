package dev.waveclient.hud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.locale.Language;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.util.FormattedCharSequence;

/**
 * One line of HUD text, converted to the form the renderer draws and measured only when it
 * changes. Drawing a plain String would redo that conversion, and allocate, every frame.
 */
public final class CachedText {
	private String text = "";
	private FormattedCharSequence sequence = FormattedCharSequence.EMPTY;
	private int width;

	/** @return whether the text changed */
	public boolean set(String value) {
		if (value.equals(text)) {
			return false;
		}

		text = value;
		remeasure();
		return true;
	}

	/** Converts and measures again, for a font, language or resource pack change. */
	public void remeasure() {
		if (text.isEmpty()) {
			sequence = FormattedCharSequence.EMPTY;
			width = 0;
			return;
		}

		sequence = Language.getInstance().getVisualOrder(FormattedText.of(text));
		width = Minecraft.getInstance().font.width(sequence);
	}

	public String text() {
		return text;
	}

	public int width() {
		return width;
	}

	public boolean isEmpty() {
		return text.isEmpty();
	}

	public void draw(GuiGraphics graphics, Font font, int x, int y, int color, boolean shadow) {
		if (!text.isEmpty()) {
			graphics.drawString(font, sequence, x, y, color, shadow);
		}
	}
}
