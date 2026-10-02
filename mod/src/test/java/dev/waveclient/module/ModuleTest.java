package dev.waveclient.module;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;

import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.testutil.TestModule;

class ModuleTest {
	@Test
	void enablingBeforeStartOnlyRecordsState() {
		ModuleManager manager = new ModuleManager();
		TestModule module = manager.register(new TestModule("zoom"));

		module.setEnabled(true);
		assertTrue(module.isEnabled());
		assertFalse(module.isActive());
		assertEquals(0, module.enables);

		manager.start();
		assertTrue(module.isActive());
		assertEquals(1, module.enables);
		assertArrayEquals(new Module[] {module}, manager.active());
	}

	@Test
	void togglingCallsLifecycleOnce() {
		ModuleManager manager = new ModuleManager();
		TestModule module = manager.register(new TestModule("zoom"));
		manager.start();

		module.toggle();
		module.setEnabled(true);
		module.toggle();
		assertEquals(1, module.enables);
		assertEquals(1, module.disables);
		assertEquals(0, manager.active().length);
	}

	@Test
	void serverBlockDisablesWithoutChangingSavedState() {
		ModuleManager manager = new ModuleManager();
		TestModule freelook = manager.register(new TestModule("freelook", true));
		TestModule zoom = manager.register(new TestModule("zoom", true) { });
		manager.start();

		manager.applyBlocks(Map.of("freelook", "Not allowed here"));
		assertTrue(freelook.isEnabled());
		assertFalse(freelook.isActive());
		assertTrue(freelook.isBlocked());
		assertEquals("Not allowed here", freelook.blockedReason());
		assertEquals(1, freelook.disables);
		assertTrue(zoom.isActive());

		// Toggling while blocked changes the saved choice but doesn't activate.
		freelook.toggle();
		freelook.toggle();
		assertFalse(freelook.isActive());
		assertEquals(1, freelook.enables);

		manager.clearBlocks();
		assertTrue(freelook.isActive());
		assertEquals(2, freelook.enables);
	}

	@Test
	void failingEnableLeavesModuleInactive() {
		ModuleManager manager = new ModuleManager();
		TestModule module = manager.register(new TestModule("broken", true));
		module.failOnEnable = new IllegalStateException("boom");

		manager.start();
		assertTrue(module.isEnabled());
		assertFalse(module.isActive());
		assertEquals(0, manager.active().length);
	}

	@Test
	void failingTickDisablesModule() {
		ModuleManager manager = new ModuleManager();
		TestModule good = manager.register(new TestModule("good", true));
		TestModule bad = manager.register(new TestModule("bad", true) { });
		manager.start();
		bad.failOnTick = new IllegalStateException("boom");

		manager.tick();
		assertEquals(1, good.ticks);
		assertFalse(bad.isEnabled());
		assertFalse(bad.isActive());

		manager.tick();
		assertEquals(2, good.ticks);
		assertEquals(1, bad.ticks);
	}

	@Test
	void onlyActiveModulesTick() {
		ModuleManager manager = new ModuleManager();
		TestModule on = manager.register(new TestModule("on", true));
		TestModule off = manager.register(new TestModule("off") { });
		manager.start();
		manager.tick();
		assertEquals(1, on.ticks);
		assertEquals(0, off.ticks);
	}

	@Test
	void registrationAfterStartActivates() {
		ModuleManager manager = new ModuleManager();
		manager.start();
		TestModule late = manager.register(new TestModule("late", true));
		assertTrue(late.isActive());
	}

	@Test
	void lookupAndValidation() {
		ModuleManager manager = new ModuleManager();
		TestModule module = manager.register(new TestModule("zoom"));

		assertSame(module, manager.byId("zoom"));
		assertSame(module, manager.get(TestModule.class));
		assertEquals(1, manager.byCategory(Category.MISC).size());
		assertThrows(IllegalArgumentException.class, () -> manager.register(new TestModule("zoom") { }));
		assertThrows(IllegalArgumentException.class, () -> manager.register(new TestModule("other")));
		assertThrows(IllegalArgumentException.class, () -> new TestModule("Bad-Id"));
	}

	@Test
	void duplicateSettingIdsAreRejected() {
		class Broken extends TestModule {
			Broken() {
				super("broken");
				add(new BooleanSetting("flag", "Again", false));
			}
		}

		assertThrows(IllegalArgumentException.class, Broken::new);
	}

	@Test
	void changesReachTheChangeSink() {
		AtomicInteger dirty = new AtomicInteger();
		ModuleManager manager = new ModuleManager();
		manager.setChangeSink(dirty::incrementAndGet);
		TestModule module = manager.register(new TestModule("zoom"));

		module.toggle();
		module.amount.set(3.0);
		module.amount.set(3.0);
		assertEquals(2, dirty.get());
	}

	@Test
	void toggleKeyTogglesModule() {
		ModuleManager manager = new ModuleManager();
		TestModule module = manager.register(new TestModule("zoom"));
		manager.start();

		module.toggleKey.press();
		assertTrue(module.isActive());
		module.toggleKey.release();
		module.toggleKey.press();
		assertFalse(module.isActive());
	}

	@Test
	void resetToDefaults() {
		TestModule module = new TestModule("zoom", true);
		module.setEnabled(false);
		module.flag.set(true);
		module.extra = 7;
		module.resetToDefaults();
		assertTrue(module.isEnabled());
		assertFalse(module.flag.get());
		assertEquals(-1, module.extra, "extra state such as HUD positions is reset too");
	}
}
