package dev.waveclient.gametest;

import java.lang.reflect.Field;
import java.util.Collection;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.network.Connection;
import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * While a test world loads, logs every 5 seconds how far the client and the integrated server
 * have got (server ready, login or configuration step, packets in flight), so a world that never
 * finishes loading in CI shows where it stopped. Logs nothing when loading is quick.
 */
final class WorldLoadProbe {
	private static final Logger LOGGER = LoggerFactory.getLogger("Wave Client game test");
	private static final int INTERVAL_TICKS = 100;
	private static int waitingTicks;

	private WorldLoadProbe() {
	}

	static void register() {
		ClientTickEvents.END_CLIENT_TICK.register(WorldLoadProbe::onTick);
	}

	private static void onTick(Minecraft client) {
		if (client.getSingleplayerServer() == null || client.level != null) {
			waitingTicks = 0;
			return;
		}

		if (++waitingTicks % INTERVAL_TICKS != 0) {
			return;
		}

		try {
			LOGGER.warn("World still loading after {} ticks: {}", waitingTicks, describe(client));
		} catch (RuntimeException e) {
			LOGGER.warn("World still loading after {} ticks (probe failed: {})", waitingTicks, e.toString());
		}
	}

	private static String describe(Minecraft client) {
		StringBuilder out = new StringBuilder();
		out.append("client screen=").append(name(client.screen))
				.append(" overlay=").append(name(client.getOverlay()))
				.append(" playConnection=").append(name(client.getConnection()));
		Object pending = field(client, "pendingConnection");
		out.append(" pendingConnection=").append(pending instanceof Connection connection ? connection(connection) : name(pending));

		MinecraftServer server = client.getSingleplayerServer();
		out.append("; server ready=").append(server.isReady()).append(" tick=").append(server.getTickCount())
				.append(" connections=[");
		Object listener = server.getConnection();
		Object connections = listener != null ? field(listener, "connections") : null;

		if (connections instanceof Collection<?> list) {
			synchronized (list) {
				for (Object each : list) {
					out.append(each instanceof Connection connection ? connection(connection) : name(each)).append(' ');
				}
			}
		}

		out.append("]; synchronizer ").append(synchronizer("CLIENTBOUND")).append(' ').append(synchronizer("SERVERBOUND"));
		return out.toString();
	}

	private static String connection(Connection connection) {
		Object listener = connection.getPacketListener();
		StringBuilder out = new StringBuilder(name(listener)).append(connection.isConnected() ? "" : "(closed)");

		if (listener != null && listener.getClass().getSimpleName().contains("Configuration")) {
			out.append(" task=").append(name(field(listener, "currentTask")))
					.append(" queued=").append(field(listener, "configurationTasks"));
		}

		return out.toString();
	}

	private static String synchronizer(String direction) {
		try {
			Class<?> type = Class.forName("net.fabricmc.fabric.impl.client.gametest.threading.NetworkSynchronizer");
			Object synchronizer = type.getField(direction).get(null);
			return direction + "(inFlight=" + field(synchronizer, "inFlightPackets") + " handlers=" + field(synchronizer, "mainThreadPacketHandlers") + ")";
		} catch (ReflectiveOperationException e) {
			return direction + "(?)";
		}
	}

	/** A private field by its development (Mojang) name, or null if there is none. */
	private static Object field(Object owner, String name) {
		for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
			try {
				Field field = type.getDeclaredField(name);
				field.setAccessible(true);
				return field.get(owner);
			} catch (NoSuchFieldException e) {
				// Try the superclass.
			} catch (ReflectiveOperationException | RuntimeException e) {
				return "?" + e.getClass().getSimpleName();
			}
		}

		return null;
	}

	private static String name(Object value) {
		return value == null ? "none" : value.getClass().getSimpleName();
	}
}
