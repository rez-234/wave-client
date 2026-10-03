package dev.waveclient.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class EffectBlinkTest {
	private static final float EPSILON = 1e-4F;

	@Test
	void fullyVisibleUntilTheLastTenSeconds() {
		assertEquals(1.0F, EffectBlink.alpha(201, false));
		assertEquals(1.0F, EffectBlink.alpha(20 * 60, false));
	}

	@Test
	void infiniteAndAmbientEffectsNeverBlink() {
		assertEquals(1.0F, EffectBlink.alpha(-1, false));
		assertEquals(1.0F, EffectBlink.alpha(10, true));
	}

	@Test
	void matchesTheVanillaFormula() {
		// Values worked out by hand from Gui.renderEffects.
		assertEquals(0.5F, EffectBlink.alpha(200, false), EPSILON);
		assertEquals(0.575F, EffectBlink.alpha(150, false), EPSILON);
		assertEquals(0.7F, EffectBlink.alpha(50, false), EPSILON);
		assertEquals(0.25F, EffectBlink.alpha(45, false), EPSILON);
		assertEquals(0.6F, EffectBlink.alpha(40, false), EPSILON);
		assertEquals(0.01F + (float) Math.cos(Math.PI / 5) * 0.25F, EffectBlink.alpha(1, false), EPSILON);
		assertEquals(0.25F, EffectBlink.alpha(0, false), EPSILON);
	}

	@Test
	void staysBetweenZeroAndOne() {
		for (int ticks = 0; ticks <= 200; ticks++) {
			float alpha = EffectBlink.alpha(ticks, false);
			assertTrue(alpha >= 0.0F && alpha <= 1.0F, "alpha at " + ticks);
		}
	}
}
