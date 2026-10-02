package dev.waveclient.config;

import java.util.List;
import java.util.function.UnaryOperator;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

/**
 * Upgrades config files written by older versions.
 *
 * <p>To change the file's shape: bump {@link #CURRENT_VERSION} and append a step to
 * {@link #STEPS} that converts version N to N+1. Never edit a released step.
 */
final class ConfigMigrations {
	static final int CURRENT_VERSION = 1;

	/** {@code STEPS.get(i)} upgrades schema version {@code i + 1} to {@code i + 2}. */
	static final List<UnaryOperator<JsonObject>> STEPS = List.of();

	private ConfigMigrations() {
	}

	/** @return the schema version written in the file; files without one are version 1 */
	static int versionOf(JsonObject root) {
		JsonElement version = root.get("schemaVersion");

		if (version != null && version.isJsonPrimitive() && version.getAsJsonPrimitive().isNumber()) {
			return Math.max(1, version.getAsInt());
		}

		return 1;
	}

	/**
	 * Runs every step from the file's version up to {@code targetVersion}. Files from a newer
	 * version are returned unchanged and read on a best-effort basis.
	 */
	static JsonObject migrate(JsonObject root, int targetVersion, List<UnaryOperator<JsonObject>> steps) {
		int version = versionOf(root);
		JsonObject current = root;

		while (version < targetVersion) {
			current = steps.get(version - 1).apply(current);
			version++;
			current.addProperty("schemaVersion", version);
		}

		return current;
	}

	static JsonObject migrate(JsonObject root) {
		return migrate(root, CURRENT_VERSION, STEPS);
	}
}
