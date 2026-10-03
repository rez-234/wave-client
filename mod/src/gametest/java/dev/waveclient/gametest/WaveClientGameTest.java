package dev.waveclient.gametest;

import java.util.Map;

import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;
import net.minecraft.client.CameraType;
import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.input.InputQuirks;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import dev.waveclient.WaveClient;
import dev.waveclient.gui.menu.ModMenuScreen;
import dev.waveclient.gui.screen.HudEditorScreen;
import dev.waveclient.input.ClickInput;
import dev.waveclient.input.Keybind;
import dev.waveclient.mixin.ChatComponentAccessor;
import dev.waveclient.mixin.OptionsAccessor;
import dev.waveclient.module.Module;
import dev.waveclient.module.impl.camera.CameraHooks;
import dev.waveclient.module.impl.chat.ChatLines;
import dev.waveclient.module.impl.hud.ScoreboardLayout;

/**
 * Boots the real game with every module on, goes through the hooks that only a running client
 * can check, and saves screenshots of the HUD, the HUD editor and the mod menu. A mixin that
 * doesn't apply stops the game from starting, so getting here at all checks every target.
 *
 * <p>Run with {@code ./gradlew runClientGameTest} (CI runs it under a virtual display).
 */
public final class WaveClientGameTest implements FabricClientGameTest {
	private static final Logger LOGGER = LoggerFactory.getLogger("Wave Client game test");
	private static final String CHAT_TEST_MESSAGE = "wave-chat-test";

	@Override
	public void runTest(ClientGameTestContext context) {
		context.runOnClient(client -> {
			for (Module module : WaveClient.get().modules().all()) {
				module.setEnabled(true);
			}
		});

		try (TestSingleplayerContext singleplayer = createWorld(context)) {
			singleplayer.getClientWorld().waitForChunksRender();
			// Armor and effects, so those HUD elements have something to show.
			singleplayer.getServer().runCommand("item replace entity @a armor.head with minecraft:iron_helmet");
			singleplayer.getServer().runCommand("item replace entity @a armor.chest with minecraft:diamond_chestplate");
			singleplayer.getServer().runCommand("item replace entity @a weapon.mainhand with minecraft:iron_sword");
			singleplayer.getServer().runCommand("effect give @a minecraft:speed 90 1");
			singleplayer.getServer().runCommand("effect give @a minecraft:night_vision 8 0");
			context.waitTicks(10);
			context.takeScreenshot("wave-hud");
			check(context.computeOnClient(client -> WaveClient.get().motionBlurRenderer().isRunning()),
					"motion blur: the shader compiled and frames are being blended");

			toggleSprintAndSneak(context);
			clicksPerSecond(context);
			zoom(context);
			freelook(context);
			snaplookAndPerspectiveKey(context);
			chat(context);
			scoreboardAndItems(context, singleplayer);
			screens(context);
			noModuleFailed(context);
		}

		check(context.computeOnClient(client -> ((ChatComponentAccessor) client.gui.getChat()).waveclient$allMessages().stream()
				.anyMatch(message -> message.content().getString().endsWith(CHAT_TEST_MESSAGE))), "keep chat: messages stay after leaving the world");
	}

	private static void chat(ClientGameTestContext context) {
		context.runOnClient(client -> client.gui.getChat().addMessage(Component.literal(CHAT_TEST_MESSAGE)));
		context.waitTick();
		String newest = context.computeOnClient(client -> ((ChatComponentAccessor) client.gui.getChat()).waveclient$allMessages().get(0).content().getString());
		check(newest.matches("\\[\\d{2}:\\d{2}\\] " + CHAT_TEST_MESSAGE), "timestamps: a new message is stamped (got \"" + newest + "\")");

		context.setScreen(() -> new ChatScreen("", false));
		context.waitTicks(2);
		context.takeScreenshot("wave-chat");
		// Ctrl/Cmd-click the newest message: the bottom row of the chat.
		boolean handled = context.computeOnClient(client -> {
			ChatComponentAccessor chat = (ChatComponentAccessor) client.gui.getChat();
			double scale = chat.waveclient$scale();
			int bottom = Mth.floor((client.getWindow().getGuiScaledHeight() - 40) / scale);
			double y = (bottom - ChatLines.rowHeight(client.options.chatLineSpacing().get()) / 2.0) * scale;
			MouseButtonEvent click = new MouseButtonEvent(10, y, new MouseButtonInfo(GLFW.GLFW_MOUSE_BUTTON_LEFT, InputQuirks.EDIT_SHORTCUT_KEY_MODIFIER));
			return client.screen.mouseClicked(click, false);
		});
		check(handled, "copy messages: Ctrl-click on a message is used");
		String copied = context.computeOnClient(client -> WaveClient.get().chat().lastCopied());
		check(CHAT_TEST_MESSAGE.equals(copied), "copy messages: the text is copied without the timestamp (got \"" + copied + "\")");
		context.setScreen(() -> null);
		context.waitTick();
	}

