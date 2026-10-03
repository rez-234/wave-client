package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.ModifyExpressionValue;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import com.llamalad7.mixinextras.sugar.Local;
import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.Minecraft;
import net.minecraft.client.MouseHandler;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.client.player.LocalPlayer;
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
import dev.waveclient.module.impl.camera.CameraHooks;
import dev.waveclient.module.impl.camera.FreelookModule;
import dev.waveclient.module.impl.camera.ZoomModule;

/**
 * Mouse buttons for keybinds and toggle sprint, zoom's scroll, sensitivity and cinematic camera
 * hooks, and freelook's mouse look.
 */
@Mixin(MouseHandler.class)
public abstract class MouseHandlerMixin {
	@Shadow
	@Final
	private Minecraft minecraft;

	@Unique
	private static final int GLFW_PRESS = 1;

	/** Forwards raw mouse button events to Wave Client keybinds and toggle sprint. Never cancels. */
	@Inject(method = "onButton", at = @At("HEAD"))
	private void waveclient$onButton(long window, MouseButtonInfo button, int action, CallbackInfo ci) {
		if (window != this.minecraft.getWindow().handle()) {
			return;
		}

		WaveClient wave = WaveClient.get();
		wave.keybinds().onMouseButton(button.button(), action, this.minecraft.screen != null);

		// Vanilla applies a mouse button to key mappings only with no screen and no overlay.
		if (action == GLFW_PRESS && this.minecraft.screen == null && this.minecraft.getOverlay() == null) {
			wave.toggleSprint().onMousePressed(button);
		}
	}

	/**
	 * CPS: a mouse press the game acted on. This call is only reached for a press with no screen
	 * or overlay open, whether or not anything is bound to the button. Vanilla always runs.
	 */
	@WrapOperation(method = "onButton",
			at = @At(value = "INVOKE", target = "Lnet/minecraft/client/KeyMapping;click(Lcom/mojang/blaze3d/platform/InputConstants$Key;)V"))
	private void waveclient$countClick(InputConstants.Key key, Operation<Void> original) {
		original.call(key);
		WaveClient.get().clickInput().onClick(key);
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

	/**
	 * Freelook: mouse movement turns the camera instead of the player. The deltas already include
	 * sensitivity, smoothing, the invert options and zoom's lower sensitivity, so they are used as
	 * they are. Hooked at the call site rather than in Entity.turn, which other mods override.
	 */
	@WrapOperation(method = "turnPlayer(D)V", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/player/LocalPlayer;turn(DD)V"))
	private void waveclient$freelookTurn(LocalPlayer player, double yRot, double xRot, Operation<Void> original) {
		if (CameraHooks.freelook) {
			FreelookModule freelook = WaveClient.get().freelook();

			if (freelook.isActive() && freelook.isFreelooking()) {
				freelook.turn(yRot, xRot);
				return;
			}
		}

		original.call(player, yRot, xRot);
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
