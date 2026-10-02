package dev.waveclient.module.impl.camera;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicLong;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import dev.waveclient.module.ModuleManager;

class ZoomModuleTest {
	private static final double EPS = 1e-9;
	private static final long DONE = ZoomModule.TRANSITION_NANOS;

	private final AtomicLong now = new AtomicLong(1_000_000_000L);
	private ZoomModule zoom;

	@BeforeEach
	void setUp() {
		ModuleManager manager = new ModuleManager();
		zoom = manager.register(new ZoomModule(now::get));
		manager.start();
	}

	private void press() {
		zoom.zoomKey.press();
	}

	private void release() {
		zoom.zoomKey.release();
	}

	@Test
	void enabledByDefaultButNotZoomed() {
		assertTrue(zoom.isActive());
		assertEquals(1.0, zoom.fovDivisor(), EPS);
		assertFalse(zoom.isZoomed());
	}

	@Test
	void holdEasesInAndOut() {
		press();
		assertTrue(zoom.isZooming());
		assertEquals(1.0, zoom.fovDivisor(), EPS);

		now.addAndGet(DONE / 2);
		double halfway = zoom.fovDivisor();
		assertTrue(halfway > 1.0 && halfway < 4.0, "mid-transition value " + halfway);

		now.addAndGet(DONE);
		assertEquals(4.0, zoom.fovDivisor(), EPS);
		assertTrue(zoom.isZoomed());

		release();
		assertFalse(zoom.isZooming());
		assertTrue(zoom.isZoomed(), "still zoomed while easing out");
		now.addAndGet(DONE);
		assertEquals(1.0, zoom.fovDivisor(), EPS);
		assertFalse(zoom.isZoomed());
	}

	@Test
	void instantWhenSmoothTransitionIsOff() {
		zoom.smoothTransition.set(false);
		press();
		assertEquals(4.0, zoom.fovDivisor(), EPS);
		release();
		assertEquals(1.0, zoom.fovDivisor(), EPS);
	}

	@Test
	void toggleMode() {
		zoom.keyMode.set(ZoomModule.KeyMode.TOGGLE);
		zoom.smoothTransition.set(false);

		press();
		release();
		assertTrue(zoom.isZooming());
		assertEquals(4.0, zoom.fovDivisor(), EPS);

		press();
		release();
		assertFalse(zoom.isZooming());
		assertEquals(1.0, zoom.fovDivisor(), EPS);
	}

	@Test
	void scrollAdjustsOnlyWhileZooming() {
		zoom.smoothTransition.set(false);
		assertFalse(zoom.onScroll(1));

		press();
		assertTrue(zoom.onScroll(1));
		assertEquals(5.0, zoom.fovDivisor(), EPS);
		assertTrue(zoom.onScroll(-1));
		assertTrue(zoom.onScroll(-1));
		assertEquals(3.2, zoom.fovDivisor(), EPS);
		assertFalse(zoom.onScroll(0));

		zoom.scrollToAdjust.set(false);
		assertFalse(zoom.onScroll(1));
	}

	@Test
	void multiStepScrollCompounds() {
		zoom.smoothTransition.set(false);
		press();
		assertTrue(zoom.onScroll(2));
		assertEquals(6.25, zoom.fovDivisor(), EPS);
		assertTrue(zoom.onScroll(-2));
		assertEquals(4.0, zoom.fovDivisor(), EPS);
	}

	@Test
	void scrollIsClamped() {
		zoom.smoothTransition.set(false);
		press();

		for (int i = 0; i < 100; i++) {
			zoom.onScroll(1);
		}

		assertEquals(50.0, zoom.fovDivisor(), EPS);

		for (int i = 0; i < 100; i++) {
			zoom.onScroll(-1);
		}

		assertEquals(1.0, zoom.fovDivisor(), EPS);
	}

	@Test
	void scrolledLevelResetsOrPersists() {
		zoom.smoothTransition.set(false);
		press();
		zoom.onScroll(1);
		release();
		press();
		assertEquals(4.0, zoom.fovDivisor(), EPS, "reset on release by default");

		zoom.resetOnRelease.set(false);
		zoom.onScroll(1);
		release();
		press();
		assertEquals(5.0, zoom.fovDivisor(), EPS);
	}

	@Test
	void sensitivityAndCinematicCamera() {
		zoom.smoothTransition.set(false);
		assertEquals(1.0, zoom.sensitivityMultiplier(), EPS);
		assertFalse(zoom.forcesCinematicCamera());

		press();
		assertEquals(0.25, zoom.sensitivityMultiplier(), EPS);
		assertFalse(zoom.forcesCinematicCamera());

		zoom.cinematicCamera.set(true);
		assertTrue(zoom.forcesCinematicCamera());
		zoom.lowerSensitivity.set(false);
		assertEquals(1.0, zoom.sensitivityMultiplier(), EPS);
	}

	@Test
	void disablingStopsZoomImmediately() {
		press();
		now.addAndGet(DONE);
		zoom.setEnabled(false);
		assertFalse(zoom.isZooming());
		assertEquals(1.0, zoom.fovDivisor(), EPS);

		release();
		press();
		assertFalse(zoom.isZooming(), "an inactive module ignores the key");
		release();

		zoom.setEnabled(true);
		assertFalse(zoom.isZooming(), "re-enabling doesn't bring back a zoom");
		assertEquals(1.0, zoom.fovDivisor(), EPS);
	}

	@Test
	void serverBlockStopsZoomAndKeyIsIgnoredUntilUnblocked() {
		ModuleManager manager = new ModuleManager();
		ZoomModule blocked = manager.register(new ZoomModule(now::get));
		manager.start();
		blocked.smoothTransition.set(false);

		blocked.zoomKey.press();
		manager.applyBlocks(java.util.Map.of("zoom", "Not allowed here"));
		assertFalse(blocked.isZooming());
		assertEquals(1.0, blocked.fovDivisor(), EPS);
		blocked.zoomKey.release();

		blocked.zoomKey.press();
		blocked.zoomKey.release();
		manager.clearBlocks();
		assertFalse(blocked.isZooming(), "a press while blocked doesn't leave zoom on");
		assertEquals(1.0, blocked.fovDivisor(), EPS);
	}

	@Test
	void changingFactorAppliesEvenWhenScrolledLevelIsKept() {
		zoom.smoothTransition.set(false);
		zoom.resetOnRelease.set(false);
		press();
		release();

		zoom.factor.set(10);
		press();
		assertEquals(10.0, zoom.fovDivisor(), EPS);

		zoom.factor.set(6);
		assertEquals(6.0, zoom.fovDivisor(), EPS, "applies immediately while zoomed");
	}

	@Test
	void switchingToHoldWhileToggledOnStopsZoom() {
		zoom.smoothTransition.set(false);
		zoom.keyMode.set(ZoomModule.KeyMode.TOGGLE);
		press();
		release();
		assertTrue(zoom.isZooming());

		zoom.keyMode.set(ZoomModule.KeyMode.HOLD);
		assertFalse(zoom.isZooming());
		assertEquals(1.0, zoom.fovDivisor(), EPS);
	}

	@Test
	void retargetingMidTransitionIsContinuous() {
		press();
		now.addAndGet(DONE / 3);
		double before = zoom.fovDivisor();
		release();
		assertEquals(before, zoom.fovDivisor(), 1e-6, "no jump when reversing direction");
	}
}
