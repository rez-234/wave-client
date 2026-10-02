package dev.waveclient.gui.render;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

import net.minecraft.locale.Language;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.network.chat.Style;
import net.minecraft.util.FormattedCharSequence;

import dev.waveclient.gui.theme.UiFont;

/**
 * A piece of menu text with its styled form and measurements cached, rebuilt only when the
 * string, the font or the GUI scale changes. Optionally cut to a width with an ellipsis, or
 * wrapped into lines.
 */
public final class Text {
	private static final String ELLIPSIS = "…";

	private final UiFont font;
	private String value;
	private int generation = Integer.MIN_VALUE;
	private FormattedCharSequence styled;
	private float width;

	private int fitWidth = -1;
	private FormattedCharSequence fitted;
	private float fittedWidth;

	private int wrapWidth = -1;
	private List<FormattedCharSequence> lines = List.of();

	public Text(UiFont font, String value) {
		this.font = Objects.requireNonNull(font, "font");
		this.value = Objects.requireNonNull(value, "value");
	}

	public Text(UiFont font) {
		this(font, "");
	}

	public UiFont uiFont() {
		return font;
	}

	public String value() {
		return value;
	}

	/** Changes the text; cheap when it's the same string. */
	public Text set(String newValue) {
		if (!value.equals(newValue)) {
			value = Objects.requireNonNull(newValue, "newValue");
			generation = Integer.MIN_VALUE;
		}

		return this;
	}

	public boolean isEmpty() {
		return value.isEmpty();
	}

	/** Width of the whole text in GUI pixels. */
	public float width(Painter painter) {
		prepare(painter);
		return width;
	}

	/** Draws the whole text with its top at ({@code x}, {@code y}). */
	public void draw(Painter painter, double x, double y, int color) {
		prepare(painter);
		painter.text(styled, x, y, color);
	}

	/** Draws the text with its capital letters centered on {@code centerY}. */
	public void drawCentered(Painter painter, double x, double centerY, int color) {
		draw(painter, x, painter.textTopForCenter(font, centerY), color);
	}

	/** Draws the text cut to {@code maxWidth} with an ellipsis, capitals centered on {@code centerY}. */
	public void drawFitted(Painter painter, double x, double centerY, int maxWidth, int color) {
		prepareFitted(painter, maxWidth);
		painter.text(fitted, x, painter.textTopForCenter(font, centerY), color);
	}

	/** Width after cutting to {@code maxWidth}. */
	public float fittedWidth(Painter painter, int maxWidth) {
		prepareFitted(painter, maxWidth);
		return fittedWidth;
	}

	/** Whether the text had to be cut to fit {@code maxWidth}. */
	public boolean isCut(Painter painter, int maxWidth) {
		return width(painter) > maxWidth;
	}

	/** The text wrapped to {@code maxWidth}. Don't modify the list. */
	public List<FormattedCharSequence> lines(Painter painter, int maxWidth) {
		prepare(painter);

		if (wrapWidth != maxWidth) {
			List<FormattedCharSequence> result = new ArrayList<>(2);

			for (FormattedText line : painter.font().getSplitter().splitLines(value, Math.max(1, maxWidth), painter.style(font))) {
				result.add(Language.getInstance().getVisualOrder(line));
			}

			lines = List.copyOf(result);
			wrapWidth = maxWidth;
		}

		return lines;
	}

	/**
	 * Draws the wrapped text, one line every {@code lineHeight} GUI pixels from {@code top}.
	 *
	 * @return the height used
	 */
	public int drawWrapped(Painter painter, double x, double top, int maxWidth, int lineHeight, int color) {
		List<FormattedCharSequence> wrapped = lines(painter, maxWidth);

		for (int i = 0; i < wrapped.size(); i++) {
			painter.text(wrapped.get(i), x, top + i * lineHeight, color);
		}

		return wrapped.size() * lineHeight;
	}

	private void prepare(Painter painter) {
		if (generation == painter.generation() && styled != null) {
			return;
		}

		Style style = painter.style(font);
		styled = FormattedCharSequence.forward(value, style);
		width = painter.width(styled);
		generation = painter.generation();
		fitWidth = -1;
		fitted = null;
		wrapWidth = -1;
		lines = List.of();
	}

	private void prepareFitted(Painter painter, int maxWidth) {
		prepare(painter);

		if (fitted != null && fitWidth == maxWidth) {
			return;
		}

		if (width <= maxWidth) {
			fitted = styled;
			fittedWidth = width;
		} else {
			Style style = painter.style(font);
			FormattedCharSequence ellipsis = FormattedCharSequence.forward(ELLIPSIS, style);
			int room = Math.max(0, (int) Math.floor(maxWidth - painter.width(ellipsis)));
			String head = painter.font().getSplitter().plainHeadByWidth(value, room, style).stripTrailing();
			fitted = FormattedCharSequence.forward(head + ELLIPSIS, style);
			fittedWidth = painter.width(fitted);
		}

		fitWidth = maxWidth;
	}
}
