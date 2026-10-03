package dev.waveclient.module.impl.chat;

import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.google.common.collect.MapMaker;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.GuiMessage;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.client.gui.components.toasts.SystemToast;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.Style;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.util.Mth;

import dev.waveclient.mixin.ChatComponentAccessor;
import dev.waveclient.module.Category;
import dev.waveclient.module.Module;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.ColorSetting;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.setting.Setting;
import dev.waveclient.setting.SliderSetting;
import dev.waveclient.util.ChatText;

/**
 * Chat tweaks: timestamps on new messages, chat that stays when you leave a world or server, a
 * longer history, and copying a message by clicking it.
 *
 * <p>Timestamps are added to the message as it arrives (so turning them off doesn't remove
 * existing ones) and kept out of the game log, which overlay tools read. Signatures and tags
 * pass through untouched, so servers can still delete messages and chat reports still work.
 */
// Settings register change listeners that capture 'this', but they only run on later edits.
@SuppressWarnings("this-escape")
public final class ChatModule extends Module {
	/** Chat Patches adds its own timestamps; ours would double them. */
	private static final boolean CHAT_PATCHES = FabricLoader.getInstance().isModLoaded("chatpatches");
	private static final int PREVIEW_CHARS = 40;

	public final BooleanSetting timestamps = add(new BooleanSetting("timestamps", "Timestamps", true)
			.describe(CHAT_PATCHES ? "Off because Chat Patches adds its own." : "Show when each new message arrived."));
	public final BooleanSetting twelveHour = add(new BooleanSetting("twelveHour", "12-hour clock", false)
			.describe("2:05 PM instead of 14:05.")
			.visibleWhen(timestamps::get));
	public final BooleanSetting seconds = add(new BooleanSetting("seconds", "Show seconds", false)
			.visibleWhen(timestamps::get));
	public final ColorSetting timestampColor = add(new ColorSetting("timestampColor", "Timestamp color", 0xFFAAAAAA, false)
			.visibleWhen(timestamps::get));
	public final BooleanSetting keepChat = add(new BooleanSetting("keepChat", "Keep chat", true)
			.describe("Chat and your sent messages stay when you leave a world or server. F3 + D still clears it."));
	public final SliderSetting historyLength = add(new SliderSetting("historyLength", "Messages kept", 500, 100, 2000, 50)
			.describe("How far back you can scroll. Vanilla keeps 100."));
	public final BooleanSetting copyMessages = add(new BooleanSetting("copyMessages", "Copy messages", true)
			.describe("Click a message in open chat to copy its text."));
	public final EnumSetting<CopyTrigger> copyTrigger = add(new EnumSetting<>("copyTrigger", "Copy with", CopyTrigger.CTRL_CLICK)
			.visibleWhen(copyMessages::get));
	public final BooleanSetting copyTimestamp = add(new BooleanSetting("copyTimestamp", "Copy the timestamp too", false)
			.visibleWhen(() -> copyMessages.get() && timestamps.get()));

	/** Each stamped message's text without the stamp, for copying. Weak, identity keys. */
	private final Map<GuiMessage, Component> unstamped = new MapMaker().weakKeys().makeMap();
	private final StringBuilder text = new StringBuilder(16);
	private Style stampStyle;
	private SystemToast.SystemToastId copiedToast;
	private String lastCopied;

	public ChatModule() {
		super("chat", "Chat", "Timestamps, chat that stays between worlds, a longer history, and copying messages.", Category.CHAT);
	}

	@Override
	protected void onSettingChanged(Setting<?> setting) {
		if (setting == timestampColor) {
			stampStyle = null;
		}
	}

	/** The message with a timestamp in front, or {@code null} to leave it as it is. */
	public Component stamp(Component message) {
		if (!isActive() || !timestamps.get() || CHAT_PATCHES || !ChatText.hasText(plain(message))) {
			return null;
		}

		if (stampStyle == null) {
			stampStyle = Style.EMPTY.withColor(timestampColor.get() & 0xFFFFFF);
		}

		LocalTime now = LocalTime.now();
		text.setLength(0);
		ChatText.appendStamp(text, now.getHour(), now.getMinute(), now.getSecond(), twelveHour.get(), seconds.get());
		// Siblings, so neither style leaks into the other.
		return Component.empty().append(Component.literal(text.toString()).withStyle(stampStyle)).append(message);
	}

