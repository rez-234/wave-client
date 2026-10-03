package dev.waveclient.mixin;

import net.minecraft.client.gui.screens.ChatScreen;
import net.minecraft.client.input.MouseButtonEvent;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import dev.waveclient.WaveClient;

@Mixin(ChatScreen.class)
public abstract class ChatScreenMixin {
	/**
	 * Copy a message: reached after command suggestions declined the click and before vanilla
	 * handles clickable text, so the copy click wins over a link under the mouse.
	 */
	@Inject(method = "mouseClicked(Lnet/minecraft/client/input/MouseButtonEvent;Z)Z", cancellable = true,
			at = @At(value = "INVOKE", target = "Lnet/minecraft/client/input/MouseButtonEvent;button()I"))
	private void waveclient$copyMessage(MouseButtonEvent event, boolean doubleClick, CallbackInfoReturnable<Boolean> cir) {
		WaveClient wave = WaveClient.get();

		if (wave != null && wave.chat().tryCopy(event)) {
			cir.setReturnValue(true);
		}
	}
}
