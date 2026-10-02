package dev.waveclient.gui.widget;

/**
 * Vertical scrolling for a clipped area: a target offset that wheel and keys move, a displayed
 * offset that eases towards it, and the scrollbar thumb's geometry and dragging.
 */
public final class ScrollState {
	/** How quickly the displayed offset catches up with the target, per second. */
	private static final double EASING_RATE = 18;

	private double content;
	private double viewport;
	private double target;
	private double current;
	private double thumbGrab = Double.NaN;

	/** Thumb position and size within the track. */
	public record Thumb(double y, double height) {
		public double bottom() {
			return y + height;
		}

		public boolean contains(double mouseY) {
			return mouseY >= y && mouseY < y + height;
		}
	}

	/** Sets the content and viewport heights, keeping the offset in range. */
	public void setBounds(double contentHeight, double viewportHeight) {
		this.content = Math.max(0, contentHeight);
		this.viewport = Math.max(0, viewportHeight);
		target = clamp(target);
		current = clamp(current);
	}

	public double maxOffset() {
		return Math.max(0, content - viewport);
	}

	public boolean canScroll() {
		return maxOffset() > 0;
	}

	/** The offset to draw with this frame. */
	public double offset() {
		return current;
	}

	public double target() {
		return target;
	}

	public void scrollBy(double delta) {
		target = clamp(target + delta);
	}

	/** Jumps to an offset immediately, without easing. */
	public void jumpTo(double offset) {
		target = clamp(offset);
		current = target;
	}

	/** Scrolls just enough that the span from {@code top} to {@code bottom} (content coordinates) is visible. */
	public void reveal(double top, double bottom) {
		if (top < target) {
			target = clamp(top);
		} else if (bottom > target + viewport) {
			target = clamp(Math.min(top, bottom - viewport));
		}
	}

	/** Advances the easing by {@code seconds} of real time. */
	public void update(double seconds) {
		if (!(seconds > 0)) {
			return;
		}

		double remaining = target - current;

		if (Math.abs(remaining) < 0.25) {
			current = target;
		} else {
			current += remaining * (1 - Math.exp(-EASING_RATE * seconds));
		}
	}

	/**
	 * The thumb for a track of the given position and length.
	 *
	 * @param minHeight the smallest the thumb may get, so it stays grabbable
	 */
	public Thumb thumb(double trackTop, double trackHeight, double minHeight) {
		if (!canScroll() || trackHeight <= 0) {
			return new Thumb(trackTop, trackHeight);
		}

		double height = Math.min(trackHeight, Math.max(minHeight, trackHeight * viewport / content));
		double travel = trackHeight - height;
		return new Thumb(trackTop + travel * (current / maxOffset()), height);
	}

	/**
	 * Starts dragging the thumb. A press outside the thumb first centers the thumb on the
	 * pointer, like most scrollbars.
	 */
	public void beginThumbDrag(double mouseY, double trackTop, double trackHeight, double minHeight) {
		Thumb thumb = thumb(trackTop, trackHeight, minHeight);

		if (!thumb.contains(mouseY)) {
			dragThumb(mouseY - thumb.height() / 2, 0, trackTop, trackHeight, minHeight);
			thumb = thumb(trackTop, trackHeight, minHeight);
		}

		thumbGrab = mouseY - thumb.y();
	}

	/** Moves the thumb so the pointer keeps its grab point; the offset follows without easing. */
	public void dragThumb(double mouseY, double trackTop, double trackHeight, double minHeight) {
		if (isDraggingThumb()) {
			dragThumb(mouseY, thumbGrab, trackTop, trackHeight, minHeight);
		}
	}

	public boolean isDraggingThumb() {
		return !Double.isNaN(thumbGrab);
	}

	public void endThumbDrag() {
		thumbGrab = Double.NaN;
	}

	private void dragThumb(double mouseY, double grab, double trackTop, double trackHeight, double minHeight) {
		Thumb thumb = thumb(trackTop, trackHeight, minHeight);
		double travel = trackHeight - thumb.height();

		if (travel > 0) {
			jumpTo((mouseY - grab - trackTop) / travel * maxOffset());
		}
	}

	private double clamp(double offset) {
		return Math.max(0, Math.min(maxOffset(), offset));
	}
}
