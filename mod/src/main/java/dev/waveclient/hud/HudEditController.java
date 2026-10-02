package dev.waveclient.hud;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * The HUD editor's behaviour, kept free of Minecraft types so it can be unit tested: hit testing,
 * dragging with snapping, resizing by the corner handle or the scroll wheel, nudging and
 * resetting. The editor screen forwards input here and draws the result.
 *
 * <p>All coordinates are GUI-scaled pixels. Element bounds are computed exactly as the HUD layer
 * draws them ({@link HudPosition#pixelLeft}), so what you grab is what you see.
 */
public final class HudEditController {
	/** Something the editor can move: a HUD element's position and unscaled size. */
	public interface Element {
		HudPosition position();

		int width();

		int height();

		/** Whether the element is shown and can be edited right now (e.g. not blocked or broken). */
		default boolean isEditable() {
			return true;
		}
	}

	public record Bounds(double x, double y, double w, double h) {
		public double right() {
			return x + w;
		}

		public double bottom() {
			return y + h;
		}

		public boolean contains(double px, double py) {
			return px >= x && px < x + w && py >= y && py < y + h;
		}
	}

	private enum Drag {
		NONE, MOVE, SCALE
	}

	/** How close (in GUI pixels) an edge must come to a target before it snaps. */
	public static final double SNAP_DISTANCE = 4.0;
	/** Size of the square resize handle in an element's bottom-right corner. */
	public static final double HANDLE_SIZE = 5.0;
	/** Extra grab margin around the handle, so it's easy to hit. */
	private static final double HANDLE_SLOP = 2.0;
	/** Scale change per scroll step. */
	public static final double SCROLL_SCALE_STEP = 0.05;
	/** How far the mouse must move after a press before a drag starts, so a click never moves anything. */
	public static final double DRAG_THRESHOLD = 2.0;

	private final List<? extends Element> elements;
	private double screenWidth;
	private double screenHeight;
	private Element selected;
	private Element dragging;
	private Drag drag = Drag.NONE;
	private double grabX;
	private double grabY;
	private double pressX;
	private double pressY;
	private boolean dragStarted;
	private double scaleLeft;
	private double scaleTop;
	private double scrollAccumulator;
	private double guideX = Double.NaN;
	private double guideY = Double.NaN;

	public HudEditController(List<? extends Element> elements) {
		this.elements = List.copyOf(elements);
	}

	public void setScreenSize(double width, double height) {
		this.screenWidth = width;
		this.screenHeight = height;
	}

	public List<? extends Element> elements() {
		return elements;
	}

	/** Where the element is drawn right now, in GUI pixels (scaled size). */
	public Bounds bounds(Element element) {
		HudPosition position = element.position();
		double scale = position.scale();
		return new Bounds(
				position.pixelLeft(screenWidth, element.width()),
				position.pixelTop(screenHeight, element.height()),
				element.width() * scale,
				element.height() * scale);
	}

	/** The topmost element under the point (elements drawn later are on top), or null. */
	public Element elementAt(double x, double y) {
		for (int i = elements.size() - 1; i >= 0; i--) {
			Element element = elements.get(i);

			if (isVisible(element) && bounds(element).contains(x, y)) {
				return element;
			}
		}

		return null;
	}

	/**
	 * The element whose resize handle is under the point, or null. A handle only counts where it
	 * isn't covered by another element, so a click always goes to what's visible there. The
	 * selected element wins when handles overlap.
	 */
	public Element handleAt(double x, double y) {
		Element top = elementAt(x, y);

		if (selected != null && isOnHandle(selected, x, y) && (top == null || top == selected)) {
			return selected;
		}

		for (int i = elements.size() - 1; i >= 0; i--) {
			Element element = elements.get(i);

			if (isOnHandle(element, x, y) && (top == null || top == element)) {
				return element;
			}
		}

		return null;
	}

	/** The handle's square, drawn inside the element's bottom-right corner. */
	public Bounds handleBounds(Element element) {
		Bounds bounds = bounds(element);
		return new Bounds(bounds.right() - HANDLE_SIZE, bounds.bottom() - HANDLE_SIZE, HANDLE_SIZE, HANDLE_SIZE);
	}

	/**
	 * Left mouse button pressed. Grabs a resize handle or an element; clicking empty space clears
	 * the selection.
	 *
	 * @return whether an element was grabbed
	 */
	public boolean press(double x, double y) {
		pressX = x;
		pressY = y;
		dragStarted = false;
		scrollAccumulator = 0;
		Element handle = handleAt(x, y);

		if (handle != null) {
			Bounds bounds = bounds(handle);
			selected = handle;
			dragging = handle;
			drag = Drag.SCALE;
			// The top-left corner stays put for the whole resize, and the grab point keeps its
			// distance to the corner, so the size doesn't jump on the first movement.
			scaleLeft = bounds.x();
			scaleTop = bounds.y();
			grabX = bounds.right() - x;
			grabY = bounds.bottom() - y;
			return true;
		}

		Element element = elementAt(x, y);

		if (element == null) {
			selected = null;
			return false;
		}

		Bounds bounds = bounds(element);
		selected = element;
		dragging = element;
		drag = Drag.MOVE;
		grabX = x - bounds.x();
		grabY = y - bounds.y();
		return true;
	}

	/**
	 * Mouse moved while the button is held.
	 *
	 * @param snap {@code false} while the snap modifier (Alt) is held
	 */
	public void drag(double x, double y, boolean snap) {
		if (dragging != null && !isVisible(dragging)) {
			release();
		}

		if (dragging == null) {
			return;
		}

		if (!dragStarted) {
			if (Math.abs(x - pressX) < DRAG_THRESHOLD && Math.abs(y - pressY) < DRAG_THRESHOLD) {
				return;
			}

			dragStarted = true;
		}

		if (drag == Drag.SCALE) {
			scaleTo(dragging, x, y);
		} else {
			moveTo(dragging, x - grabX, y - grabY, snap);
		}
	}

	public void release() {
		dragging = null;
		drag = Drag.NONE;
		clearGuides();
	}

	/**
	 * Mouse wheel over an element: scale it by {@link #SCROLL_SCALE_STEP} per whole scroll step,
	 * keeping its center where it is. Fractional amounts (trackpads, smooth-scrolling wheels) are
	 * added up, as vanilla does for the hotbar, so one notch is always one step.
	 *
	 * @return whether an element was under the mouse
	 */
	public boolean scroll(double x, double y, double amount) {
		Element element = elementAt(x, y);

		if (element == null || amount == 0 || dragging != null) {
			return false;
		}

		if (element != selected || Math.signum(amount) != Math.signum(scrollAccumulator)) {
			scrollAccumulator = 0;
		}

		selected = element;
		scrollAccumulator += amount;
		// A small tolerance so ten 0.1 steps (summing to 0.9999...) still make one whole step.
		int steps = (int) (scrollAccumulator + Math.copySign(1e-6, scrollAccumulator));
		scrollAccumulator -= steps;

		if (steps == 0) {
			return true;
		}

		HudPosition position = element.position();
		int unscaledWidth = element.width();
		int unscaledHeight = element.height();
		// The center comes from the exact position, not the rounded pixel, so scrolling up and
		// back down returns the element to the same spot instead of creeping.
		double centerX = position.left(screenWidth, unscaledWidth) + unscaledWidth * position.scale() / 2;
		double centerY = position.top(screenHeight, unscaledHeight) + unscaledHeight * position.scale() / 2;
		position.setScale(position.scale() + steps * SCROLL_SCALE_STEP);

		double width = unscaledWidth * position.scale();
		double height = unscaledHeight * position.scale();
		double left = pixel(centerX - width / 2, screenWidth - width);
		double top = pixel(centerY - height / 2, screenHeight - height);
		position.moveTo(left, top, screenWidth, screenHeight, unscaledWidth, unscaledHeight);
		return true;
	}

	/** Moves the selected element by whole pixels, without snapping. */
	public boolean nudge(double dx, double dy) {
		dropHiddenSelection();

		if (selected == null || dragging != null) {
			return false;
		}

		Bounds bounds = bounds(selected);
		double left = clamp(bounds.x() + dx, screenWidth - bounds.w());
		double top = clamp(bounds.y() + dy, screenHeight - bounds.h());
		selected.position().moveTo(left, top, screenWidth, screenHeight, selected.width(), selected.height());
		return true;
	}

	/** Restores the selected element's default position and scale (not while dragging). */
	public boolean resetSelected() {
		dropHiddenSelection();

		if (selected == null || dragging != null) {
			return false;
		}

		selected.position().reset();
		return true;
	}

	public void resetAll() {
		release();

		for (Element element : elements) {
			element.position().reset();
		}
	}

	public Element selected() {
		return selected;
	}

	public void select(Element element) {
		if (element != null && !elements.contains(element)) {
			throw new IllegalArgumentException("Not an editable element");
		}

		selected = element;
	}

	public Element dragging() {
		return dragging;
	}

	public boolean isScaling() {
		return drag == Drag.SCALE;
	}

	/** Vertical guide line to draw while dragging, or NaN. */
	public double guideX() {
		return guideX;
	}

	/** Horizontal guide line to draw while dragging, or NaN. */
	public double guideY() {
		return guideY;
	}

	private void moveTo(Element element, double proposedLeft, double proposedTop, boolean snap) {
		Bounds bounds = bounds(element);
		double left = clamp(proposedLeft, screenWidth - bounds.w());
		double top = clamp(proposedTop, screenHeight - bounds.h());
		clearGuides();

		if (snap) {
			SnapEngine.Result snapped = SnapEngine.snap(new SnapEngine.Rect(left, top, bounds.w(), bounds.h()),
					screenWidth, screenHeight, otherRects(element), SNAP_DISTANCE);
			left = snapped.x();
			top = snapped.y();
			guideX = snapped.guideX();
			guideY = snapped.guideY();
		}

		left = pixel(left, screenWidth - bounds.w());
		top = pixel(top, screenHeight - bounds.h());
		element.position().moveTo(left, top, screenWidth, screenHeight, element.width(), element.height());
	}

	/**
	 * Resizes from the bottom-right corner, measured from where the drag started: the top-left
	 * corner recorded at the press stays fixed unless the bigger element would no longer fit, in
	 * which case it moves in just enough to stay on screen. Every event is computed from the
	 * press, not from the previous event, so moving the mouse back always undoes the resize.
	 */
	private void scaleTo(Element element, double x, double y) {
		int width = element.width();
		int height = element.height();

		if (width <= 0 || height <= 0) {
			return;
		}

		double cornerX = x + grabX;
		double cornerY = y + grabY;
		double scale = Math.max((cornerX - scaleLeft) / width, (cornerY - scaleTop) / height);
		double fit = Math.min(screenWidth / width, screenHeight / height);

		if (scale > fit) {
			// Round down to a whole step: rounding to nearest could overflow the screen by a pixel.
			scale = Math.floor(fit / HudPosition.SCALE_STEP + 1e-9) * HudPosition.SCALE_STEP;
		}

		HudPosition position = element.position();
		position.setScale(scale);
		double scaledWidth = width * position.scale();
		double scaledHeight = height * position.scale();
		double left = pixel(scaleLeft, screenWidth - scaledWidth);
		double top = pixel(scaleTop, screenHeight - scaledHeight);
		position.moveTo(left, top, screenWidth, screenHeight, width, height);
	}

	private List<SnapEngine.Rect> otherRects(Element moving) {
		List<SnapEngine.Rect> rects = new ArrayList<>(elements.size());

		for (Element element : elements) {
			if (element != moving && isVisible(element)) {
				Bounds bounds = bounds(element);
				rects.add(new SnapEngine.Rect(bounds.x(), bounds.y(), bounds.w(), bounds.h()));
			}
		}

		return rects;
	}

	private boolean isOnHandle(Element element, double x, double y) {
		if (!isVisible(element)) {
			return false;
		}

		Bounds handle = handleBounds(element);
		return x >= handle.x() - HANDLE_SLOP && x < handle.right() + HANDLE_SLOP
				&& y >= handle.y() - HANDLE_SLOP && y < handle.bottom() + HANDLE_SLOP;
	}

	/** Whether the element is drawn and can be grabbed: editable and not empty. */
	public static boolean isVisible(Element element) {
		return element.isEditable() && element.width() > 0 && element.height() > 0;
	}

	/** An element hidden while the editor is open (disabled, blocked) can't stay selected. */
	private void dropHiddenSelection() {
		if (selected != null && !isVisible(selected)) {
			selected = null;
		}
	}

	private void clearGuides() {
		guideX = Double.NaN;
		guideY = Double.NaN;
	}

	private static double clamp(double value, double max) {
		return Math.min(Math.max(0, max), Math.max(0, value));
	}

	/**
	 * Clamps to the screen and snaps to a whole GUI pixel. Storing whole-pixel positions means the
	 * offsets saved to the config (rounded to 2 decimals) can never round to a different pixel
	 * on reload, and what's drawn is exactly what's stored.
	 */
	private static double pixel(double value, double max) {
		double limit = Math.floor(Math.max(0, max));
		return Math.min(limit, Math.max(0, Math.round(value)));
	}

	@Override
	public String toString() {
		return "HudEditController[" + elements.size() + " elements, selected=" + Objects.toString(selected) + "]";
	}
}
