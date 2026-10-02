package dev.waveclient.mixin;

import net.minecraft.client.Minecraft;
import net.minecraft.client.MouseHandler;
import net.minecraft.client.input.MouseButtonInfo;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import dev.waveclient.WaveClient;

/** Forwards raw mouse button events to Wave Client keybinds. Never cancels. */
@Mixin(MouseHandler.class)
public abstract class MouseHandlerMixin {
	@Shadow
	@Final
	private Minecraft minecraft;

	@Inject(method = "onButton", at = @At("HEAD"))
	private void waveclient$onButton(long window, MouseButtonInfo button, int action, CallbackInfo ci) {
		if (window != this.minecraft.getWindow().handle()) {
			return;
		}

		WaveClient.get().keybinds().onMouseButton(button.button(), action, this.minecraft.screen != null);
	}
}
