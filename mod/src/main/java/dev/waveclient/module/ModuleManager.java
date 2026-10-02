package dev.waveclient.module;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Owns every module, keeps a prebuilt array of the active ones for ticking, and applies
 * server policy.
 */
public final class ModuleManager {
	private static final Module[] NONE = new Module[0];

	private final List<Module> modules = new ArrayList<>();
	private final List<Module> modulesView = Collections.unmodifiableList(modules);
	private final Map<String, Module> byId = new HashMap<>();
	private final Map<Class<?>, Module> byType = new HashMap<>();
	private Module[] active = NONE;
	private int activeVersion;
	private boolean started;
	private Runnable changeSink = () -> { };

	public <M extends Module> M register(M module) {
		Objects.requireNonNull(module, "module");

		if (byId.containsKey(module.id())) {
			throw new IllegalArgumentException("Duplicate module id: " + module.id());
		}

		if (byType.containsKey(module.getClass())) {
			throw new IllegalArgumentException("Module class registered twice: " + module.getClass().getName());
		}

		modules.add(module);
		byId.put(module.id(), module);
		byType.put(module.getClass(), module);
		module.setChangeSink(() -> changeSink.run());
		module.setActivationListener(this::rebuildActive);

		if (started) {
			module.start();
		}

		return module;
	}

	/** Activates enabled modules. Call once the game has finished starting. */
	public void start() {
		if (started) {
			return;
		}

		started = true;

		for (Module module : modules) {
			module.start();
		}

		rebuildActive();
	}

	public boolean isStarted() {
		return started;
	}

	/** Runs {@link Module#onTick()} for every active module. */
	public void tick() {
		// Iterate a snapshot: a module toggled during the loop replaces the array instead of mutating it.
		Module[] snapshot = active;

		for (Module module : snapshot) {
			module.tick();
		}
	}

	/** All modules in registration order. */
	public List<Module> all() {
		return modulesView;
	}

	/** @return the module with this id, or {@code null} */
	public Module byId(String id) {
		return byId.get(id);
	}

	/** @return the registered instance of this module class */
	public <M extends Module> M get(Class<M> type) {
		Module module = byType.get(type);

		if (module == null) {
			throw new IllegalArgumentException("Module not registered: " + type.getName());
		}

		return type.cast(module);
	}

	public List<Module> byCategory(Category category) {
		List<Module> result = new ArrayList<>();

		for (Module module : modules) {
			if (module.category() == category) {
				result.add(module);
			}
		}

		return result;
	}

	/** Active modules right now. Do not modify the returned array. */
	public Module[] active() {
		return active;
	}

	/**
	 * Changes whenever the set of active modules changes. Lets callers cache something derived
	 * from {@link #active()} and rebuild it only when this number moves.
	 */
	public int activeVersion() {
		return activeVersion;
	}

	/** Forces off the modules the server disallows; every other module is unblocked. */
	public void applyBlocks(Map<String, String> reasonsByModuleId) {
		for (Module module : modules) {
			module.setBlockedReason(reasonsByModuleId.get(module.id()));
		}
	}

	public void clearBlocks() {
		applyBlocks(Map.of());
	}

	/** Receives a notification whenever any module's saved state changes. */
	public void setChangeSink(Runnable sink) {
		this.changeSink = Objects.requireNonNull(sink, "sink");
	}

	private void rebuildActive() {
		List<Module> now = new ArrayList<>(modules.size());

		for (Module module : modules) {
			if (module.isActive()) {
				now.add(module);
			}
		}

		active = now.toArray(NONE);
		activeVersion++;
	}
}
