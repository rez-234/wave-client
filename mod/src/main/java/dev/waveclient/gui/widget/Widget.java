package dev.waveclient.gui.widget;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;

import dev.waveclient.gui.render.Painter;

/**
 * Base class for the menu's own widgets. Unlike vanilla widgets they know nothing about
 * screens or focus lists: the menu screen hit-tests them, forwards input with coordinates in
 * the widget's own space (already adjusted for scrolling), and draws them through a
 * {@link Painter}.
 *
 * <p>Mouse buttons are GLFW codes (0 = left). Drags and releases go to the widget that took the
 * press, even when the pointer has left it.
 */
public abstract class Widget {
	protected double x;
	protected double y;
	protected int width;
	protected int height;
	private boolean focused;
	/** 0 to 1, eased towards 1 while hovered; for color transitions. */
	protected float hover;

	public void setBounds(double x, double y, int width, int height) {
		this.x = x;
		this.y = y;
		this.width = width;
		this.height = height;
	}

	public double x() {
		return x;
	}

	public double y() {
		return y;
	}

	public int width() {
		return width;
	}

	public int height() {
		return height;
	}

	public double right() {
		return x + width;
	}

	public double bottom() {
		return y + height;
	}

	public boolean contains(double mouseX, double mouseY) {
		return mouseX >= x && mouseX < x + width && mouseY >= y && mouseY < y + height;
	}

	/**
	 * Draws the widget.
	 *
	 * @param hovered whether the pointer is over this widget and nothing is in front of it
	 * @param seconds real time since the last frame, for animations
	 */
	public abstract void render(Painter painter, boolean hovered, double mouseX, double mouseY, float seconds);

	/** @return whether the press was handled; the widget then receives the drag and release */
	public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
		return false;
	}

	public void mouseDragged(double mouseX, double mouseY, int button) {
	}

	public void mouseReleased(double mouseX, double mouseY, int button) {
	}

	/** Only sent to the focused widget. */
	public boolean keyPressed(KeyEvent event) {
		return false;
	}

	/** Only sent to the focused widget. */
	public boolean charTyped(CharacterEvent event) {
		return false;
	}

	/** Whether clicking this widget gives it keyboard focus. */
	public boolean isFocusable() {
		return false;
	}

	public final boolean isFocused() {
		return focused;
	}

	public final void setFocused(boolean focused) {
		if (this.focused != focused) {
			this.focused = focused;
			onFocusChanged(focused);
		}
	}

	protected void onFocusChanged(boolean focused) {
	}

	/** Whether to draw a focus ring: focused, and focus came from the keyboard. */
	protected final boolean showsFocus(Painter painter) {
		return focused && painter.focusVisible();
	}

	/**
	 * Whether this widget wants every key while focused, so Escape and typing don't reach the
	 * screen (a key being captured, or text being edited).
	 */
	public boolean capturesKeyboard() {
		return false;
	}

	/** Pointer shape while hovering. */
	public CursorType cursor(double mouseX, double mouseY) {
		return CursorTypes.ARROW;
	}

	/** Text shown after hovering for a moment, or {@code null}. */
	public String tooltip(double mouseX, double mouseY) {
		return null;
	}

	/** Eases {@link #hover} towards the hovered state; call at the start of render. */
	protected final void animateHover(boolean hovered, float seconds) {
		hover = Anim.approach(hover, hovered ? 1 : 0, seconds, 14);
	}
}
