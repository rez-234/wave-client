package dev.waveclient.gui.render;

import java.util.Arrays;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.Style;
import net.minecraft.resources.Identifier;
import net.minecraft.util.FormattedCharSequence;
import org.joml.Matrix3x2f;
import org.joml.Matrix3x2fStack;

import dev.waveclient.WaveClient;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.util.ColorMath;

/**
 * Draws the menu's shapes and text on top of {@link GuiGraphics}.
 *
 * <p>Coordinates are GUI pixels. Shapes are built in screen pixels (the pose is scaled down by
 * the GUI scale), with anti-aliased corners from {@link CornerMask}, so a 3 px radius looks the
 * same as the launcher's CSS instead of a staircase of GUI pixels. Each shape is submitted as a
 * single GUI element ({@link QuadBatchRenderState}), however many rectangles it is made of.
 *
 * <p>One instance lives per screen; call {@link #begin} at the start of each frame.
 */
public final class Painter {
	private static final int VANILLA_CAP_HEIGHT = 7;

	private final Style[][] styles = new Style[UiFont.values().length][UiFont.MAX_SCALE + 1];
	private GuiGraphics graphics;
	private Font font;
	private int scale = 1;
	private boolean inter;
	private int fontKey;
	private int generation;
	private int checkedScale = -1;
	private boolean interLoaded;
	private boolean focusVisible;
	private int[] quads = new int[64 * QuadBatchRenderState.STRIDE];
	private int count;
	private int minX = Integer.MAX_VALUE;
	private int minY = Integer.MAX_VALUE;
	private int maxX = Integer.MIN_VALUE;
	private int maxY = Integer.MIN_VALUE;

	/**
	 * @param preferInter whether the player wants Inter; it's still not used at GUI scale 1
	 */
	public void begin(GuiGraphics graphics, Font font, boolean preferInter) {
		this.graphics = graphics;
		prepare(font, preferInter);
	}

	/**
	 * Sets up fonts and the GUI scale without a {@link GuiGraphics}, so text can be measured
	 * for layout outside of rendering. Drawing still needs {@link #begin}. Render thread only:
	 * measuring text rasterises glyphs.
	 */
	public void prepare(Font font, boolean preferInter) {
		this.font = font;
		this.scale = Math.max(1, Minecraft.getInstance().getWindow().getGuiScale());
		this.inter = preferInter && UiFont.supports(scale) && interLoaded();
		int key = inter ? scale : 0;

		if (key != fontKey) {
			fontKey = key;
			generation++;
		}
	}

	/**
	 * Whether the Inter font for this scale actually loaded. If a font definition fails, every
	 * character draws as the same "missing" box, so narrow and wide letters measure the same.
	 */
	private boolean interLoaded() {
		if (checkedScale != scale) {
			checkedScale = scale;
			Style style = interStyle(UiFont.BODY);
			float narrow = font.getSplitter().stringWidth(FormattedCharSequence.forward("iiii", style));
			float wide = font.getSplitter().stringWidth(FormattedCharSequence.forward("WWWW", style));
			interLoaded = narrow < wide;

			if (!interLoaded) {
				WaveClient.LOGGER.warn("The Inter menu font didn't load at GUI scale {}; using the Minecraft font", scale);
			}
		}

		return interLoaded;
	}

	/**
	 * Forgets measured text and re-checks the font, e.g. after a resource reload. Screens call
	 * this from {@code init()}, which Minecraft runs again after every reload and resize.
	 */
	public void invalidateText() {
		generation++;
		checkedScale = -1;
	}

	/**
	 * Changes whenever measured text must be measured again (GUI scale or font changed). Cached
	 * {@link Text} compares against it.
	 */
	public int generation() {
		return generation;
	}

	/**
	 * Whether keyboard focus should be drawn: true after Tab moved it, false after a click, like
	 * the web's :focus-visible. Text fields show focus either way.
	 */
	public boolean focusVisible() {
		return focusVisible;
	}

