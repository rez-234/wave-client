package dev.waveclient.mixin;

import java.util.List;

import net.minecraft.client.GuiMessage;
import net.minecraft.client.gui.components.ChatComponent;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(ChatComponent.class)
public interface ChatComponentAccessor {
	/** Whole messages, newest first. */
	@Accessor("allMessages")
	List<GuiMessage> waveclient$allMessages();

	/** Wrapped lines as drawn, newest first. */
	@Accessor("trimmedMessages")
	List<GuiMessage.Line> waveclient$trimmedMessages();

	/** Chat width in GUI pixels, including other mods' changes to it. */
	@Invoker("getWidth")
	int waveclient$width();

	@Invoker("getScale")
	double waveclient$scale();
}
