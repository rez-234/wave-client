package dev.waveclient.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import dev.waveclient.module.Module;
import dev.waveclient.module.ModuleManager;
import dev.waveclient.module.SettingContainer;

/**
 * Loads and saves {@code config.json}.
 *
 * <p>Saving is debounced: changes mark the config dirty and it is written once nothing has
 * changed for {@link #SAVE_DELAY_MS}. The JSON snapshot is built on the calling (game) thread
 * and written on a background thread through an atomic replace. Snapshots carry a sequence
 * number so an older snapshot can never overwrite a newer one.
 *
 * <p>File shape:
 * <pre>{@code
 * { "schemaVersion": 1,
 *   "client":  { "<setting>": value, ... },
 *   "modules": { "<module id>": { "enabled": true, "settings": { ... }, ...extra } } }
 * }</pre>
 */
public final class ConfigManager implements AutoCloseable {
	public static final long SAVE_DELAY_MS = 1000;

	private static final Logger LOGGER = LoggerFactory.getLogger("Wave Client");
	private static final DateTimeFormatter BACKUP_STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

	private final Path file;
	private final SettingContainer client;
	private final ModuleManager modules;
	private final LongSupplier clock;
	private final Executor writer;
	private final ExecutorService ownedWriter;
	private final Gson gson = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();
	private final Object writeLock = new Object();

	/** Entries for modules this build doesn't know (e.g. after a downgrade), kept so they aren't lost. */
	private JsonObject unknownModules = new JsonObject();
	private boolean loading;
	private boolean closed;
	private boolean dirty;
	private long lastChange;
	private long snapshotSeq;
	private long writtenSeq; // guarded by writeLock

	public ConfigManager(Path file, SettingContainer client, ModuleManager modules) {
		this(file, client, modules, System::currentTimeMillis, null);
	}

	/** For tests: a custom clock and, optionally, the executor that performs writes. */
	ConfigManager(Path file, SettingContainer client, ModuleManager modules, LongSupplier clock, Executor writer) {
		this.file = file;
		this.client = client;
		this.modules = modules;
		this.clock = clock;

		if (writer != null) {
			this.writer = writer;
			this.ownedWriter = null;
		} else {
			this.ownedWriter = Executors.newSingleThreadExecutor(runnable -> {
				Thread thread = new Thread(runnable, "Wave Client config writer");
				thread.setDaemon(true);
				return thread;
			});
			this.writer = ownedWriter;
		}
	}

	public Path file() {
		return file;
	}

	/**
	 * Resets everything to defaults, then applies the file. A missing file is created with
	 * defaults; an unreadable one is moved aside and replaced with defaults.
	 */
	public void load() {
		loading = true;

		try {
			resetToDefaults();
			unknownModules = new JsonObject();

			if (Files.notExists(file)) {
				LOGGER.info("No config at {}; writing defaults", file);
				saveNow();
				return;
			}

			JsonObject root;

			try {
				JsonElement parsed = JsonParser.parseString(Files.readString(file, StandardCharsets.UTF_8));

				if (!(parsed instanceof JsonObject object)) {
					throw new JsonParseException("Top level is not a JSON object");
				}

				root = object;
			} catch (IOException | JsonParseException e) {
				Path backup = moveAside();
				LOGGER.error("Could not read {}; moved it to {} and loaded defaults", file, backup, e);
				saveNow();
				return;
			}

			int version = ConfigMigrations.versionOf(root);

			if (version > ConfigMigrations.CURRENT_VERSION) {
				LOGGER.warn("{} was written by a newer version of Wave Client (schema {}); reading what we can", file, version);
			}

			apply(ConfigMigrations.migrate(root));

			if (version < ConfigMigrations.CURRENT_VERSION) {
				LOGGER.info("Upgraded {} from schema {} to {}", file, version, ConfigMigrations.CURRENT_VERSION);
				saveNow();
			}
		} finally {
			loading = false;
		}
	}

	/** Called whenever a setting or module state changes. */
	public void markDirty() {
		if (loading) {
			return;
		}

		dirty = true;
		lastChange = clock.getAsLong();
	}

	public boolean isDirty() {
		return dirty;
	}

	/** Call every client tick; saves once changes have settled. */
	public void tick() {
		if (dirty && clock.getAsLong() - lastChange >= SAVE_DELAY_MS) {
			saveAsync();
		}
	}

	/** Snapshots now and writes in the background (or right away, once closed). */
	public void saveAsync() {
		if (closed) {
			saveNow();
			return;
		}

		dirty = false;
		long seq = ++snapshotSeq;
		String json = serialize();
		writer.execute(() -> write(seq, json));
	}

	/** Snapshots and writes on the calling thread. */
	public void saveNow() {
		dirty = false;
		write(++snapshotSeq, serialize());
	}

	/** Flushes pending changes and stops the writer thread. Call when the game shuts down. */
	@Override
	public void close() {
		if (closed) {
			return;
		}

		closed = true;

		if (dirty) {
			saveNow();
		}

		if (ownedWriter != null) {
			ownedWriter.shutdown();

			try {
				if (!ownedWriter.awaitTermination(5, TimeUnit.SECONDS)) {
					LOGGER.warn("Timed out waiting for the config writer");
				}
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			}
		}
	}

	JsonObject toJson() {
		JsonObject root = new JsonObject();
		root.addProperty("schemaVersion", ConfigMigrations.CURRENT_VERSION);
		root.add("client", client.settingsToJson());

		JsonObject modulesJson = new JsonObject();

		for (Module module : modules.all()) {
			modulesJson.add(module.id(), module.toJson());
		}

		for (Map.Entry<String, JsonElement> entry : unknownModules.entrySet()) {
			if (!modulesJson.has(entry.getKey())) {
				modulesJson.add(entry.getKey(), entry.getValue().deepCopy());
			}
		}

		root.add("modules", modulesJson);
		return root;
	}

	private void apply(JsonObject root) {
		if (root.get("client") instanceof JsonObject clientJson) {
			client.settingsFromJson(clientJson);
		}

		if (root.get("modules") instanceof JsonObject modulesJson) {
			for (Map.Entry<String, JsonElement> entry : modulesJson.entrySet()) {
				Module module = modules.byId(entry.getKey());

				if (module == null) {
					unknownModules.add(entry.getKey(), entry.getValue());
				} else if (entry.getValue() instanceof JsonObject moduleJson) {
					module.fromJson(moduleJson);
				}
			}
		}
	}

	private void resetToDefaults() {
		client.resetSettings();

		for (Module module : modules.all()) {
			module.resetToDefaults();
		}
	}

	private String serialize() {
		return gson.toJson(toJson());
	}

	private void write(long seq, String json) {
		synchronized (writeLock) {
			if (seq <= writtenSeq) {
				return;
			}

			try {
				AtomicFiles.writeString(file, json);
				writtenSeq = seq;
			} catch (IOException e) {
				LOGGER.error("Failed to save {}", file, e);
			}
		}
	}

	private Path moveAside() {
		Path backup = file.resolveSibling(file.getFileName() + ".corrupt-" + LocalDateTime.now().format(BACKUP_STAMP));

		try {
			Files.move(file, backup, StandardCopyOption.REPLACE_EXISTING);
		} catch (IOException e) {
			LOGGER.error("Could not move unreadable config {} aside", file, e);
		}

		return backup;
	}
}