	public void setFocusVisible(boolean focusVisible) {
		this.focusVisible = focusVisible;
	}

	public GuiGraphics graphics() {
		return graphics;
	}

	public Font font() {
		return font;
	}

	/** Screen pixels per GUI pixel. */
	public int scale() {
		return scale;
	}

	/** One screen pixel, in GUI pixels. */
	public float hairline() {
		return 1f / scale;
	}

	// Text.

	/** The style that selects {@code uiFont} at the current GUI scale, or the vanilla font. */
	public Style style(UiFont uiFont) {
		return inter ? interStyle(uiFont) : Style.EMPTY;
	}

	private Style interStyle(UiFont uiFont) {
		int s = Math.max(UiFont.MIN_SCALE, UiFont.oversample(scale));
		Style style = styles[uiFont.ordinal()][s];

		if (style == null) {
			Identifier id = Identifier.fromNamespaceAndPath(WaveClient.MOD_ID, uiFont.definition(scale));
			style = Style.EMPTY.withFont(new FontDescription.Resource(id)).withoutShadow();
			styles[uiFont.ordinal()][s] = style;
		}

		return style;
	}

	/** Height of capital letters, in GUI pixels. */
	public double capHeight(UiFont uiFont) {
		return inter ? uiFont.capHeight(scale) : VANILLA_CAP_HEIGHT;
	}

	/** The y to draw at so capital letters are centered on {@code centerY}. */
	public double textTopForCenter(UiFont uiFont, double centerY) {
		return centerY - UiFont.BASELINE + capHeight(uiFont) / 2;
	}

	/** Draws text with its top at ({@code x}, {@code y}), snapped to whole screen pixels. No shadow. */
	public void text(FormattedCharSequence text, double x, double y, int color) {
		if ((color >>> 24) == 0) {
			return;
		}

		// Glyph texels are 1/oversample GUI pixels; keep text on that grid so they stay whole.
		int grid = inter ? Math.max(1, UiFont.oversample(scale)) : scale;
		int ix = (int) Math.floor(x);
		int iy = (int) Math.floor(y);
		float fx = Math.round((x - ix) * grid) / (float) grid;
		float fy = Math.round((y - iy) * grid) / (float) grid;

		if (fx == 0 && fy == 0) {
			graphics.drawString(font, text, ix, iy, color, false);
			return;
		}

		Matrix3x2fStack pose = graphics.pose();
		pose.pushMatrix();
		pose.translate(fx, fy);
		graphics.drawString(font, text, ix, iy, color, false);
		pose.popMatrix();
	}

	/** Width of already-styled text, in GUI pixels (fractional: Inter advances are whole screen pixels). */
	public float width(FormattedCharSequence text) {
		return font.getSplitter().stringWidth(text);
	}

	// Shapes. Each public method submits one GUI element (see QuadBatchRenderState).

	public void rect(double x, double y, double width, double height, int color) {
		addRect(px(x), px(y), px(x + width), px(y + height), color);
		flush();
	}

	/** A one-screen-pixel outline just inside the given bounds. */
	public void outline(double x, double y, double width, double height, int color) {
		int x0 = px(x);
		int y0 = px(y);
		int x1 = px(x + width);
		int y1 = px(y + height);
		addRect(x0, y0, x1, y0 + 1, color);
		addRect(x0, y1 - 1, x1, y1, color);
		addRect(x0, y0 + 1, x0 + 1, y1 - 1, color);
		addRect(x1 - 1, y0 + 1, x1, y1 - 1, color);
		flush();
	}

	/** A filled rectangle with anti-aliased rounded corners. {@code radius} is in GUI pixels. */
	public void roundRect(double x, double y, double width, double height, double radius, int color) {
		int x0 = px(x);
		int y0 = px(y);
		addRounded(x0, y0, px(x + width) - x0, px(y + height) - y0, (int) Math.round(radius * scale), color);
		flush();
	}

