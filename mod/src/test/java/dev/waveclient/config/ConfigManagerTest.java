package dev.waveclient.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.UnaryOperator;
import java.util.stream.Stream;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import dev.waveclient.input.Keybind;
import dev.waveclient.module.ModuleManager;
import dev.waveclient.module.SettingContainer;
import dev.waveclient.setting.KeybindSetting;
import dev.waveclient.testutil.TestModule;

class ConfigManagerTest {
	@TempDir
	Path dir;

	private final AtomicLong now = new AtomicLong();

	static final class Client extends SettingContainer {
		final KeybindSetting editorKey = add(new KeybindSetting("hudEditorKey", "HUD editor key", Keybind.key(344)));
	}

	/** A fresh client + module set wired to a config manager, as the game does it. */
	final class Harness {
		final Client client = new Client();
		final ModuleManager modules = new ModuleManager();
		final TestModule zoom = modules.register(new TestModule("zoom"));
		final TestModule hud = modules.register(new TestModule("fps", true) { });
		final ConfigManager config;

		Harness() {
			this(Runnable::run);
		}

		Harness(Executor writer) {
			config = new ConfigManager(dir.resolve("waveclient/config.json"), client, modules, now::get, writer);
			client.setChangeSink(config::markDirty);
			modules.setChangeSink(config::markDirty);
		}
	}

	private Path file() {
		return dir.resolve("waveclient/config.json");
	}

	private JsonObject readFile() throws IOException {
		return JsonParser.parseString(Files.readString(file())).getAsJsonObject();
	}

	@Test
	void firstLoadWritesDefaults() throws IOException {
		Harness h = new Harness();
		h.config.load();

		assertTrue(Files.exists(file()));
		JsonObject root = readFile();
		assertEquals(1, root.get("schemaVersion").getAsInt());
		assertEquals("key:rshift", root.getAsJsonObject("client").get("hudEditorKey").getAsString());
		assertFalse(root.getAsJsonObject("modules").getAsJsonObject("zoom").get("enabled").getAsBoolean());
		assertTrue(root.getAsJsonObject("modules").getAsJsonObject("fps").get("enabled").getAsBoolean());
		assertFalse(h.config.isDirty());
	}

	@Test
	void valuesSurviveARoundTrip() {
		Harness first = new Harness();
		first.config.load();
		first.zoom.setEnabled(true);
		first.zoom.amount.set(7.5);
		first.zoom.color.set(0x805B8CFF);
		first.zoom.toggleKey.set(Keybind.key(67));
		first.zoom.extra = 42;
		first.hud.setEnabled(false);
		first.client.editorKey.set(Keybind.mouse(4));
		first.config.saveNow();

		Harness second = new Harness();
		second.config.load();
		assertTrue(second.zoom.isEnabled());
		assertEquals(7.5, second.zoom.amount.get());
		assertEquals(0x805B8CFF, second.zoom.color.get());
		assertEquals(Keybind.key(67), second.zoom.toggleKey.get());
		assertEquals(42, second.zoom.extra);
		assertFalse(second.hud.isEnabled());
		assertEquals(Keybind.mouse(4), second.client.editorKey.get());
		assertFalse(second.config.isDirty(), "loading must not mark the config dirty");
	}

	@Test
	void corruptFileIsMovedAsideAndDefaultsLoad() throws IOException {
		Files.createDirectories(file().getParent());
		Files.writeString(file(), "{ this is not json", StandardCharsets.UTF_8);

		Harness h = new Harness();
		h.zoom.setEnabled(true);
		h.config.load();

		assertFalse(h.zoom.isEnabled());
		assertTrue(readFile().has("modules"));

		try (Stream<Path> files = Files.list(file().getParent())) {
			List<Path> backups = files.filter(p -> p.getFileName().toString().startsWith("config.json.corrupt-")).toList();
			assertEquals(1, backups.size());
			assertEquals("{ this is not json", Files.readString(backups.get(0)));
		}
	}

	@Test
	void nonObjectRootCountsAsCorrupt() throws IOException {
		Files.createDirectories(file().getParent());
		Files.writeString(file(), "[1, 2, 3]");

		Harness h = new Harness();
		h.config.load();
		assertTrue(readFile().has("schemaVersion"));
	}

	@Test
	void malformedValuesAndUnknownKeysAreIgnored() throws IOException {
		Files.createDirectories(file().getParent());
		Files.writeString(file(), """
				{
				  "schemaVersion": 1,
				  "somethingNew": true,
				  "client": { "hudEditorKey": 12345 },
				  "modules": {
				    "zoom": { "enabled": "yes", "settings": { "amount": "lots", "flag": true, "nope": 1, "color": "#zzzzzz" } },
				    "fps": "not an object"
				  }
				}
				""");

		Harness h = new Harness();
		h.config.load();
		assertFalse(h.zoom.isEnabled());
		assertEquals(1.0, h.zoom.amount.get());
		assertTrue(h.zoom.flag.get());
		assertEquals(0xFFFFFFFF, h.zoom.color.get());
		assertTrue(h.hud.isEnabled());
		assertEquals(Keybind.key(344), h.client.editorKey.get());
	}

