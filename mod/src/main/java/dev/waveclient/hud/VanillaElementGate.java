package dev.waveclient.hud;

import java.util.function.BooleanSupplier;

import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElement;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.resources.Identifier;

/**
 * Hides a vanilla HUD element (the effect icons, the sidebar) while a Wave module draws its own
 * version, and shows it again as soon as the module is off or blocked.
 *
 * <p>Fabric applies a replacement to the vanilla element on every frame, so this hands back the
 * same object each time instead of a new lambda.
 */
public final class VanillaElementGate implements HudElement {
	private final BooleanSupplier hidden;
	private HudElement vanilla;

	private VanillaElementGate(BooleanSupplier hidden) {
		this.hidden = hidden;
	}

	/** Call once per element, at client init. */
	public static void register(Identifier element, BooleanSupplier hidden) {
		VanillaElementGate gate = new VanillaElementGate(hidden);
		HudElementRegistry.replaceElement(element, gate::wrap);
	}

	private HudElement wrap(HudElement original) {
		vanilla = original;
		return this;
	}

	@Override
	public void render(GuiGraphics graphics, DeltaTracker deltaTracker) {
		HudElement original = vanilla;

		if (original != null && !hidden.getAsBoolean()) {
			original.render(graphics, deltaTracker);
		}
	}
}
