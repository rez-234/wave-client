package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.ModifyReturnValue;
import net.minecraft.client.CameraType;
import net.minecraft.client.Options;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

import dev.waveclient.module.impl.camera.CameraHooks;

/**
 * Freelook and snaplook: report a third-person view without writing the player's perspective
 * option. Everything that asks for the perspective (player rendering, the hand, the crosshair,
 * Iris) sees it. Called per particle, so it is a single static field read.
 */
@Mixin(Options.class)
public abstract class OptionsMixin {
	@ModifyReturnValue(method = "getCameraType()Lnet/minecraft/client/CameraType;", at = @At("RETURN"))
	private CameraType waveclient$perspectiveOverride(CameraType original) {
		CameraType override = CameraHooks.override;
		return override != null ? override : original;
	}
}
