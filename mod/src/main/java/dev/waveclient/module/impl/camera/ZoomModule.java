package dev.waveclient.module.impl.camera;

import java.util.function.LongSupplier;

import dev.waveclient.input.Keybind;
import dev.waveclient.module.Category;
import dev.waveclient.module.Module;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.setting.KeybindSetting;
import dev.waveclient.setting.Setting;
import dev.waveclient.setting.SliderSetting;

/**
 * OptiFine-style zoom.
 *
 * <p>Mixins ask {@link #fovDivisor()} for the current zoom (1 = none) every frame. The value eases
 * between zoom levels over {@link #TRANSITION_NANOS}; the easing is computed from timestamps, so
 * calling it several times per frame is harmless and no per-frame state needs updating.
 */
public final class ZoomModule extends Module {
	public enum KeyMode implements EnumSetting.Labeled {
		HOLD("Hold"),
		TOGGLE("Toggle");

		private final String label;

		KeyMode(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	static final long TRANSITION_NANOS = 150_000_000L;
	private static final int GLFW_KEY_C = 67;
	private static final double SCROLL_STEP = 1.25;

	public final KeybindSetting zoomKey = add(new KeybindSetting("zoomKey", "Zoom key", Keybind.key(GLFW_KEY_C))
			.describe("Zooms in while held (or toggles, depending on Key mode)."));
	public final EnumSetting<KeyMode> keyMode = add(new EnumSetting<>("keyMode", "Key mode", KeyMode.HOLD));
	public final SliderSetting factor = add(new SliderSetting("factor", "Zoom factor", 4.0, 1.5, 50.0, 0.5)
			.describe("How much to magnify. 4x matches OptiFine."));
	public final BooleanSetting scrollToAdjust = add(new BooleanSetting("scrollToAdjust", "Scroll to adjust", true)
			.describe("Mouse wheel changes the zoom while zoomed instead of switching hotbar slots."));
	public final BooleanSetting resetOnRelease = add(new BooleanSetting("resetOnRelease", "Reset scroll on release", true)
			.describe("Start from the zoom factor every time instead of the last scrolled level.")
			.visibleWhen(scrollToAdjust::get));
	public final BooleanSetting smoothTransition = add(new BooleanSetting("smoothTransition", "Smooth transition", true)
			.describe("Animate zooming in and out."));
	public final BooleanSetting lowerSensitivity = add(new BooleanSetting("lowerSensitivity", "Lower sensitivity", true)
			.describe("Slow mouse movement down in proportion to the zoom, so aiming feels the same."));
	public final BooleanSetting cinematicCamera = add(new BooleanSetting("cinematicCamera", "Cinematic camera", false)
			.describe("Smooth camera movement while zoomed. Your cinematic camera key setting is left alone."));
	public final BooleanSetting reduceBobbing = add(new BooleanSetting("reduceBobbing", "Reduce view bobbing", true)
			.describe("Scale view bobbing down while zoomed so the magnified view doesn't sway. The held item bobs less too."));

	private final LongSupplier clock;
	private boolean zooming;
	private double level;
	private double from = 1.0;
	private double to = 1.0;
	private long transitionStart;

	public ZoomModule() {
		this(System::nanoTime);
	}

	/** For tests: a custom nanosecond clock. */
	ZoomModule(LongSupplier clock) {
		super("zoom", "Zoom", "Magnify the view while a key is held.", Category.CAMERA);
		this.clock = clock;
		setDefaultEnabled(true);
		zoomKey.onPress(this::onZoomKeyPressed).onRelease(this::onZoomKeyReleased);
	}

	/** Whether the zoom key is engaged (held, or toggled on). */
	public boolean isZooming() {
		return zooming;
	}

	/** Current magnification including the ease in/out; 1.0 means no zoom. */
	public double fovDivisor() {
		if (from == to) {
			return to;
		}

		if (!smoothTransition.get()) {
			return to;
		}

		long elapsed = clock.getAsLong() - transitionStart;

		if (elapsed >= TRANSITION_NANOS) {
			from = to;
			return to;
		}

		double t = Math.max(0, (double) elapsed / TRANSITION_NANOS);
		double eased = 1 - Math.pow(1 - t, 3);
		// Interpolate in log space so zooming 2x -> 8x feels as even as 1x -> 4x.
		return Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * eased);
	}

	/** True while any zoom is applied, including while animating back out. */
	public boolean isZoomed() {
		return fovDivisor() > 1.0001;
	}

	/** Factor for mouse look while zoomed: 1/zoom if "Lower sensitivity" is on, else 1. */
	public double sensitivityMultiplier() {
		if (!lowerSensitivity.get()) {
			return 1.0;
		}

		return 1.0 / fovDivisor();
	}

	/** Whether to force the cinematic camera right now. */
	public boolean forcesCinematicCamera() {
		return zooming && cinematicCamera.get();
	}

	/**
	 * Mouse wheel while zoomed.
	 *
	 * @param steps whole scroll steps, positive to zoom in (as vanilla counts them for the hotbar)
	 * @return {@code true} if the scroll was used for zoom and must not reach the hotbar
	 */
	public boolean onScroll(int steps) {
		if (!isActive() || !zooming || !scrollToAdjust.get() || steps == 0) {
			return false;
		}

		double next = level * Math.pow(SCROLL_STEP, steps);
		level = Math.min(factor.max(), Math.max(1.0, next));
		animateTo(level);
		return true;
	}

	@Override
	protected void onSettingChanged(Setting<?> setting) {
		if (setting == factor) {
			// A new base factor replaces any scrolled level, and applies right away if zoomed.
			level = factor.get();

			if (zooming) {
				animateTo(level);
			}
		} else if (setting == keyMode && zooming && !zoomKey.isDown()) {
			// Toggled on, then switched to Hold: no release will ever come, so stop now.
			stopZoom();
		}
	}

	@Override
	protected void onDisable() {
		zooming = false;
		level = 0;
		from = 1.0;
		to = 1.0;
	}

	private void onZoomKeyPressed() {
		if (!isActive()) {
			return;
		}

		if (keyMode.get() == KeyMode.TOGGLE && zooming) {
			stopZoom();
		} else {
			startZoom();
		}
	}

	private void onZoomKeyReleased() {
		if (keyMode.get() == KeyMode.HOLD && zooming) {
			stopZoom();
		}
	}

	private void startZoom() {
		zooming = true;

		if (level == 0 || resetOnRelease.get() || !scrollToAdjust.get()) {
			level = factor.get();
		}

		animateTo(level);
	}

	private void stopZoom() {
		zooming = false;
		animateTo(1.0);
	}

	private void animateTo(double target) {
		from = fovDivisor();
		to = target;
		transitionStart = clock.getAsLong();
	}
}
