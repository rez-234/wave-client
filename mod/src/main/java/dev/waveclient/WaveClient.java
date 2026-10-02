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
import dev.waveclient.gui.PauseMenuButton;
import dev.waveclient.gui.menu.ModMenuScreen;
import dev.waveclient.gui.screen.HudEditorScreen;
import dev.waveclient.hud.HudLayer;
import dev.waveclient.input.KeybindDispatcher;
import dev.waveclient.mixin.LightTextureAccessor;
import dev.waveclient.module.Module;
import dev.waveclient.module.ModuleManager;
import dev.waveclient.module.ServerPolicy;
import dev.waveclient.module.impl.camera.ZoomModule;
import dev.waveclient.module.impl.hud.CoordinatesModule;
import dev.waveclient.module.impl.hud.FpsModule;
import dev.waveclient.module.impl.render.FullbrightModule;

public final class WaveClient implements ClientModInitializer {
	public static final String MOD_ID = "waveclient";
	public static final Logger LOGGER = LoggerFactory.getLogger("Wave Client");

	private static WaveClient instance;

	private final ModuleManager modules = new ModuleManager();
	private final ClientSettings clientSettings = new ClientSettings();
	private final KeybindDispatcher keybinds = new KeybindDispatcher();
	private final ServerPolicy serverPolicy = ServerPolicy.defaults();

	// Registration order is the order modules appear in lists and the config file.
	private final FullbrightModule fullbright = modules.register(new FullbrightModule());
	private final ZoomModule zoom = modules.register(new ZoomModule());
	private final FpsModule fps = modules.register(new FpsModule());
	private final CoordinatesModule coordinates = modules.register(new CoordinatesModule());

	private ConfigManager config;
	private boolean hudEditorRequested;
	private boolean menuRequested;

	/** The running client. Only valid after Fabric has called {@link #onInitializeClient()}. */
	public static WaveClient get() {
		return instance;
	}

	@Override
	public void onInitializeClient() {
		instance = this;

		// Opened on the next tick rather than inside the key event. The screens themselves ignore
		// the opening press's auto-repeats and release, and close only on a fresh press-and-release.
		clientSettings.hudEditorKey.onPress(() -> hudEditorRequested = true);
		clientSettings.modMenuKey.onPress(() -> menuRequested = true);
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
		HudLayer.register(modules, clientSettings);
		PauseMenuButton.register(this);
		fullbright.setLightmapInvalidator(WaveClient::invalidateLightmap);

		LOGGER.info("Wave Client {} initialized with {} modules; config at {}", version(), modules.all().size(), configFile);
	}

	private void onEndTick(Minecraft client) {
		if (!client.isWindowActive()) {
			// Key releases can be missed while unfocused, so don't leave anything held.
			keybinds.releaseAll();
		}

		modules.tick();
		config.tick();

		if (hudEditorRequested) {
			hudEditorRequested = false;

			if (client.screen == null && client.level != null && client.player != null) {
				client.setScreen(new HudEditorScreen(this));
			}
		}

		if (menuRequested) {
			menuRequested = false;

			if (client.screen == null && client.level != null) {
				client.setScreen(new ModMenuScreen(this, null));
			}
		}
	}

	private void applyServerPolicy(Minecraft client) {
		ServerData server = client.getCurrentServer();
		Map<String, String> blocked = serverPolicy.blockedModules(server != null ? server.ip : null);
		modules.applyBlocks(blocked);

		if (!blocked.isEmpty()) {
			LOGGER.info("Server policy disabled for this session: {}", blocked.keySet());
		}
	}

	private static void invalidateLightmap() {
		Minecraft client = Minecraft.getInstance();

		if (client != null && client.gameRenderer != null) {
			((LightTextureAccessor) (Object) client.gameRenderer.lightTexture()).waveclient$setUpdateLightTexture(true);
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

	public FullbrightModule fullbright() {
		return fullbright;
	}

	public ZoomModule zoom() {
		return zoom;
	}

	public FpsModule fps() {
		return fps;
	}

	public CoordinatesModule coordinates() {
		return coordinates;
	}
}
