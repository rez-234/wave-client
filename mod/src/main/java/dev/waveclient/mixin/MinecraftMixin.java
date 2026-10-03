package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.ModifyExpressionValue;
import net.minecraft.client.CameraType;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Options;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import dev.waveclient.module.impl.camera.CameraHooks;

/** F5 with freelook or snaplook engaged. */
@Mixin(Minecraft.class)
public abstract class MinecraftMixin {
	@Shadow
	@Final
	public Options options;

	/**
	 * F5 cycles the player's real perspective. Without this it would read the override and save
	 * {@code override.cycle()} as the player's option.
	 */
	@ModifyExpressionValue(method = "handleKeybinds()V", allow = 4,
			at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Options;getCameraType()Lnet/minecraft/client/CameraType;"))
	private CameraType waveclient$realPerspectiveForF5(CameraType shown) {
		return ((OptionsAccessor) this.options).waveclient$rawCameraType();
	}

	/** Pressing F5 means the player wants that perspective, so freelook and snaplook end. */
	@Inject(method = "handleKeybinds()V",
			at = @At(value = "INVOKE", target = "Lnet/minecraft/client/Options;setCameraType(Lnet/minecraft/client/CameraType;)V"))
	private void waveclient$endOverrideOnF5(CallbackInfo ci) {
		CameraHooks.onVanillaPerspectiveCycle();
	}
}