	@Test
	void unknownModulesArePreserved() throws IOException {
		Files.createDirectories(file().getParent());
		Files.writeString(file(), """
				{ "schemaVersion": 1, "modules": { "futuremodule": { "enabled": true, "settings": { "x": 3 } } } }
				""");

		Harness h = new Harness();
		h.config.load();
		h.config.saveNow();

		JsonObject future = readFile().getAsJsonObject("modules").getAsJsonObject("futuremodule");
		assertTrue(future.get("enabled").getAsBoolean());
		assertEquals(3, future.getAsJsonObject("settings").get("x").getAsInt());
	}

	@Test
	void reloadResetsValuesMissingFromTheFile() throws IOException {
		Harness h = new Harness();
		h.config.load();
		h.zoom.flag.set(true);
		h.config.saveNow();

		Files.writeString(file(), "{ \"schemaVersion\": 1, \"modules\": {} }");
		h.config.load();
		assertFalse(h.zoom.flag.get());
	}

	@Test
	void savesAreDebounced() throws IOException {
		Harness h = new Harness();
		h.config.load();
		String before = Files.readString(file());

		now.set(10_000);
		h.zoom.flag.set(true);
		assertTrue(h.config.isDirty());

		now.set(10_000 + ConfigManager.SAVE_DELAY_MS - 1);
		h.config.tick();
		assertEquals(before, Files.readString(file()));

		// Another change pushes the save back.
		h.zoom.amount.set(2.0);
		now.addAndGet(ConfigManager.SAVE_DELAY_MS - 1);
		h.config.tick();
		assertEquals(before, Files.readString(file()));

		now.addAndGet(1);
		h.config.tick();
		assertFalse(h.config.isDirty());
		JsonObject zoom = readFile().getAsJsonObject("modules").getAsJsonObject("zoom").getAsJsonObject("settings");
		assertTrue(zoom.get("flag").getAsBoolean());
		assertEquals(2.0, zoom.get("amount").getAsDouble());
	}

	@Test
	void olderSnapshotNeverOverwritesNewer() throws IOException {
		List<Runnable> queued = new ArrayList<>();
		Harness h = new Harness(queued::add);
		h.config.load();

		h.zoom.amount.set(2.0);
		h.config.saveAsync();
		h.zoom.amount.set(9.0);
		h.config.saveNow();

		queued.forEach(Runnable::run);
		double saved = readFile().getAsJsonObject("modules").getAsJsonObject("zoom")
				.getAsJsonObject("settings").get("amount").getAsDouble();
		assertEquals(9.0, saved);
	}

	@Test
	void closeFlushesPendingChanges() throws IOException {
		Harness h = new Harness();
		h.config.load();
		h.zoom.flag.set(true);
		h.config.close();
		assertTrue(readFile().getAsJsonObject("modules").getAsJsonObject("zoom")
				.getAsJsonObject("settings").get("flag").getAsBoolean());
	}

	@Test
	void savesAfterCloseBypassTheWriterThread() throws IOException {
		Harness h = new Harness(task -> {
			throw new RejectedExecutionException("writer is shut down");
		});
		h.config.load();
		h.config.close();

		h.zoom.flag.set(true);
		now.addAndGet(ConfigManager.SAVE_DELAY_MS);
		h.config.tick();
		assertTrue(readFile().getAsJsonObject("modules").getAsJsonObject("zoom")
				.getAsJsonObject("settings").get("flag").getAsBoolean());
	}

	@Test
	void migrationsRunInOrder() {
		JsonObject v1 = JsonParser.parseString("{ \"schemaVersion\": 1, \"a\": 1 }").getAsJsonObject();
		List<UnaryOperator<JsonObject>> steps = List.of(
				root -> {
					root.addProperty("b", root.get("a").getAsInt() + 1);
					return root;
				},
				root -> {
					root.addProperty("c", root.get("b").getAsInt() * 10);
					return root;
				});

		JsonObject migrated = ConfigMigrations.migrate(v1, 3, steps);
		assertEquals(3, migrated.get("schemaVersion").getAsInt());
		assertEquals(20, migrated.get("c").getAsInt());

		JsonObject unversioned = new JsonObject();
		assertEquals(1, ConfigMigrations.versionOf(unversioned));

		JsonObject newer = JsonParser.parseString("{ \"schemaVersion\": 99 }").getAsJsonObject();
		assertEquals(99, ConfigMigrations.migrate(newer, 3, steps).get("schemaVersion").getAsInt());
	}
}
