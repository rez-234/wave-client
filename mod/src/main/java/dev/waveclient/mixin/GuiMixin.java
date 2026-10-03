package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.components.ChatComponent;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

import dev.waveclient.WaveClient;

@Mixin(Gui.class)
public abstract class GuiMixin {
	/**
	 * Keep chat: skip clearing it when leaving a world or server. Only this call is changed, so
	 * F3 + D and other mods can still clear chat. Messages the old server delayed are still
	 * dropped, as clearing would, so they don't appear in the next world.
	 */
	@WrapOperation(method = "onDisconnected()V",
			at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/components/ChatComponent;clearMessages(Z)V"))
	private void waveclient$keepChat(ChatComponent chat, boolean clearSentHistory, Operation<Void> original) {
		WaveClient wave = WaveClient.get();

		if (wave != null && wave.chat().keepsChat()) {
			Minecraft.getInstance().getChatListener().flushQueue();
			return;
		}

		original.call(chat, clearSentHistory);
	}
}
