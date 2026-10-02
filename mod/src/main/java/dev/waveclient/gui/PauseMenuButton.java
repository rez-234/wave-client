package dev.waveclient.gui;

import java.util.ArrayList;
import java.util.List;

import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.fabricmc.fabric.api.event.Event;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.SpriteIconButton;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.contents.TranslatableContents;
import net.minecraft.resources.Identifier;

import dev.waveclient.WaveClient;
import dev.waveclient.gui.menu.ModMenuScreen;

/**
 * Adds a Wave Client icon button to the pause menu, beside "Options...". Done through Fabric's
 * screen events rather than a mixin, in a phase that runs after other mods' listeners, so the
 * free-spot check sees their buttons too (Mod Menu rearranges the menu in several ways).
 */
public final class PauseMenuButton {
	private static final Identifier LATE = Identifier.fromNamespaceAndPath(WaveClient.MOD_ID, "late");
	/** {@code assets/waveclient/textures/gui/sprites/icon/wave.png}, 15x15 like vanilla's icons. */
	private static final Identifier ICON = Identifier.fromNamespaceAndPath(WaveClient.MOD_ID, "icon/wave");
	private static final int ICON_SIZE = 15;

	private PauseMenuButton() {
	}

	public static void register(WaveClient wave) {
		ScreenEvents.AFTER_INIT.addPhaseOrdering(Event.DEFAULT_PHASE, LATE);
		// Runs after every init and resize: the pause screen rebuilds its widgets each time, so
		// the button is added again rather than kept.
		ScreenEvents.AFTER_INIT.register(LATE, (client, screen, width, height) -> {
			if (!(screen instanceof PauseScreen pause) || !pause.showsPauseMenu() || !wave.clientSettings().pauseMenuButton.get()) {
				return;
			}

			List<AbstractWidget> buttons = Screens.getButtons(screen);
			AbstractWidget options = null;
			List<ButtonPlacement.Rect> visible = new ArrayList<>();

			for (AbstractWidget button : buttons) {
				if (options == null && hasTranslationKey(button, "menu.options")) {
					options = button;
				}

				if (button.visible) {
					visible.add(rect(button));
				}
			}

			if (options == null) {
				// Another mod replaced the pause menu; the keybind and the HUD editor still work.
				return;
			}

			ButtonPlacement.Rect spot = ButtonPlacement.choose(rect(options), visible, width, height);

			if (spot == null) {
				return;
			}

			SpriteIconButton button = SpriteIconButton.builder(Component.translatable("waveclient.menu.open"),
							pressed -> client.setScreen(new ModMenuScreen(wave, screen)), true)
					.size(ButtonPlacement.SIZE, ButtonPlacement.SIZE)
					.sprite(ICON, ICON_SIZE, ICON_SIZE)
					.withTootip()
					.build();
			button.setPosition(spot.x(), spot.y());
			// Just before Options in the Tab order.
			buttons.add(buttons.indexOf(options), button);
		});
	}

	private static ButtonPlacement.Rect rect(AbstractWidget widget) {
		return new ButtonPlacement.Rect(widget.getX(), widget.getY(), widget.getWidth(), widget.getHeight());
	}

	/** Matches by translation key, so it works in every language. */
	private static boolean hasTranslationKey(AbstractWidget widget, String key) {
		return widget instanceof net.minecraft.client.gui.components.Button
				&& widget.getMessage().getContents() instanceof TranslatableContents contents
				&& key.equals(contents.getKey());
	}
}
