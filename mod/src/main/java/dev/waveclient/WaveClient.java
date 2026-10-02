package dev.waveclient;

import java.nio.file.Path;
import java.util.Map;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import dev.waveclient.command.WaveCommand;
import dev.waveclient.config.ConfigManager;
import dev.waveclient.input.KeybindDispatcher;
import dev.waveclient.module.Module;
import dev.waveclient.module.ModuleManager;
import dev.waveclient.module.ServerPolicy;

public final class WaveClient implements ClientModInitializer {
	public static final String MOD_ID = "waveclient";
	public static final Logger LOGGER = LoggerFactory.getLogger("Wave Client");

	private static WaveClient instance;

	private final ModuleManager modules = new ModuleManager();
	private final ClientSettings clientSettings = new ClientSettings();
	private final KeybindDispatcher keybinds = new KeybindDispatcher();
	private final ServerPolicy serverPolicy = ServerPolicy.defaults();
	private ConfigManager config;

	/** The running client. Only valid after Fabric has called {@link #onInitializeClient()}. */
	public static WaveClient get() {
		return instance;
	}

	@Override
	public void onInitializeClient() {
		instance = this;

		keybinds.registerAll(clientSettings);

		for (Module module : modules.all()) {
			keybinds.registerAll(module);
		}

		Path configFile = FabricLoader.getInstance().getConfigDir().resolve(MOD_ID).resolve("config.json");
		config = new ConfigManager(configFile, clientSettings, modules);
		clientSettings.setChangeSink(config::markDirty);
		modules.setChangeSink(config::markDirty);
		config.load();

		ClientLifecycleEvents.CLIENT_STARTED.register(client -> modules.start());
		ClientLifecycleEvents.CLIENT_STOPPING.register(client -> config.close());
		ClientTickEvents.END_CLIENT_TICK.register(this::onEndTick);
		ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> client.execute(() -> applyServerPolicy(client)));
		ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> client.execute(modules::clearBlocks));
		ClientCommandRegistrationCallback.EVENT.register((dispatcher, buildContext) -> WaveCommand.register(dispatcher, this));

		LOGGER.info("Wave Client {} initialized with {} modules; config at {}", version(), modules.all().size(), configFile);
	}

	private void onEndTick(Minecraft client) {
		if (!client.isWindowActive()) {
			// Key releases can be missed while unfocused, so don't leave anything held.
			keybinds.releaseAll();
		}

		modules.tick();
		config.tick();
	}

	private void applyServerPolicy(Minecraft client) {
		ServerData server = client.getCurrentServer();
		Map<String, String> blocked = serverPolicy.blockedModules(server != null ? server.ip : null);
		modules.applyBlocks(blocked);

		if (!blocked.isEmpty()) {
			LOGGER.info("Server policy disabled for this session: {}", blocked.keySet());
		}
	}

	public static String version() {
		return FabricLoader.getInstance().getModContainer(MOD_ID)
				.map(container -> container.getMetadata().getVersion().getFriendlyString())
				.orElse("unknown");
	}

	public ModuleManager modules() {
		return modules;
	}

	public ClientSettings clientSettings() {
		return clientSettings;
	}

	public KeybindDispatcher keybinds() {
		return keybinds;
	}

	public ConfigManager config() {
		return config;
	}
}
