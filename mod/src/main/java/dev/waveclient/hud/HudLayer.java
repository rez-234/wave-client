package dev.waveclient.hud;

import java.util.ArrayList;
import java.util.List;

import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElement;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.resources.Identifier;
import org.joml.Matrix3x2fStack;

import dev.waveclient.ClientSettings;
import dev.waveclient.WaveClient;
import dev.waveclient.module.Module;
import dev.waveclient.module.ModuleManager;

/**
 * The single Fabric HUD element that draws every active {@link HudModule}.
 *
 * <p>Attached before the vanilla chat layer, so it inherits vanilla's "hide GUI" (F1) condition and
 * draws above the hotbar, scoreboard and titles but below chat and the player list.
 */
public final class HudLayer implements HudElement {
	private static final HudModule[] NONE = new HudModule[0];

	private final ModuleManager modules;
	private final ClientSettings settings;
	private int seenVersion = -1;
	private HudModule[] visible = NONE;

	private HudLayer(ModuleManager modules, ClientSettings settings) {
		this.modules = modules;
		this.settings = settings;
	}

	public static void register(ModuleManager modules, ClientSettings settings) {
		HudElementRegistry.attachElementBefore(VanillaHudElements.CHAT,
				Identifier.fromNamespaceAndPath(WaveClient.MOD_ID, "hud"),
				new HudLayer(modules, settings));
	}

	@Override
	public void render(GuiGraphics graphics, DeltaTracker deltaTracker) {
		if (settings.hideHudWithDebug.get() && Minecraft.getInstance().debugEntries.isOverlayVisible()) {
			return;
		}

		HudModule[] elements = refresh();
		int screenWidth = graphics.guiWidth();
		int screenHeight = graphics.guiHeight();
		Matrix3x2fStack pose = graphics.pose();

		for (HudModule element : elements) {
			int width = element.width();
			int height = element.height();

			if (width <= 0 || height <= 0) {
				continue;
			}

			HudPosition position = element.position;
			float scale = (float) position.scale();
			// Whole GUI pixels keep text crisp.
			float left = Math.round(position.left(screenWidth, width));
			float top = Math.round(position.top(screenHeight, height));

			pose.pushMatrix();

			try {
				pose.translate(left, top);

				if (scale != 1.0F) {
					pose.scale(scale, scale);
				}

				element.render(graphics);
			} catch (RuntimeException e) {
				WaveClient.LOGGER.error("HUD element '{}' failed to render; disabling it", element.id(), e);
				element.setEnabled(false);
			} finally {
				pose.popMatrix();
			}
		}
	}

	/** Rebuilds the list of HUD modules to draw, only when the set of active modules changed. */
	private HudModule[] refresh() {
		int version = modules.activeVersion();

		if (version != seenVersion) {
			seenVersion = version;
			List<HudModule> hud = new ArrayList<>();

			for (Module module : modules.active()) {
				if (module instanceof HudModule hudModule) {
					hud.add(hudModule);
				}
			}

			visible = hud.toArray(NONE);
		}

		return visible;
	}
}
