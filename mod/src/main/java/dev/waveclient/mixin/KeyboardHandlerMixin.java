package dev.waveclient.mixin;

import net.minecraft.client.KeyboardHandler;
import net.minecraft.client.Minecraft;
import net.minecraft.client.input.KeyEvent;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import dev.waveclient.WaveClient;

/** Forwards raw key events to Wave Client keybinds. Never cancels; vanilla handling is unchanged. */
@Mixin(KeyboardHandler.class)
public abstract class KeyboardHandlerMixin {
	@Shadow
	@Final
	private Minecraft minecraft;

	@Inject(method = "keyPress", at = @At("HEAD"))
	private void waveclient$onKeyPress(long window, int action, KeyEvent event, CallbackInfo ci) {
		if (window != this.minecraft.getWindow().handle()) {
			return;
		}

		WaveClient.get().keybinds().onKey(event.key(), action, this.minecraft.screen != null);
	}
}
