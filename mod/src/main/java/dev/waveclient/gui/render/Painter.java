package dev.waveclient.gui.render;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.Style;
import net.minecraft.resources.Identifier;
import net.minecraft.util.FormattedCharSequence;
import org.joml.Matrix3x2fStack;

import dev.waveclient.WaveClient;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.util.ColorMath;

/**
 * Draws the menu's shapes and text on top of {@link GuiGraphics}.
 *
 * <p>Coordinates are GUI pixels. Rounded shapes are drawn in screen pixels (by scaling the pose
 * down by the GUI scale), with anti-aliased corners from {@link CornerMask}, so a 3 px radius
 * looks the same as the launcher's CSS instead of a staircase of GUI pixels.
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
		int s = Math.max(UiFont.MIN_SCALE, Math.min(scale, UiFont.MAX_SCALE));
		Style style = styles[uiFont.ordinal()][s];

		if (style == null) {
			Identifier id = Identifier.fromNamespaceAndPath(WaveClient.MOD_ID, uiFont.definition(s));
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

		int ix = (int) Math.floor(x);
		int iy = (int) Math.floor(y);
		float fx = snap(x - ix);
		float fy = snap(y - iy);

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

	// Shapes.

	public void rect(double x, double y, double width, double height, int color) {
		if (width <= 0 || height <= 0 || (color >>> 24) == 0) {
			return;
		}

		int s = scale;
		int x0 = px(x);
		int y0 = px(y);
		int x1 = px(x + width);
		int y1 = px(y + height);

		if (x0 % s == 0 && y0 % s == 0 && x1 % s == 0 && y1 % s == 0) {
			graphics.fill(x0 / s, y0 / s, x1 / s, y1 / s, color);
			return;
		}

		Matrix3x2fStack pose = graphics.pose();
		pose.pushMatrix();
		pose.scale(1f / s, 1f / s);
		graphics.fill(x0, y0, x1, y1, color);
		pose.popMatrix();
	}

	/** A one-screen-pixel outline just inside the given bounds. */
	public void outline(double x, double y, double width, double height, int color) {
		float h = hairline();
		rect(x, y, width, h, color);
		rect(x, y + height - h, width, h, color);
		rect(x, y + h, h, height - 2 * h, color);
		rect(x + width - h, y + h, h, height - 2 * h, color);
	}

	/** A filled rectangle with anti-aliased rounded corners. {@code radius} is in GUI pixels. */
	public void roundRect(double x, double y, double width, double height, double radius, int color) {
		if (width <= 0 || height <= 0 || (color >>> 24) == 0) {
			return;
		}

		Matrix3x2fStack pose = graphics.pose();
		pose.pushMatrix();
		pose.scale(1f / scale, 1f / scale);
		int x0 = px(x);
		int y0 = px(y);
		fillRounded(x0, y0, px(x + width) - x0, px(y + height) - y0, (int) Math.round(radius * scale), color);
		pose.popMatrix();
	}

	/**
	 * A rounded rectangle with a border one screen pixel wide (two from GUI scale 4). The fill
	 * should be opaque: the border is drawn underneath it.
	 */
	public void roundRect(double x, double y, double width, double height, double radius, int fill, int border) {
		if (width <= 0 || height <= 0) {
			return;
		}

		Matrix3x2fStack pose = graphics.pose();
		pose.pushMatrix();
		pose.scale(1f / scale, 1f / scale);
		int x0 = px(x);
		int y0 = px(y);
		int w = px(x + width) - x0;
		int h = px(y + height) - y0;
		int r = (int) Math.round(radius * scale);
		int b = borderWidth();
		fillRounded(x0, y0, w, h, r, border);
		fillRounded(x0 + b, y0 + b, w - 2 * b, h - 2 * b, Math.max(0, r - b), fill);
		pose.popMatrix();
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
		if (width <= 0 || height <= 0) {
			return;
		}

		Matrix3x2fStack pose = graphics.pose();
		pose.pushMatrix();
		pose.scale(1f / scale, 1f / scale);
		graphics.fillGradient(px(x), px(y), px(x + width), px(y + height), top, bottom);
		pose.popMatrix();
	}

	/**
	 * A hue/saturation square for the color picker: saturation across, value down. Each screen
	 * pixel column is a vertical gradient from the fully bright color to black, which is exact
	 * because RGB is linear in value at a fixed hue and saturation.
	 */
	public void saturationValueSquare(double x, double y, double width, double height, float hue) {
		Matrix3x2fStack pose = graphics.pose();
		pose.pushMatrix();
		pose.scale(1f / scale, 1f / scale);
		int x0 = px(x);
		int y0 = px(y);
		int x1 = px(x + width);
		int y1 = px(y + height);
		int columns = Math.max(1, x1 - x0 - 1);

		for (int column = x0; column < x1; column++) {
			float saturation = (column - x0) / (float) columns;
			graphics.fillGradient(column, y0, column + 1, y1, ColorMath.hsvToRgb(hue, saturation, 1), 0xFF000000);
		}

		pose.popMatrix();
	}

	/** A vertical rainbow for picking a hue, red at the top and bottom. */
	public void hueBar(double x, double y, double width, double height) {
		Matrix3x2fStack pose = graphics.pose();
		pose.pushMatrix();
		pose.scale(1f / scale, 1f / scale);
		int x0 = px(x);
		int x1 = px(x + width);
		int y0 = px(y);
		int y1 = px(y + height);

		for (int i = 0; i < 6; i++) {
			int top = y0 + (y1 - y0) * i / 6;
			int bottom = y0 + (y1 - y0) * (i + 1) / 6;
			graphics.fillGradient(x0, top, x1, bottom, ColorMath.hsvToRgb(i / 6f, 1, 1), ColorMath.hsvToRgb((i + 1) / 6f, 1, 1));
		}

		pose.popMatrix();
	}

	/** Gray checks that show through translucent colors. {@code cell} is in GUI pixels. */
	public void checkerboard(double x, double y, double width, double height, double cell) {
		rect(x, y, width, height, 0xFFBFBFBF);
		int columns = (int) Math.ceil(width / cell);
		int rows = (int) Math.ceil(height / cell);

		for (int row = 0; row < rows; row++) {
			for (int column = row & 1; column < columns; column += 2) {
				double cx = x + column * cell;
				double cy = y + row * cell;
				rect(cx, cy, Math.min(cell, x + width - cx), Math.min(cell, y + height - cy), 0xFF7F7F7F);
			}
		}
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

	private float snap(double fraction) {
		return Math.round(fraction * scale) / (float) scale;
	}

	/** Fills a rounded rectangle given in screen pixels; the pose must already be in screen pixels. */
	private void fillRounded(int x, int y, int width, int height, int radius, int color) {
		if (width <= 0 || height <= 0 || (color >>> 24) == 0) {
			return;
		}

		int r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));

		if (r == 0) {
			graphics.fill(x, y, x + width, y + height, color);
			return;
		}

		CornerMask mask = CornerMask.of(r);
		r = mask.radius();
		graphics.fill(x, y + r, x + width, y + height - r, color);

		for (int row = 0; row < r; row++) {
			int top = y + row;
			int bottom = y + height - 1 - row;
			int solid = mask.solidFrom(row);

			if (width - 2 * solid > 0) {
				graphics.fill(x + solid, top, x + width - solid, top + 1, color);
				graphics.fill(x + solid, bottom, x + width - solid, bottom + 1, color);
			}

			for (int column = 0; column < solid; column++) {
				float coverage = mask.coverage(row, column);

				if (coverage <= 1 / 255f) {
					continue;
				}

				int partial = ColorMath.fadeAlpha(color, coverage);
				int left = x + column;
				int right = x + width - 1 - column;
				graphics.fill(left, top, left + 1, top + 1, partial);
				graphics.fill(right, top, right + 1, top + 1, partial);
				graphics.fill(left, bottom, left + 1, bottom + 1, partial);
				graphics.fill(right, bottom, right + 1, bottom + 1, partial);
			}
		}
	}
}
