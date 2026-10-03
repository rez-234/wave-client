package dev.waveclient.hud;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.locale.Language;
import net.minecraft.network.chat.CommonComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;

/**
 * Styled text (such as a server's scoreboard line), converted for drawing and measured only when
 * it changes. Changes are found with {@link Component#equals}, which compares the whole text and
 * its styles.
 */
public final class CachedComponent {
	private Component source = CommonComponents.EMPTY;
	private FormattedCharSequence sequence = FormattedCharSequence.EMPTY;
	private int width;

	/** @return whether the text changed */
	public boolean set(Component value) {
		if (value.equals(source)) {
			return false;
		}

		source = value;
		remeasure();
		return true;
	}

	/** Converts and measures again, for a font, language or resource pack change. */
	public void remeasure() {
		sequence = Language.getInstance().getVisualOrder(source);
		width = Minecraft.getInstance().font.width(sequence);
	}

	public int width() {
		return width;
	}

	/** @param color used where the text has no color of its own */
	public void draw(GuiGraphics graphics, Font font, int x, int y, int color, boolean shadow) {
		if (width > 0) {
			graphics.drawString(font, sequence, x, y, color, shadow);
		}
	}
}
