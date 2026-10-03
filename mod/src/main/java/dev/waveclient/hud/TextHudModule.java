package dev.waveclient.hud;

import java.util.Arrays;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.locale.Language;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.util.FormattedCharSequence;

import dev.waveclient.module.Category;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.ColorSetting;
import dev.waveclient.setting.Setting;

/**
 * A HUD element that shows one or more lines of text in an optional background box.
 *
 * <p>Subclasses rebuild their text in {@link #updateText(boolean)}, which runs every tick but
 * should return early when nothing changed. When the text changes it is converted once to the
 * display-ordered form the renderer needs and measured, so {@link #render} draws cached data:
 * passing a plain String to drawString would redo that conversion (and allocate) every frame.
 * Lines are aligned to the side the element is anchored to, so right-anchored text grows
 * leftwards.
 */
// Settings register change listeners that capture 'this', but they only run on later edits.
@SuppressWarnings("this-escape")
public abstract class TextHudModule extends HudModule {
	private static final String[] NO_LINES = new String[0];
	private static final FormattedCharSequence[] NO_SEQUENCES = new FormattedCharSequence[0];
	private static final int PADDING = 3;
	private static final int ROW_HEIGHT = 10;
	private static final int GLYPH_HEIGHT = 8;
	/** Re-measure once a second so a font, language or resource-pack change can't leave stale widths. */
	private static final int REMEASURE_TICKS = 20;

	public final ColorSetting textColor = add(new ColorSetting("textColor", "Text color", 0xFFFFFFFF));
	public final BooleanSetting textShadow = add(new BooleanSetting("textShadow", "Text shadow", true));
	public final BooleanSetting background = add(new BooleanSetting("background", "Background", true));
	public final ColorSetting backgroundColor = add(new ColorSetting("backgroundColor", "Background color", 0x80101114)
			.visibleWhen(background::get));

	private String[] lines = NO_LINES;
	private FormattedCharSequence[] sequences = NO_SEQUENCES;
	private int[] lineWidths = new int[0];
	private int textWidth;
	private boolean stale = true;
	private boolean editorOpen;
	private int ticksSinceMeasure;

	protected TextHudModule(String id, String name, String description, Anchor anchor, double offsetX, double offsetY) {
		super(id, name, description, anchor, offsetX, offsetY);
	}

	protected TextHudModule(String id, String name, String description, Category category, Anchor anchor, double offsetX, double offsetY) {
		super(id, name, description, category, anchor, offsetX, offsetY);
	}

	/**
	 * Rebuilds the text if its source value changed, by calling {@link #setLines}.
	 *
	 * @param force {@code true} after a setting changed or the module was enabled, so the text
	 *              must be rebuilt even if the value is the same
	 */
	protected abstract void updateText(boolean force);

	/** Replaces the displayed text. Measures only if the text actually changed. */
	protected final void setLines(String... newLines) {
		if (Arrays.equals(lines, newLines)) {
			return;
		}

		measure(newLines);
	}

	private void measure(String[] newLines) {
		ticksSinceMeasure = 0;
		Font font = Minecraft.getInstance().font;
		Language language = Language.getInstance();
		FormattedCharSequence[] newSequences = new FormattedCharSequence[newLines.length];
		int[] widths = new int[newLines.length];
		int widest = 0;

		for (int i = 0; i < newLines.length; i++) {
			newSequences[i] = language.getVisualOrder(FormattedText.of(newLines[i]));
			widths[i] = font.width(newSequences[i]);
			widest = Math.max(widest, widths[i]);
		}

		lines = newLines;
		sequences = newSequences;
		lineWidths = widths;
		textWidth = widest;
	}

	@Override
	protected void onEnable() {
		stale = true;
	}

	/**
	 * Whether the HUD editor is open. Text that would be empty should show a sample then, so the
	 * element can be placed. Opening or closing the editor rebuilds the text.
	 */
	protected final boolean editorOpen() {
		return editorOpen;
	}

	@Override
	public void prepareForEditor() {
		editorOpen = true;
		updateText(true);
	}

	@Override
	protected void onTick() {
		boolean editor = isHudEditorOpen();
		boolean force = stale || editor != editorOpen;
		editorOpen = editor;
		stale = false;
		updateText(force);

		if (++ticksSinceMeasure >= REMEASURE_TICKS && lines.length > 0) {
			measure(lines);
		}
	}

	@Override
	protected void onSettingChanged(Setting<?> setting) {
		stale = true;
	}

	@Override
	public int width() {
		if (lines.length == 0) {
			return 0;
		}

		return background.get() ? textWidth - 1 + 2 * PADDING : textWidth;
	}

	@Override
	public int height() {
		if (lines.length == 0) {
			return 0;
		}

		int text = (lines.length - 1) * ROW_HEIGHT + GLYPH_HEIGHT;
		return background.get() ? text + 2 * PADDING : text;
	}

	@Override
	public void render(GuiGraphics graphics) {
		FormattedCharSequence[] currentLines = sequences;
		int[] widths = lineWidths;

		if (currentLines.length == 0) {
			return;
		}

		boolean boxed = background.get();
		int inset = boxed ? PADDING : 0;
		int backgroundArgb = backgroundColor.get();

		// A fully transparent fill would still be submitted to the renderer.
		if (boxed && (backgroundArgb >>> 24) != 0) {
			graphics.fill(0, 0, width(), height(), backgroundArgb);
		}

		Font font = Minecraft.getInstance().font;
		double alignment = position.anchor().fx;
		int color = textColor.get();
		boolean shadow = textShadow.get();

		for (int i = 0; i < currentLines.length; i++) {
			int x = inset + (int) Math.round((textWidth - widths[i]) * alignment);
			graphics.drawString(font, currentLines[i], x, inset + i * ROW_HEIGHT, color, shadow);
		}
	}
}
