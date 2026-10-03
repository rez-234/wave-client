package dev.waveclient.mixin;

import net.minecraft.client.gui.Gui;
import net.minecraft.world.phys.HitResult;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(Gui.class)
public interface GuiAccessor {
	/** Vanilla's rule for showing the crosshair in spectator mode: only over something with a menu. */
	@Invoker("canRenderCrosshairForSpectator")
	boolean waveclient$canRenderCrosshairForSpectator(HitResult hitResult);
}
