package dev.waveclient.gui.widget;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class TwoStepConfirmTest {
	@Test
	void theFirstClickOnlyArms() {
		TwoStepConfirm confirm = new TwoStepConfirm(3000, 300);
		assertFalse(confirm.isArmed(0), "not armed before any click, whatever the clock says");
		assertFalse(confirm.isArmed(Long.MIN_VALUE));
		assertFalse(confirm.click(1_000));
		assertTrue(confirm.isArmed(1_000));
		assertTrue(confirm.click(2_000), "a second click inside the window confirms");
		assertFalse(confirm.isArmed(2_000), "and disarms");
		assertFalse(confirm.click(2_500), "the next click arms again");
	}

	@Test
	void armingExpires() {
		TwoStepConfirm confirm = new TwoStepConfirm(3000, 300);
		confirm.click(0);
		assertFalse(confirm.isArmed(3_000));
		assertFalse(confirm.click(3_000), "too late: re-arms instead of confirming");
		assertTrue(confirm.click(4_000));
	}

	@Test
	void anImmediateSecondActivationIsIgnored() {
		TwoStepConfirm confirm = new TwoStepConfirm(3000, 300);
		confirm.click(10_000);
		assertFalse(confirm.click(10_030), "key repeat or double-click");
		assertTrue(confirm.isArmed(10_030), "still armed");
		assertTrue(confirm.click(10_400));
	}

	@Test
	void worksAtAnyClockValue() {
		TwoStepConfirm confirm = new TwoStepConfirm(3000, 300);
		assertFalse(confirm.click(Long.MIN_VALUE + 5));
		assertTrue(confirm.click(Long.MIN_VALUE + 1_005));
		assertFalse(confirm.click(5_000));
		assertFalse(confirm.isArmed(4_000), "a clock going backwards doesn't count as inside the window");
	}
}
