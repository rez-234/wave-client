package dev.waveclient.module.impl.camera;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import org.junit.jupiter.api.Test;

class FreelookCameraTest {
	@Test
	void turnsLikeAnEntity() {
		FreelookCamera camera = new FreelookCamera();
		camera.start(90, 10);
		camera.turn(100, 20, false);
		assertEquals(105, camera.yaw(), 1e-4, "0.15 degrees per unit, as Entity.turn");
		assertEquals(13, camera.pitch(), 1e-4);
		camera.turn(0, 20, true);
		assertEquals(10, camera.pitch(), 1e-4, "inverted");
	}

	@Test
	void pitchIsClamped() {
		FreelookCamera camera = new FreelookCamera();
		camera.start(0, 120);
		assertEquals(90, camera.pitch(), 1e-6);
		camera.turn(0, -10_000, false);
		assertEquals(-90, camera.pitch(), 1e-6);
	}

	@Test
	void inactiveCameraIgnoresInput() {
		FreelookCamera camera = new FreelookCamera();
		camera.turn(100, 100, false);
		assertEquals(0, camera.yaw(), 1e-6);
		camera.start(5, 5);
		camera.stop();
		assertFalse(camera.active());
		camera.turn(100, 100, false);
		assertEquals(5, camera.yaw(), 1e-6);
	}
}
