package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.ModifyExpressionValue;
import com.llamalad7.mixinextras.injector.ModifyReturnValue;
import com.llamalad7.mixinextras.sugar.Local;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.world.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import dev.waveclient.WaveClient;
import dev.waveclient.module.impl.camera.ZoomModule;

@Mixin(GameRenderer.class)
public abstract class GameRendererMixin {
	/** Spyglass (about 7 degrees) times a 50x zoom would otherwise collapse the view. */
	@Unique
	private static final float WAVECLIENT_MIN_ZOOMED_FOV = 1.0F;

	/** Boxed once; Float.valueOf doesn't cache. */
	@Unique
	private static final Float WAVECLIENT_FULL_NIGHT_VISION = 1.0F;

	@Shadow
	public abstract boolean isPanoramicMode();

	/**
	 * Zoom the world FOV. Calls with useFovSetting=false compute the held item's projection (in
	 * vanilla and in Iris's shader hand renderer); those are left alone so the hand never zooms.
	 * Applied after vanilla's FOV effects, so sprinting and underwater FOV scale proportionally.
	 * Panoramic screenshots keep their fixed 90 degrees.
	 */
	@ModifyReturnValue(method = "getFov(Lnet/minecraft/client/Camera;FZ)F", at = @At("RETURN"))
	private float waveclient$applyZoom(float fov, @Local(argsOnly = true) boolean useFovSetting) {
		if (!useFovSetting || this.isPanoramicMode()) {
			return fov;
		}

		ZoomModule zoom = waveclient$activeZoom();

		if (zoom == null) {
			return fov;
		}

		double divisor = zoom.fovDivisor();

		if (divisor <= 1.0) {
			return fov;
		}

		return Math.max((float) (fov / divisor), Math.min(fov, WAVECLIENT_MIN_ZOOMED_FOV));
	}

	/**
	 * Fullbright with shader packs: Iris feeds this value to packs as their "nightVision" uniform,
	 * which many packs (e.g. Complementary) treat as fullbright. Vanilla only calls this method
	 * while the player has Night Vision, so vanilla rendering is unaffected apart from the effect
	 * no longer flickering as it runs out.
	 *
	 * <p>This must answer at HEAD: for an entity without Night Vision, Iris's own safety hook
	 * returns 0 before the method's normal return, so a return-value hook would never run in
	 * exactly the case shader packs need.
	 */
	@Inject(method = "getNightVisionScale(Lnet/minecraft/world/entity/LivingEntity;F)F", at = @At("HEAD"), cancellable = true)
	private static void waveclient$fullbrightNightVision(LivingEntity entity, float partialTick, CallbackInfoReturnable<Float> cir) {
		WaveClient wave = WaveClient.get();

		if (wave == null || !wave.fullbright().forcesNightVision()) {
			return;
		}

		Minecraft minecraft = Minecraft.getInstance();

		if (entity == minecraft.player || entity == minecraft.getCameraEntity()) {
			cir.setReturnValue(WAVECLIENT_FULL_NIGHT_VISION);
		}
	}

	/** Zoom magnifies view bobbing too; scale it back so the zoomed view doesn't sway. */
	@ModifyExpressionValue(method = "bobView", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/entity/ClientAvatarState;getInterpolatedBob(F)F"))
	private float waveclient$reduceBobWhileZoomed(float bob) {
		ZoomModule zoom = waveclient$activeZoom();

		if (zoom == null || !zoom.reduceBobbing.get()) {
			return bob;
		}

		double divisor = zoom.fovDivisor();
		return divisor > 1.0 ? (float) (bob / divisor) : bob;
	}

	@Unique
	private static ZoomModule waveclient$activeZoom() {
		WaveClient wave = WaveClient.get();

		if (wave == null) {
			return null;
		}

		ZoomModule zoom = wave.zoom();
		return zoom.isActive() ? zoom : null;
	}

	/**
	 * Motion blur, right after the world (with the hand, screen overlays and glowing outlines)
	 * is drawn and before vanilla's spectator effect and all GUI drawing, so the HUD, chat and
	 * menus stay sharp. Only reached when a world is being rendered.
	 */
	@Inject(method = "render(Lnet/minecraft/client/DeltaTracker;Z)V",
			at = @At(value = "INVOKE", target = "Lnet/minecraft/client/renderer/LevelRenderer;doEntityOutline()V", shift = At.Shift.AFTER))
	private void waveclient$motionBlur(DeltaTracker deltaTracker, boolean renderLevel, CallbackInfo ci) {
		WaveClient wave = WaveClient.get();

		if (wave != null) {
			wave.motionBlurRenderer().afterWorld();
		}
	}
}
