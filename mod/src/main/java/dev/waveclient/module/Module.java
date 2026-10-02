package dev.waveclient.module;

import java.util.Objects;
import java.util.regex.Pattern;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import dev.waveclient.input.Keybind;
import dev.waveclient.setting.KeybindSetting;

/**
 * Base class for every toggleable feature.
 *
 * <p>A module is <em>enabled</em> when the user turned it on (this is saved), and <em>active</em>
 * when it is enabled, not blocked by the current server's policy, and the client has finished
 * starting. Hooks and mixins must check {@link #isActive()}. {@link #onEnable()} and
 * {@link #onDisable()} run when the active state changes, so a module blocked on one server
 * is cleanly disabled and re-enabled on the next.
 */
public abstract class Module extends SettingContainer {
	private static final Logger LOGGER = LoggerFactory.getLogger("Wave Client");
	private static final Pattern ID_PATTERN = Pattern.compile("[a-z][a-z0-9_]*");
	private static final Runnable NOTHING = () -> { };

	private final String id;
	private final String name;
	private final String description;
	private final Category category;

	/** Turns the module on or off. Every module has one; unbound by default. */
	public final KeybindSetting toggleKey;

	private boolean defaultEnabled;
	private boolean enabled;
	private String blockedReason;
	private boolean started;
	private boolean active;
	private Runnable activationListener = NOTHING;

	// add() captures 'this' in listeners, but they only run on later changes, never during construction.
	@SuppressWarnings("this-escape")
	protected Module(String id, String name, String description, Category category) {
		if (!ID_PATTERN.matcher(Objects.requireNonNull(id, "id")).matches()) {
			throw new IllegalArgumentException("Invalid module id: " + id);
		}

		this.id = id;
		this.name = Objects.requireNonNull(name, "name");
		this.description = Objects.requireNonNull(description, "description");
		this.category = Objects.requireNonNull(category, "category");
		this.toggleKey = add(new KeybindSetting("toggleKey", "Toggle key", Keybind.NONE)
				.describe("Turns " + name + " on or off.")
				.onPress(this::toggle));
	}

	/** Call from a subclass constructor to make the module start enabled on a fresh config. */
	protected final void setDefaultEnabled(boolean defaultEnabled) {
		this.defaultEnabled = defaultEnabled;
		this.enabled = defaultEnabled;
	}

	public final String id() {
		return id;
	}

	public final String name() {
		return name;
	}

	public final String description() {
		return description;
	}

	public final Category category() {
		return category;
	}

	/** What the user chose. Saved to the config. */
	public final boolean isEnabled() {
		return enabled;
	}

	/** Whether the module is running right now. This is what hooks check. */
	public final boolean isActive() {
		return active;
	}

	public final boolean isBlocked() {
		return blockedReason != null;
	}

	/** Why the current server disallows this module, or {@code null}. */
	public final String blockedReason() {
		return blockedReason;
	}

	public final boolean defaultEnabled() {
		return defaultEnabled;
	}

	public final void setEnabled(boolean enabled) {
		if (this.enabled == enabled) {
			return;
		}

		this.enabled = enabled;
		markDirty();
		refreshActive();
	}

	public final void toggle() {
		setEnabled(!enabled);
	}

	/** Restores the default enabled state and every setting's default. */
	public final void resetToDefaults() {
		setEnabled(defaultEnabled);
		resetSettings();
	}

	/** Runs when the module becomes active. */
	protected void onEnable() {
	}

	/** Runs when the module stops being active. Undo anything {@link #onEnable()} changed. */
	protected void onDisable() {
	}

	/** Runs at the end of every client tick while active. */
	protected void onTick() {
	}

	/** Writes extra state (such as a HUD position) next to {@code enabled} and {@code settings}. */
	protected void saveExtra(JsonObject moduleJson) {
	}

	/** Reads what {@link #saveExtra(JsonObject)} wrote. Must tolerate missing or malformed data. */
	protected void loadExtra(JsonObject moduleJson) {
	}

	// Called by ModuleManager.

	final void setActivationListener(Runnable listener) {
		this.activationListener = Objects.requireNonNull(listener, "listener");
	}

	final void start() {
		started = true;
		refreshActive();
	}

	final void setBlockedReason(String reason) {
		if (!Objects.equals(blockedReason, reason)) {
			blockedReason = reason;
			refreshActive();
		}
	}

	final void tick() {
		try {
			onTick();
		} catch (RuntimeException e) {
			LOGGER.error("Module '{}' failed during tick; disabling it", id, e);
			setEnabled(false);
		}
	}

	// Persistence.

	public final JsonObject toJson() {
		JsonObject json = new JsonObject();
		json.addProperty("enabled", enabled);
		json.add("settings", settingsToJson());
		saveExtra(json);
		return json;
	}

	/** Applies saved state. Anything missing keeps its current value; anything malformed is ignored. */
	public final void fromJson(JsonObject json) {
		JsonElement enabledJson = json.get("enabled");

		if (enabledJson != null && enabledJson.isJsonPrimitive() && enabledJson.getAsJsonPrimitive().isBoolean()) {
			setEnabled(enabledJson.getAsBoolean());
		}

		if (json.get("settings") instanceof JsonObject settingsJson) {
			settingsFromJson(settingsJson);
		}

		try {
			loadExtra(json);
		} catch (RuntimeException e) {
			LOGGER.warn("Ignoring invalid saved data for module '{}'", id, e);
		}
	}

	private void refreshActive() {
		boolean shouldBeActive = started && enabled && blockedReason == null;

		if (shouldBeActive == active) {
			return;
		}

		active = shouldBeActive;

		try {
			if (shouldBeActive) {
				onEnable();
			} else {
				onDisable();
			}
		} catch (RuntimeException e) {
			LOGGER.error("Module '{}' failed to {}", id, shouldBeActive ? "enable" : "disable", e);

			if (shouldBeActive) {
				active = false;
			}
		}

		activationListener.run();
	}

	@Override
	public String toString() {
		return "Module[" + id + (active ? ", active" : enabled ? ", enabled" : "") + "]";
	}
}