	/** Creates the test world; if loading times out, logs every thread's stack to show where it stalled. */
	private static TestSingleplayerContext createWorld(ClientGameTestContext context) {
		try {
			return context.worldBuilder().create();
		} catch (AssertionError e) {
			StringBuilder dump = new StringBuilder("World loading timed out. Threads:\n");

			for (Map.Entry<Thread, StackTraceElement[]> thread : Thread.getAllStackTraces().entrySet()) {
				dump.append('"').append(thread.getKey().getName()).append("\" ").append(thread.getKey().getState()).append('\n');

				for (StackTraceElement frame : thread.getValue()) {
					dump.append("    at ").append(frame).append('\n');
				}
			}

			LOGGER.error(dump.toString());
			throw e;
		}
	}

	private static void toggleSprintAndSneak(ClientGameTestContext context) {
		context.runOnClient(client -> WaveClient.get().toggleSprint().toggleSneak.set(true));

		context.getInput().pressKey(options -> options.keySprint);
		context.waitTicks(2);
		check(context.computeOnClient(client -> client.player.input.keyPresses.sprint()), "toggle sprint: sprint stays on after the key is released");
		context.getInput().pressKey(options -> options.keySprint);
		context.waitTicks(2);
		check(!context.computeOnClient(client -> client.player.input.keyPresses.sprint()), "toggle sprint: a second press turns it off");

		context.getInput().pressKey(options -> options.keyShift);
		context.waitTicks(2);
		check(context.computeOnClient(client -> client.player.input.keyPresses.shift()), "toggle sneak: sneak stays on after the key is released");
		context.takeScreenshot("wave-toggle-sneak");
		context.getInput().pressKey(options -> options.keyShift);
		context.waitTicks(2);
		check(!context.computeOnClient(client -> client.player.input.keyPresses.shift()), "toggle sneak: a second press turns it off");
	}

	private static void clicksPerSecond(ClientGameTestContext context) {
		context.getInput().pressMouse(GLFW.GLFW_MOUSE_BUTTON_LEFT);
		context.getInput().pressMouse(GLFW.GLFW_MOUSE_BUTTON_RIGHT);
		context.waitTick();
		int left = context.computeOnClient(client -> WaveClient.get().clickInput().left(ClickInput.Source.MOUSE_BUTTONS));
		int right = context.computeOnClient(client -> WaveClient.get().clickInput().right(ClickInput.Source.MOUSE_BUTTONS));
		check(left >= 1, "CPS: a left click is counted (got " + left + ")");
		check(right >= 1, "CPS: a right click is counted (got " + right + ")");
	}

	private static void zoom(ClientGameTestContext context) {
		context.getInput().holdKey(GLFW.GLFW_KEY_C);
		context.waitTicks(5);
		check(context.computeOnClient(client -> WaveClient.get().zoom().isZooming()), "zoom: holding C zooms");
		context.takeScreenshot("wave-zoom");
		context.getInput().releaseKey(GLFW.GLFW_KEY_C);
		context.waitTicks(5);
		check(!context.computeOnClient(client -> WaveClient.get().zoom().isZooming()), "zoom: releasing C stops");
	}

	private static void freelook(ClientGameTestContext context) {
		float yawBefore = context.computeOnClient(client -> client.player.getYRot());
		context.getInput().holdAlt();
		context.waitTicks(2);
		check(context.computeOnClient(client -> CameraHooks.freelook), "freelook: holding Left Alt starts it");
		check(context.computeOnClient(client -> client.options.getCameraType()) == CameraType.THIRD_PERSON_BACK, "freelook: the view is third person");
		check(rawPerspective(context) == CameraType.FIRST_PERSON, "freelook: the perspective option is not written");

		// Mouse movement only turns anything while the game has captured the mouse.
		context.runOnClient(client -> client.mouseHandler.grabMouse());
		context.getInput().moveCursor(300, 0);
		context.waitTicks(3);
		float cameraYaw = context.computeOnClient(client -> client.gameRenderer.getMainCamera().yRot());
		float hookYaw = context.computeOnClient(client -> CameraHooks.yaw);
		check(context.computeOnClient(client -> client.player.getYRot()) == yawBefore, "freelook: moving the mouse doesn't turn the player");
		check(Math.abs(cameraYaw - hookYaw) < 0.01F, "freelook: the camera uses the freelook angle (" + cameraYaw + " vs " + hookYaw + ")");
		LOGGER.info("Freelook turned the camera by {} degrees", hookYaw - yawBefore);
		context.takeScreenshot("wave-freelook");

		context.getInput().releaseAlt();
		context.waitTicks(2);
		check(!context.computeOnClient(client -> CameraHooks.freelook), "freelook: releasing Left Alt ends it");
		check(context.computeOnClient(client -> client.options.getCameraType()) == CameraType.FIRST_PERSON, "freelook: back to first person");
	}

