package dev.waveclient.module;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import dev.waveclient.setting.Setting;

/** An ordered group of settings that is saved as one JSON object. */
public abstract class SettingContainer {
	private static final Runnable NOTHING = () -> { };

	private final List<Setting<?>> settings = new ArrayList<>();
	private final List<Setting<?>> settingsView = Collections.unmodifiableList(settings);
	private final Map<String, Setting<?>> byId = new HashMap<>();
	private Runnable changeSink = NOTHING;

	/** Registers a setting. Call from the constructor; order here is the order in the GUI. */
	protected final <S extends Setting<S>> S add(S setting) {
		Objects.requireNonNull(setting, "setting");

		if (byId.putIfAbsent(setting.id(), setting) != null) {
			throw new IllegalArgumentException("Duplicate setting id '" + setting.id() + "' in " + getClass().getName());
		}

		settings.add(setting);
		setting.onChange(() -> {
			onSettingChanged(setting);
			markDirty();
		});
		return setting;
	}

	public final List<Setting<?>> settings() {
		return settingsView;
	}

	/** @return the setting with this id, or {@code null} */
	public final Setting<?> setting(String id) {
		return byId.get(id);
	}

	public void resetSettings() {
		for (Setting<?> setting : settings) {
			setting.reset();
		}
	}

	public final JsonObject settingsToJson() {
		JsonObject json = new JsonObject();

		for (Setting<?> setting : settings) {
			json.add(setting.id(), setting.toJson());
		}

		return json;
	}

	/** Applies saved values. Unknown keys are ignored; missing or malformed values keep the current value. */
	public final void settingsFromJson(JsonObject json) {
		for (Setting<?> setting : settings) {
			JsonElement value = json.get(setting.id());

			if (value != null) {
				try {
					setting.fromJson(value);
				} catch (RuntimeException ignored) {
					// A malformed value keeps the current one.
				}
			}
		}
	}

	/** Called after one of this container's settings changes. */
	protected void onSettingChanged(Setting<?> setting) {
	}

	/** Tells the config system that something in this container needs saving. */
	protected final void markDirty() {
		changeSink.run();
	}

	/** Set by whoever persists this container (the config manager). */
	public final void setChangeSink(Runnable sink) {
		this.changeSink = Objects.requireNonNull(sink, "sink");
	}
}
