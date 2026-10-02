package dev.waveclient.hud;

import java.util.Locale;
import java.util.Objects;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

/**
 * Where a HUD element sits: an {@link Anchor}, an offset in GUI-scaled pixels from that anchor
 * to the same point on the element, and a scale.
 *
 * <p>Pure math with no Minecraft types, so it is unit tested directly.
 */
public final class HudPosition {
	public static final double MIN_SCALE = 0.5;
	public static final double MAX_SCALE = 3.0;
	private static final double SCALE_STEP = 0.05;

	private final Anchor defaultAnchor;
	private final double defaultX;
	private final double defaultY;
	private final double defaultScale;
	private Anchor anchor;
	private double offsetX;
	private double offsetY;
	private double scale;
	private Runnable changeSink = () -> { };

	public HudPosition(Anchor anchor, double offsetX, double offsetY) {
		this(anchor, offsetX, offsetY, 1.0);
	}

	public HudPosition(Anchor anchor, double offsetX, double offsetY, double scale) {
		this.defaultAnchor = Objects.requireNonNull(anchor, "anchor");
		this.defaultX = offsetX;
		this.defaultY = offsetY;
		this.defaultScale = normalizeScale(scale);
		this.anchor = defaultAnchor;
		this.offsetX = defaultX;
		this.offsetY = defaultY;
		this.scale = defaultScale;
	}

	public Anchor anchor() {
		return anchor;
	}

	public double offsetX() {
		return offsetX;
	}

	public double offsetY() {
		return offsetY;
	}

	public double scale() {
		return scale;
	}

	/** Called after any change; set by the owning module so the config gets saved. */
	public void setChangeSink(Runnable sink) {
		this.changeSink = Objects.requireNonNull(sink, "sink");
	}

	public void set(Anchor anchor, double offsetX, double offsetY) {
		Objects.requireNonNull(anchor, "anchor");

		if (!Double.isFinite(offsetX) || !Double.isFinite(offsetY)) {
			return;
		}

		if (anchor != this.anchor || offsetX != this.offsetX || offsetY != this.offsetY) {
			this.anchor = anchor;
			this.offsetX = offsetX;
			this.offsetY = offsetY;
			changeSink.run();
		}
	}

	/** Sets the scale, clamped to {@link #MIN_SCALE}..{@link #MAX_SCALE} in steps of 0.05. */
	public void setScale(double scale) {
		if (!Double.isFinite(scale)) {
			return;
		}

		double normalized = normalizeScale(scale);

		if (normalized != this.scale) {
			this.scale = normalized;
			changeSink.run();
		}
	}

	public void reset() {
		boolean changed = anchor != defaultAnchor || offsetX != defaultX || offsetY != defaultY || scale != defaultScale;
		anchor = defaultAnchor;
		offsetX = defaultX;
		offsetY = defaultY;
		scale = defaultScale;

		if (changed) {
			changeSink.run();
		}
	}

	/**
	 * Left edge of the element in GUI pixels, kept on screen.
	 *
	 * @param elementWidth unscaled element width in GUI pixels
	 */
	public double left(double screenWidth, double elementWidth) {
		return place(anchor.fx, offsetX, screenWidth, elementWidth * scale);
	}

	/** Top edge of the element in GUI pixels, kept on screen. */
	public double top(double screenHeight, double elementHeight) {
		return place(anchor.fy, offsetY, screenHeight, elementHeight * scale);
	}

	/**
	 * Moves the element so its top-left corner is at ({@code left}, {@code top}), picking the
	 * anchor from the third of the screen its center falls in. Used by the HUD editor.
	 */
	public void moveTo(double left, double top, double screenWidth, double screenHeight, double elementWidth, double elementHeight) {
		double width = elementWidth * scale;
		double height = elementHeight * scale;
		double centerX = left + width / 2;
		double centerY = top + height / 2;
		Anchor nearest = Anchor.nearest(screenWidth > 0 ? centerX / screenWidth : 0, screenHeight > 0 ? centerY / screenHeight : 0);
		set(nearest, left + nearest.fx * width - nearest.fx * screenWidth, top + nearest.fy * height - nearest.fy * screenHeight);
	}

	public JsonObject toJson() {
		JsonObject json = new JsonObject();
		json.addProperty("anchor", anchor.name());
		json.addProperty("x", round2(offsetX));
		json.addProperty("y", round2(offsetY));
		json.addProperty("scale", scale);
		return json;
	}

	/** Applies saved values; anything missing or malformed keeps its current value. */
	public void fromJson(JsonObject json) {
		Anchor newAnchor = anchor;
		double newX = offsetX;
		double newY = offsetY;

		if (isString(json.get("anchor"))) {
			try {
				newAnchor = Anchor.valueOf(json.get("anchor").getAsString().toUpperCase(Locale.ROOT));
			} catch (IllegalArgumentException ignored) {
				// Unknown anchor name: keep the current one.
			}
		}

		if (isNumber(json.get("x"))) {
			newX = json.get("x").getAsDouble();
		}

		if (isNumber(json.get("y"))) {
			newY = json.get("y").getAsDouble();
		}

		set(newAnchor, newX, newY);

		if (isNumber(json.get("scale"))) {
			setScale(json.get("scale").getAsDouble());
		}
	}

	private static double place(double fraction, double offset, double screenSize, double size) {
		double position = fraction * screenSize + offset - fraction * size;
		double max = Math.max(0, screenSize - size);
		return Math.min(max, Math.max(0, position));
	}

	private static double normalizeScale(double scale) {
		double clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
		return round2(Math.round(clamped / SCALE_STEP) * SCALE_STEP);
	}

	private static double round2(double value) {
		return Math.round(value * 100) / 100.0;
	}

	private static boolean isString(JsonElement element) {
		return element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isString();
	}

	private static boolean isNumber(JsonElement element) {
		return element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isNumber();
	}
}
