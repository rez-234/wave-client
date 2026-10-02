package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.ModifyExpressionValue;
import com.llamalad7.mixinextras.sugar.Local;
import net.minecraft.client.Minecraft;
import net.minecraft.client.MouseHandler;
import net.minecraft.client.input.MouseButtonInfo;
import org.joml.Vector2i;
import org.objectweb.asm.Opcodes;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import dev.waveclient.WaveClient;
import dev.waveclient.module.impl.camera.ZoomModule;

/** Mouse buttons for keybinds, plus zoom's scroll, sensitivity and cinematic camera hooks. */
@Mixin(MouseHandler.class)
public abstract class MouseHandlerMixin {
	@Shadow
	@Final
	private Minecraft minecraft;

	/** Forwards raw mouse button events to Wave Client keybinds. Never cancels. */
	@Inject(method = "onButton", at = @At("HEAD"))
	private void waveclient$onButton(long window, MouseButtonInfo button, int action, CallbackInfo ci) {
		if (window != this.minecraft.getWindow().handle()) {
			return;
		}

		WaveClient.get().keybinds().onMouseButton(button.button(), action, this.minecraft.screen != null);
	}

	/**
	 * Zoom: the wheel changes the zoom instead of the hotbar slot. Injected just before
	 * {@code player.isSpectator()} in onScroll, which is only reached in-world (no screen, a player
	 * present) once vanilla has turned the wheel movement into whole steps. Cancelling skips both
	 * the spectator menu and the hotbar slot change.
	 */
	@Inject(method = "onScroll(JDD)V", cancellable = true,
			at = @At(value = "INVOKE", target = "Lnet/minecraft/client/player/LocalPlayer;isSpectator()Z"))
	private void waveclient$zoomScroll(long window, double xOffset, double yOffset, CallbackInfo ci, @Local Vector2i scroll) {
		ZoomModule zoom = waveclient$activeZoom();

		if (zoom == null) {
			return;
		}

		// Same step count vanilla uses for the hotbar.
		int steps = scroll.y == 0 ? -scroll.x : scroll.y;

		if (zoom.onScroll(steps)) {
			ci.cancel();
		}
	}

	/**
	 * Zoom: lower sensitivity while zoomed by scaling the raw mouse deltas turnPlayer reads. The
	 * turn is linear in these values in every branch (normal, cinematic and spyglass), so the turn
	 * rate scales by exactly the multiplier.
	 */
	@ModifyExpressionValue(method = "turnPlayer",
			at = @At(value = "FIELD", target = "Lnet/minecraft/client/MouseHandler;accumulatedDX:D", opcode = Opcodes.GETFIELD))
	private double waveclient$zoomSensitivityX(double dx) {
		ZoomModule zoom = waveclient$activeZoom();
		return zoom == null ? dx : dx * zoom.sensitivityMultiplier();
	}

	@ModifyExpressionValue(method = "turnPlayer",
			at = @At(value = "FIELD", target = "Lnet/minecraft/client/MouseHandler;accumulatedDY:D", opcode = Opcodes.GETFIELD))
	private double waveclient$zoomSensitivityY(double dy) {
		ZoomModule zoom = waveclient$activeZoom();
		return zoom == null ? dy : dy * zoom.sensitivityMultiplier();
	}

	/**
	 * Zoom: cinematic camera while zoomed, without writing options.smoothCamera. No cleanup is
	 * needed afterwards: vanilla's non-smooth branches reset the smoothing state on every call.
	 */
	@ModifyExpressionValue(method = "turnPlayer",
			at = @At(value = "FIELD", target = "Lnet/minecraft/client/Options;smoothCamera:Z", opcode = Opcodes.GETFIELD))
	private boolean waveclient$zoomCinematic(boolean smoothCamera) {
		if (smoothCamera) {
			return true;
		}

		ZoomModule zoom = waveclient$activeZoom();
		return zoom != null && zoom.forcesCinematicCamera();
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
}