	/**
	 * A rounded rectangle with a border one screen pixel wide (two from GUI scale 4). The fill
	 * should be opaque: the border is drawn underneath it.
	 */
	public void roundRect(double x, double y, double width, double height, double radius, int fill, int border) {
		int x0 = px(x);
		int y0 = px(y);
		int w = px(x + width) - x0;
		int h = px(y + height) - y0;
		int r = (int) Math.round(radius * scale);
		int b = borderWidth();
		addRounded(x0, y0, w, h, r, border);
		addRounded(x0 + b, y0 + b, w - 2 * b, h - 2 * b, Math.max(0, r - b), fill);
		flush();
	}

	/** A circle (or pill, if wider than tall) filling the bounds. */
	public void pill(double x, double y, double width, double height, int color) {
		roundRect(x, y, width, height, Math.min(width, height) / 2, color);
	}

	/** Border width for outlined shapes, in screen pixels. */
	public int borderWidth() {
		return scale >= 4 ? 2 : 1;
	}

	/** A vertical gradient from {@code top} to {@code bottom}, with screen-pixel edges. */
	public void gradient(double x, double y, double width, double height, int top, int bottom) {
		addQuad(px(x), px(y), px(x + width), px(y + height), top, bottom);
		flush();
	}

	/**
	 * A small solid triangle pointing down, centered on ({@code centerX}, {@code centerY}): the
	 * dropdown arrow. Drawn in screen-pixel rows so it is crisp at every GUI scale.
	 *
	 * @param width in GUI pixels; the height is half of it
	 */
	public void caretDown(double centerX, double centerY, double width, int color) {
		int half = Math.max(1, (int) Math.round(width * scale / 2));
		int cx = px(centerX);
		int top = px(centerY) - half / 2;

		for (int row = 0; row < half; row++) {
			int inset = row;
			addRect(cx - half + inset, top + row, cx + half - inset, top + row + 1, color);
		}

		flush();
	}

	/**
	 * A hue/saturation square for the color picker: saturation across, value down. Each screen
	 * pixel column is a vertical gradient from the fully bright color to black, which is exact
	 * because RGB is linear in value at a fixed hue and saturation.
	 */
	public void saturationValueSquare(double x, double y, double width, double height, float hue) {
		int x0 = px(x);
		int y0 = px(y);
		int x1 = px(x + width);
		int y1 = px(y + height);
		int columns = Math.max(1, x1 - x0 - 1);

		for (int column = x0; column < x1; column++) {
			float saturation = (column - x0) / (float) columns;
			addQuad(column, y0, column + 1, y1, ColorMath.hsvToRgb(hue, saturation, 1), 0xFF000000);
		}

		flush();
	}

	/** A vertical rainbow for picking a hue, red at the top and bottom. */
	public void hueBar(double x, double y, double width, double height) {
		int x0 = px(x);
		int x1 = px(x + width);
		int y0 = px(y);
		int y1 = px(y + height);

		for (int i = 0; i < 6; i++) {
			int top = y0 + (y1 - y0) * i / 6;
			int bottom = y0 + (y1 - y0) * (i + 1) / 6;
			addQuad(x0, top, x1, bottom, ColorMath.hsvToRgb(i / 6f, 1, 1), ColorMath.hsvToRgb((i + 1) / 6f, 1, 1));
		}

		flush();
	}

	/** Gray checks that show through translucent colors. {@code cell} is in GUI pixels. */
	public void checkerboard(double x, double y, double width, double height, double cell) {
		int x0 = px(x);
		int y0 = px(y);
		int x1 = px(x + width);
		int y1 = px(y + height);
		int size = Math.max(1, (int) Math.round(cell * scale));
		addRect(x0, y0, x1, y1, 0xFFBFBFBF);

		for (int top = y0, row = 0; top < y1; top += size, row++) {
			for (int left = x0 + (row & 1) * size; left < x1; left += 2 * size) {
				addRect(left, top, Math.min(left + size, x1), Math.min(top + size, y1), 0xFF7F7F7F);
			}
		}

		flush();
	}

