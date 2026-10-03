package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.ModifyExpressionValue;
import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import com.llamalad7.mixinextras.sugar.Local;
import com.llamalad7.mixinextras.sugar.Share;
import com.llamalad7.mixinextras.sugar.ref.LocalRef;
import net.minecraft.client.GuiMessage;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import dev.waveclient.WaveClient;
import dev.waveclient.module.impl.chat.ChatModule;

/** Chat timestamps and history length. */
@Mixin(ChatComponent.class)
public abstract class ChatComponentMixin {
	@Unique
	private static final String ADD_MESSAGE =
			"addMessage(Lnet/minecraft/network/chat/Component;Lnet/minecraft/network/chat/MessageSignature;Lnet/minecraft/client/GuiMessageTag;)V";

	/**
	 * Timestamps: replace the message before anything reads it. Done at HEAD so mods that add to
	 * the stored message later (Chat Heads puts a head before each message) put their part in
	 * front of the stamp, where they expect it. Both addMessage overloads end up here.
	 */
	@Inject(method = ADD_MESSAGE, at = @At("HEAD"))
	private void waveclient$timestamp(CallbackInfo ci, @Local(argsOnly = true) LocalRef<Component> message,
			@Share("unstamped") LocalRef<Component> unstamped) {
		ChatModule chat = waveclient$chat();

		if (chat == null) {
			return;
		}

		Component original = message.get();
		Component stamped = chat.stamp(original);

		if (stamped != null) {
			unstamped.set(original);
			message.set(stamped);
		}
	}

	/** Keeps timestamps out of latest.log, which tools such as stats overlays read line by line. */
	@WrapOperation(method = ADD_MESSAGE,
			at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/components/ChatComponent;logChatMessage(Lnet/minecraft/client/GuiMessage;)V"))
	private void waveclient$logWithoutTimestamp(ChatComponent self, GuiMessage message, Operation<Void> original,
			@Share("unstamped") LocalRef<Component> unstamped) {
		Component plain = unstamped.get();
		ChatModule chat = waveclient$chat();

		if (plain == null || chat == null) {
			original.call(self, message);
			return;
		}

		chat.rememberUnstamped(message, plain);
		original.call(self, new GuiMessage(message.addedTime(), plain, message.signature(), message.tag()));
	}

	/**
	 * History length: the limit of 100 messages (and of 100 wrapped lines). Never lowers a larger
	 * limit another mod set.
	 */
	@ModifyExpressionValue(method = {"addMessageToDisplayQueue(Lnet/minecraft/client/GuiMessage;)V", "addMessageToQueue(Lnet/minecraft/client/GuiMessage;)V"},
			at = @At(value = "CONSTANT", args = "intValue=100"), require = 2, allow = 2)
	private int waveclient$historyLength(int limit) {
		ChatModule chat = waveclient$chat();
		return chat == null ? limit : chat.historyLimit(limit);
	}

	@Unique
	private static ChatModule waveclient$chat() {
		WaveClient wave = WaveClient.get();
		return wave == null ? null : wave.chat();
	}
}
