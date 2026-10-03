package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import com.llamalad7.mixinextras.sugar.Local;
import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.KeyboardHandler;
import net.minecraft.client.Minecraft;
import net.minecraft.client.input.KeyEvent;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import dev.waveclient.WaveClient;

/**
 * Forwards raw key events to Wave Client keybinds and toggle sprint, and counts key clicks for
 * CPS. Never cancels; vanilla handling is unchanged.
 */
@Mixin(KeyboardHandler.class)
public abstract class KeyboardHandlerMixin {
	@Unique
	private static final int GLFW_PRESS = 1;

	@Shadow
	@Final
	private Minecraft minecraft;

	@Inject(method = "keyPress", at = @At("HEAD"))
	private void waveclient$onKeyPress(long window, int action, KeyEvent event, CallbackInfo ci) {
		if (window != this.minecraft.getWindow().handle()) {
			return;
		}

		WaveClient wave = WaveClient.get();
		wave.keybinds().onKey(event.key(), action, this.minecraft.screen != null);

		// Presses only (not auto-repeats), and only when vanilla would apply the key to movement.
		if (action == GLFW_PRESS && this.minecraft.screen == null) {
			wave.toggleSprint().onKeyPressed(event);
		}
	}

	/**
	 * CPS with attack or use bound to a key. The game clicks key mappings for auto-repeats too,
	 * and for the debug key with a screen open; only real presses in game count. Vanilla always
	 * runs.
	 */
	@WrapOperation(method = "keyPress",
			at = @At(value = "INVOKE", target = "Lnet/minecraft/client/KeyMapping;click(Lcom/mojang/blaze3d/platform/InputConstants$Key;)V"))
	private void waveclient$countKeyClick(InputConstants.Key key, Operation<Void> original, @Local(argsOnly = true) int action) {
		original.call(key);

		if (action == GLFW_PRESS && this.minecraft.screen == null) {
			WaveClient.get().clickInput().onClick(key);
		}
	}
}
