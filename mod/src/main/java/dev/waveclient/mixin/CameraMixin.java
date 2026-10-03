package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.ModifyExpressionValue;
import com.llamalad7.mixinextras.sugar.Local;
import net.minecraft.client.Camera;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

import dev.waveclient.module.impl.camera.CameraHooks;

/**
 * Freelook: the camera takes its rotation from the freelook angles instead of the player's.
 * Both reads are replaced (the riding-a-minecart branch and the normal one), so third-person
 * placement and wall collision follow the freelook direction.
 */
@Mixin(Camera.class)
public abstract class CameraMixin {
	@ModifyExpressionValue(method = "setup(Lnet/minecraft/world/level/Level;Lnet/minecraft/world/entity/Entity;ZZF)V", require = 2, allow = 2,
			at = @At(value = "INVOKE", target = "Lnet/minecraft/world/entity/Entity;getViewYRot(F)F"))
	private float waveclient$freelookYaw(float yaw, @Local(argsOnly = true) Entity entity) {
		return CameraHooks.freelook && entity == Minecraft.getInstance().player ? CameraHooks.yaw : yaw;
	}

	@ModifyExpressionValue(method = "setup(Lnet/minecraft/world/level/Level;Lnet/minecraft/world/entity/Entity;ZZF)V", require = 2, allow = 2,
			at = @At(value = "INVOKE", target = "Lnet/minecraft/world/entity/Entity;getViewXRot(F)F"))
	private float waveclient$freelookPitch(float pitch, @Local(argsOnly = true) Entity entity) {
		return CameraHooks.freelook && entity == Minecraft.getInstance().player ? CameraHooks.pitch : pitch;
	}
}
