package dev.waveclient.module.impl.render;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;

import dev.waveclient.module.ModuleManager;

class FullbrightModuleTest {
	@Test
	void gammaFollowsTheBrightnessSlider() {
		FullbrightModule fullbright = new FullbrightModule();
		assertEquals(15.0f, fullbright.gamma());
		fullbright.brightness.set(250);
		assertEquals(2.5f, fullbright.gamma());
		fullbright.brightness.set(5);
		assertEquals(1.0f, fullbright.gamma(), "never below 100%");
	}

	@Test
	void lightmapIsInvalidatedOnToggleAndWhileActiveOnly() {
		AtomicInteger invalidations = new AtomicInteger();
		ModuleManager manager = new ModuleManager();
		FullbrightModule fullbright = manager.register(new FullbrightModule());
		fullbright.setLightmapInvalidator(invalidations::incrementAndGet);
		manager.start();

		fullbright.brightness.set(1000);
		assertEquals(0, invalidations.get(), "inactive: nothing to refresh");

		fullbright.setEnabled(true);
		fullbright.brightness.set(500);
		fullbright.setEnabled(false);
		assertEquals(3, invalidations.get());
	}
}