	// Clipping.

	/** Clips drawing to the given GUI-pixel rectangle until {@link #popClip()}. Nests like the vanilla scissor stack. */
	public void pushClip(int x, int y, int width, int height) {
		graphics.enableScissor(x, y, x + width, y + height);
	}

	public void popClip() {
		graphics.disableScissor();
	}

	// Internals.

	/** GUI coordinate to the nearest screen pixel. */
	private int px(double gui) {
		return (int) Math.round(gui * scale);
	}

	private void addRect(int x0, int y0, int x1, int y1, int color) {
		addQuad(x0, y0, x1, y1, color, color);
	}

	/** Queues a rectangle in screen pixels for the next {@link #flush()}. */
	private void addQuad(int x0, int y0, int x1, int y1, int top, int bottom) {
		if (x1 <= x0 || y1 <= y0 || ((top >>> 24) == 0 && (bottom >>> 24) == 0)) {
			return;
		}

		if ((count + 1) * QuadBatchRenderState.STRIDE > quads.length) {
			quads = Arrays.copyOf(quads, quads.length * 2);
		}

		int o = count * QuadBatchRenderState.STRIDE;
		quads[o] = x0;
		quads[o + 1] = y0;
		quads[o + 2] = x1;
		quads[o + 3] = y1;
		quads[o + 4] = top;
		quads[o + 5] = bottom;
		count++;
		minX = Math.min(minX, x0);
		minY = Math.min(minY, y0);
		maxX = Math.max(maxX, x1);
		maxY = Math.max(maxY, y1);
	}

	/** Submits the queued rectangles as one element, clipped by the current scissor. */
	private void flush() {
		if (count == 0) {
			return;
		}

		Matrix3x2f pose = new Matrix3x2f(graphics.pose()).scale(1f / scale);
		// The element is kept until the frame is drawn, so it needs its own copy.
		int[] copy = Arrays.copyOf(quads, count * QuadBatchRenderState.STRIDE);
		QuadBatchRenderState element = QuadBatchRenderState.of(RenderPipelines.GUI, pose, copy, count, graphics.scissorStack.peek(),
				minX, minY, maxX, maxY);

		if (element != null) {
			graphics.guiRenderState.submitGuiElement(element);
		}

		count = 0;
		minX = Integer.MAX_VALUE;
		minY = Integer.MAX_VALUE;
		maxX = Integer.MIN_VALUE;
		maxY = Integer.MIN_VALUE;
	}

	/** Queues a rounded rectangle given in screen pixels. */
	private void addRounded(int x, int y, int width, int height, int radius, int color) {
		if (width <= 0 || height <= 0 || (color >>> 24) == 0) {
			return;
		}

		int r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));

		if (r == 0) {
			addRect(x, y, x + width, y + height, color);
			return;
		}

		CornerMask mask = CornerMask.of(r);
		r = mask.radius();
		addRect(x, y + r, x + width, y + height - r, color);

		for (int row = 0; row < r; row++) {
			int top = y + row;
			int bottom = y + height - 1 - row;
			int solid = mask.solidFrom(row);
			addRect(x + solid, top, x + width - solid, top + 1, color);
			addRect(x + solid, bottom, x + width - solid, bottom + 1, color);

			for (int column = 0; column < solid; column++) {
				float coverage = mask.coverage(row, column);

				if (coverage <= 1 / 255f) {
					continue;
				}

				int partial = ColorMath.fadeAlpha(color, coverage);
				int left = x + column;
				int right = x + width - 1 - column;
				addRect(left, top, left + 1, top + 1, partial);
				addRect(right, top, right + 1, top + 1, partial);
				addRect(left, bottom, left + 1, bottom + 1, partial);
				addRect(right, bottom, right + 1, bottom + 1, partial);
			}
		}
	}
}
