package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.ModifyExpressionValue;
import net.minecraft.client.renderer.LightTexture;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Slice;

import dev.waveclient.WaveClient;
import dev.waveclient.module.impl.render.FullbrightModule;

/**
 * Fullbright: the lightmap is computed with a gamma above the option's 1.0 cap, while the option
 * itself is never written.
 *
 * <p>In 1.21.11, {@code updateLightTexture(F)V} reads
 * {@code float gamma = this.minecraft.options.gamma().get().floatValue();} and uploads
 * {@code max(0, gamma - darkness)} as the shader's BrightnessFactor. The slice starts at the
 * method's only {@code Options.gamma()} call, so the first {@code Double.floatValue()} after it is
 * the gamma unboxing. A bare ordinal would be fragile: the darkness option unboxes a Double earlier
 * in the method, and 1.21.9 added another option read before it.
 */
@Mixin(LightTexture.class)
public abstract class LightTextureMixin {
	@ModifyExpressionValue(
			method = "updateLightTexture(F)V",
			at = @At(value = "INVOKE", target = "Ljava/lang/Double;floatValue()F", ordinal = 0),
			slice = @Slice(from = @At(value = "INVOKE", target = "Lnet/minecraft/client/Options;gamma()Lnet/minecraft/client/OptionInstance;")),
			allow = 1)
	private float waveclient$fullbrightGamma(float gamma) {
		WaveClient wave = WaveClient.get();

		if (wave == null) {
			return gamma;
		}

		FullbrightModule fullbright = wave.fullbright();

		if (!fullbright.isActive()) {
			return gamma;
		}

		// Never darker than the player's own brightness setting.
		return Math.max(gamma, fullbright.gamma());
	}
}
