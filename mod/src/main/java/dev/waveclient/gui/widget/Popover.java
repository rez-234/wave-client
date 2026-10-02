package dev.waveclient.gui.widget;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.theme.Theme;

/**
 * A small panel drawn above everything else, anchored to the widget that opened it (a color
 * picker or a dropdown list). Coordinates are screen GUI pixels. The screen sends it input
 * first and closes it on Escape, on a click outside, or when the content scrolls.
 */
public abstract class Popover {
	protected static final int PADDING = 8;
	private static final int GAP = 4;

	protected double x;
	protected double y;
	protected int width;
	protected int height;
	private boolean closed;

	/** Size this popover wants; called before {@link #place}. */
	protected abstract void measure(Painter painter);

	/** Lays out children once {@link #x} and {@link #y} are known. */
	protected void layout() {
	}

	public abstract void render(Painter painter, double mouseX, double mouseY, float seconds);

	/** Positions the popover below the anchor, or above it if there's no room, kept on screen. */
	public final void place(Painter painter, double anchorX, double anchorY, int anchorWidth, int anchorHeight, int screenWidth, int screenHeight) {
		measure(painter);
		double left = anchorX + anchorWidth - width;
		double top = anchorY + anchorHeight + GAP;

		if (top + height > screenHeight - GAP && anchorY - GAP - height >= GAP) {
			top = anchorY - GAP - height;
		}

		x = Math.round(Math.max(GAP, Math.min(left, screenWidth - GAP - width)));
		y = Math.round(Math.max(GAP, Math.min(top, screenHeight - GAP - height)));
		layout();
	}

	public boolean contains(double mouseX, double mouseY) {
		return mouseX >= x && mouseX < x + width && mouseY >= y && mouseY < y + height;
	}

	public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
		return contains(mouseX, mouseY);
	}

	public void mouseDragged(double mouseX, double mouseY, int button) {
	}

	public void mouseReleased(double mouseX, double mouseY, int button) {
	}

	public boolean mouseScrolled(double mouseX, double mouseY, double amount) {
		return contains(mouseX, mouseY);
	}

	public boolean keyPressed(KeyEvent event) {
		return false;
	}

	public boolean charTyped(CharacterEvent event) {
		return false;
	}

	public CursorType cursor(double mouseX, double mouseY) {
		return CursorTypes.ARROW;
	}

	/** Asks the screen to remove this popover. */
	public final void close() {
		closed = true;
	}

	public final boolean isClosed() {
		return closed;
	}

	/** Runs when the popover goes away for any reason. */
	public void onClosed() {
	}

	protected final void drawFrame(Painter painter) {
		// A soft shadow offset downwards, then the panel itself.
		painter.roundRect(x - 1, y + 1, width + 2, height + 2, Theme.RADIUS_MEDIUM + 1, Theme.withAlpha(0xFF000000, 0x50));
		painter.roundRect(x, y, width, height, Theme.RADIUS_MEDIUM, Theme.SURFACE_RAISED, Theme.BORDER);
	}
}
