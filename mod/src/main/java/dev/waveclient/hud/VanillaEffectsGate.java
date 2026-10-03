package dev.waveclient.hud;

import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElement;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.gui.GuiGraphics;

import dev.waveclient.module.impl.hud.PotionEffectsModule;

/**
 * Hides the vanilla effect icons while the potion effects module replaces them.
 *
 * <p>Fabric applies a replacement to the vanilla element on every frame, so this hands back the
 * same object each time instead of a new lambda.
 */
public final class VanillaEffectsGate implements HudElement {
	private final PotionEffectsModule potions;
	private HudElement vanilla;

	private VanillaEffectsGate(PotionEffectsModule potions) {
		this.potions = potions;
	}

	/** Call once, at client init. */
	public static void register(PotionEffectsModule potions) {
		VanillaEffectsGate gate = new VanillaEffectsGate(potions);
		HudElementRegistry.replaceElement(VanillaHudElements.STATUS_EFFECTS, gate::wrap);
	}

	private HudElement wrap(HudElement original) {
		vanilla = original;
		return this;
	}

	@Override
	public void render(GuiGraphics graphics, DeltaTracker deltaTracker) {
		HudElement original = vanilla;

		if (original != null && !potions.hidesVanillaIcons()) {
			original.render(graphics, deltaTracker);
		}
	}
}