	/** Called with the stored message and its text before the stamp. */
	public void rememberUnstamped(GuiMessage message, Component original) {
		unstamped.put(message, original);
	}

	public int historyLimit(int current) {
		return ChatLines.historyLimit(current, isActive(), historyLength.getInt());
	}

	/** Whether leaving a world or server should keep the chat. */
	public boolean keepsChat() {
		return isActive() && keepChat.get();
	}

	/** The last text copied from chat, for the game test (the clipboard isn't readable there). */
	public String lastCopied() {
		return lastCopied;
	}

	/**
	 * A click in the chat screen. Copies the message under the mouse if it is the copy click.
	 *
	 * @return whether the click was used
	 */
	public boolean tryCopy(MouseButtonEvent event) {
		if (!isActive() || !copyMessages.get() || !copyTrigger.get().matches(event.button(), event.hasControlDownWithQuirk(), event.hasShiftDown())) {
			return false;
		}

		Minecraft minecraft = Minecraft.getInstance();
		String copied = messageAt(minecraft, event.x(), event.y());

		if (copied == null || copied.isBlank()) {
			return false;
		}

		minecraft.keyboardHandler.setClipboard(copied);
		lastCopied = copied;

		if (copiedToast == null) {
			copiedToast = new SystemToast.SystemToastId(2000L);
		}

		SystemToast.addOrUpdate(minecraft.getToastManager(), copiedToast, Component.literal("Copied to clipboard"),
				Component.literal(ChatText.preview(copied, PREVIEW_CHARS)));
		return true;
	}

	/** The plain text of the message at a screen position, or {@code null}. */
	private String messageAt(Minecraft minecraft, double x, double y) {
		ChatComponent chat = minecraft.gui.getChat();
		ChatComponentAccessor access = (ChatComponentAccessor) chat;
		double scale = access.waveclient$scale();
		int rowRight = Mth.ceil(access.waveclient$width() / scale) + 8;
		ChatLineHit hit = new ChatLineHit((float) x, (float) y, minecraft.options.chatLineSpacing().get(), rowRight);
		chat.captureClickableText(hit, minecraft.getWindow().getGuiScaledHeight(), minecraft.gui.getGuiTicks(), true);
		FormattedCharSequence clicked = hit.result();

		// EMPTY is shared by every blank line, so it can't identify one.
		if (clicked == null || clicked == FormattedCharSequence.EMPTY) {
			return null;
		}

		List<GuiMessage.Line> lines = access.waveclient$trimmedMessages();
		int lineIndex = -1;

		for (int i = 0; i < lines.size(); i++) {
			if (lines.get(i).content() == clicked) {
				lineIndex = i;
				break;
			}
		}

		// Not a stored line: the "[+N pending lines]" row, which vanilla expands on click.
		if (lineIndex < 0) {
			return null;
		}

		List<GuiMessage> messages = access.waveclient$allMessages();
		int messageIndex = ChatLines.messageIndex(i -> lines.get(i).endOfEntry(), lines.size(), lineIndex);
		GuiMessage message = messageIndex >= 0 && messageIndex < messages.size() ? messages.get(messageIndex) : null;

		if (message == null || message.addedTime() != lines.get(lineIndex).addedTime()) {
			// Another mod changed the lists; copy just the clicked line.
			StringBuilder line = new StringBuilder();
			clicked.accept((position, style, codePoint) -> {
				line.appendCodePoint(codePoint);
				return true;
			});
			return ChatText.plain(line).strip();
		}

		Component content = message.content();

		if (!copyTimestamp.get()) {
			Component original = unstamped.get(message);

			if (original != null) {
				content = original;
			}
		}

		return plain(content).strip();
	}

	/** Text in reading order, without formatting codes or sprite placeholders. */
	private static String plain(Component component) {
		StringBuilder out = new StringBuilder();
		component.visit((style, segment) -> {
			ChatText.appendPlain(out, segment);
			return Optional.empty();
		}, Style.EMPTY);
		return out.toString();
	}
}