	private static void snaplookAndPerspectiveKey(ClientGameTestContext context) {
		context.runOnClient(client -> WaveClient.get().snaplook().snaplookKey.set(Keybind.key(GLFW.GLFW_KEY_V)));

		context.getInput().holdKey(GLFW.GLFW_KEY_V);
		context.waitTicks(2);
		check(context.computeOnClient(client -> client.options.getCameraType()) == CameraType.THIRD_PERSON_FRONT, "snaplook: holding the key shows the front view");
		check(rawPerspective(context) == CameraType.FIRST_PERSON, "snaplook: the perspective option is not written");
		context.takeScreenshot("wave-snaplook");

		// F5 changes the real perspective and ends snaplook.
		context.getInput().pressKey(options -> options.keyTogglePerspective);
		context.waitTicks(2);
		check(rawPerspective(context) == CameraType.THIRD_PERSON_BACK, "F5 during snaplook cycles the real perspective (got " + rawPerspective(context) + ")");
		check(context.computeOnClient(client -> client.options.getCameraType()) == CameraType.THIRD_PERSON_BACK, "F5 during snaplook ends the override");
		context.getInput().releaseKey(GLFW.GLFW_KEY_V);
		context.waitTicks(2);

		context.getInput().pressKey(options -> options.keyTogglePerspective);
		context.getInput().pressKey(options -> options.keyTogglePerspective);
		context.waitTicks(2);
		check(rawPerspective(context) == CameraType.FIRST_PERSON, "F5 cycles back to first person (got " + rawPerspective(context) + ")");
	}

	private static void scoreboardAndItems(ClientGameTestContext context, TestSingleplayerContext singleplayer) {
		singleplayer.getServer().runCommand("scoreboard objectives add wave dummy \"Wave test\"");
		singleplayer.getServer().runCommand("scoreboard objectives setdisplay sidebar wave");
		singleplayer.getServer().runCommand("scoreboard players set Alpha wave 3");
		singleplayer.getServer().runCommand("scoreboard players set Beta wave 7");
		// Dropped items in front of the player, for item physics.
		singleplayer.getServer().runCommand("summon item ~1 ~1 ~3 {Item:{id:\"minecraft:diamond\",count:1}}");
		singleplayer.getServer().runCommand("summon item ~-1 ~2 ~3 {Item:{id:\"minecraft:oak_planks\",count:5}}");
		context.waitTicks(40);
		check(context.computeOnClient(client -> WaveClient.get().scoreboard().height()) == ScoreboardLayout.height(2),
				"scoreboard: the sidebar shows the objective's two lines");
		context.takeScreenshot("wave-scoreboard-items");
	}

	private static void screens(ClientGameTestContext context) {
		context.setScreen(() -> new HudEditorScreen(WaveClient.get()));
		context.waitTicks(2);
		context.takeScreenshot("wave-hud-editor");

		context.setScreen(() -> new ModMenuScreen(WaveClient.get(), null));
		context.waitTicks(2);
		context.takeScreenshot("wave-mod-menu");

		context.setScreen(() -> null);
		context.waitTicks(2);
	}

	/** A module that throws while ticking or drawing is turned off, so every one should still be on. */
	private static void noModuleFailed(ClientGameTestContext context) {
		context.runOnClient(client -> {
			for (Module module : WaveClient.get().modules().all()) {
				check(module.isEnabled(), module.id() + " is still on (a module that throws is turned off; see the log)");
			}
		});
	}

	private static CameraType rawPerspective(ClientGameTestContext context) {
		return context.computeOnClient(client -> ((OptionsAccessor) client.options).waveclient$rawCameraType());
	}

	private static void check(boolean condition, String what) {
		if (!condition) {
			throw new AssertionError(what);
		}

		LOGGER.info("OK: {}", what);
	}
}
