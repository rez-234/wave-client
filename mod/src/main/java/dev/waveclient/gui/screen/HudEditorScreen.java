package dev.waveclient.gui.screen;

import java.util.ArrayList;
import java.util.List;

import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FormattedText;
import net.minecraft.util.FormattedCharSequence;

import dev.waveclient.WaveClient;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.hud.HudEditController;
import dev.waveclient.hud.HudLayer;
import dev.waveclient.hud.HudModule;
import dev.waveclient.input.Keybind;
import dev.waveclient.input.ToggleKeyGesture;
import dev.waveclient.module.Module;

/**
 * Lets the player drag, snap and scale every enabled HUD element. Opened with Right Shift by
 * default. All behaviour lives in {@link HudEditController}; this screen forwards input to it and
 * draws the elements with outlines, the resize handle and snap guides.
 */
public final class HudEditorScreen extends Screen {
	private static final Component TITLE = Component.literal("HUD editor");
	private static final String HELP = "Drag to move  \u00b7  Drag the corner or scroll to resize  \u00b7  Arrows nudge (Shift: 10)  \u00b7  R resets  \u00b7  Hold Alt to stop snapping";
	private static final String EMPTY = "No HUD elements are showing. Turn one on with /wave toggle fps";
	private static final int HELP_TOP = 6;
	private static final int GLFW_KEY_R = 82;
	private static final int BUTTON_WIDTH = 84;
	private static final int BUTTON_HEIGHT = 18;
	private static final int BUTTON_GAP = 8;
	private static final int LABEL_GAP = 3;

	private final WaveClient wave;
	private final List<HudModule> elements;
	private final HudEditController controller;
	private final List<EditorButton> buttons = new ArrayList<>(2);
	private List<FormattedCharSequence> helpLines = List.of();
	private List<FormattedCharSequence> emptyLines = List.of();
	private final ToggleKeyGesture editorKey;

	public HudEditorScreen(WaveClient wave) {
		super(TITLE);
		this.wave = wave;
		List<HudModule> enabled = new ArrayList<>();

		for (Module module : wave.modules().all()) {
			if (module instanceof HudModule hud && hud.isEnabled()) {
				enabled.add(hud);
			}
		}

		this.elements = List.copyOf(enabled);
		this.controller = new HudEditController(this.elements);
		this.editorKey = new ToggleKeyGesture(wave.clientSettings().hudEditorKey.isDown());
	}

	@Override
	protected void init() {
		controller.setScreenSize(width, height);

		for (HudModule element : elements) {
			if (element.isActive()) {
				element.prepareForEditor();
			}
		}

		int wrapWidth = Math.max(80, width - 16);
		helpLines = font.split(FormattedText.of(HELP), wrapWidth);
		emptyLines = font.split(FormattedText.of(EMPTY), wrapWidth);

		buttons.clear();
		int y = height - BUTTON_HEIGHT - 10;
		int left = width / 2 - BUTTON_WIDTH - BUTTON_GAP / 2;
		buttons.add(new EditorButton("Reset all", left, y, controller::resetAll));
		buttons.add(new EditorButton("Done", left + BUTTON_WIDTH + BUTTON_GAP, y, this::onClose));
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}

	@Override
	public void renderBackground(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		// A light dim instead of the menu blur, so the world stays visible for placing elements.
		graphics.fill(0, 0, width, height, Theme.withAlpha(Theme.BACKGROUND, 0x60));
		minecraft.gui.renderDeferredSubtitles();
	}

	@Override
	public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		controller.setScreenSize(width, height);
		HudModule dragging = (HudModule) controller.dragging();
		HudModule selected = (HudModule) controller.selected();
		HudModule hovered = dragging != null ? dragging : (HudModule) controller.elementAt(mouseX, mouseY);
		HudModule handle = dragging == null ? (HudModule) controller.handleAt(mouseX, mouseY) : null;

		if (dragging != null) {
			drawCenterLines(graphics);
		}

		boolean anyShown = false;

		for (HudModule element : elements) {
			if (!HudEditController.isVisible(element)) {
				continue;
			}

			anyShown = true;
			HudEditController.Bounds bounds = controller.bounds(element);
			HudLayer.draw(graphics, element, (int) bounds.x(), (int) bounds.y());

			int outline = element == selected ? Theme.ACCENT
					: element == hovered ? Theme.withAlpha(Theme.TEXT, 0xB0)
					: Theme.withAlpha(Theme.TEXT, 0x40);
			drawOutline(graphics, bounds, outline);

			if (element == selected || element == hovered || element == handle) {
				HudEditController.Bounds square = controller.handleBounds(element);
				graphics.fill((int) square.x(), (int) square.y(), (int) Math.ceil(square.right()), (int) Math.ceil(square.bottom()),
						element == handle || controller.isScaling() ? Theme.ACCENT : Theme.withAlpha(Theme.ACCENT, 0xB0));
			}
		}

		drawGuides(graphics);

		HudModule labelled = hovered != null ? hovered : selected;

		List<FormattedCharSequence> lines = anyShown ? helpLines : emptyLines;

		for (int i = 0; i < lines.size(); i++) {
			graphics.drawCenteredString(font, lines.get(i), width / 2, HELP_TOP + i * (font.lineHeight + 1), Theme.TEXT_MUTED);
		}

		if (labelled != null && HudEditController.isVisible(labelled)) {
			drawLabel(graphics, labelled, HELP_TOP + lines.size() * (font.lineHeight + 1) + 2);
		}

		for (EditorButton button : buttons) {
			button.render(graphics, mouseX, mouseY);
		}

		super.render(graphics, mouseX, mouseY, partialTick);
		updateCursor(graphics, mouseX, mouseY, hovered, handle);
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		if (wave.clientSettings().hudEditorKey.get().matchesMouse(event.button())) {
			onClose();
			return true;
		}

		editorKey.onOtherInput();

		if (event.button() == 0) {
			for (EditorButton button : buttons) {
				if (button.contains(event.x(), event.y())) {
					button.action.run();
					return true;
				}
			}

			if (controller.press(event.x(), event.y())) {
				return true;
			}
		}

		return super.mouseClicked(event, doubleClick);
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent event, double dragX, double dragY) {
		editorKey.onOtherInput();

		if (event.button() == 0 && controller.dragging() != null) {
			controller.drag(event.x(), event.y(), !minecraft.hasAltDown());
			return true;
		}

		return super.mouseDragged(event, dragX, dragY);
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent event) {
		editorKey.onOtherInput();

		if (event.button() == 0 && controller.dragging() != null) {
			controller.release();
			return true;
		}

		return super.mouseReleased(event);
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
		editorKey.onOtherInput();

		if (controller.dragging() == null && controller.scroll(mouseX, mouseY, scrollY)) {
			return true;
		}

		return super.mouseScrolled(mouseX, mouseY, scrollX, scrollY);
	}

	/**
	 * The editor key closes the editor on release, as decided by {@link ToggleKeyGesture}: not on
	 * the auto-repeat of the press that opened it, not when used as a modifier (Right Shift +
	 * arrow), and not when pressed in the middle of a drag.
	 */
	@Override
	public boolean keyPressed(KeyEvent event) {
		Keybind key = wave.clientSettings().hudEditorKey.get();

		if (key.matchesKey(event.key())) {
			if (controller.dragging() == null) {
				editorKey.onPress();
			}

			return true;
		}

		editorKey.onOtherInput();
		int step = event.hasShiftDown() ? 10 : 1;
		boolean handled;

		if (event.isLeft()) {
			handled = controller.nudge(-step, 0);
		} else if (event.isRight()) {
			handled = controller.nudge(step, 0);
		} else if (event.isUp()) {
			handled = controller.nudge(0, -step);
		} else if (event.isDown()) {
			handled = controller.nudge(0, step);
		} else if (event.key() == GLFW_KEY_R) {
			handled = controller.resetSelected();
		} else {
			handled = false;
		}

		return handled || super.keyPressed(event);
	}

	@Override
	public boolean keyReleased(KeyEvent event) {
		if (wave.clientSettings().hudEditorKey.get().matchesKey(event.key())) {
			if (editorKey.onRelease()) {
				onClose();
			}

			return true;
		}

		return super.keyReleased(event);
	}

	@Override
	public void removed() {
		controller.release();

		// Save right away rather than waiting for the debounce, in case the game is closed next.
		if (wave.config().isDirty()) {
			wave.config().saveAsync();
		}
	}

	private void drawCenterLines(GuiGraphics graphics) {
		int color = Theme.withAlpha(Theme.TEXT, 0x30);
		// Rounded like the snap guides, so on odd sizes the two lines coincide.
		int centerX = (int) Math.round(width / 2.0);
		int centerY = (int) Math.round(height / 2.0);
		graphics.fill(centerX, 0, centerX + 1, height, color);
		graphics.fill(0, centerY, width, centerY + 1, color);
	}

	private void drawGuides(GuiGraphics graphics) {
		int color = Theme.withAlpha(Theme.ACCENT, 0xCC);
		double guideX = controller.guideX();
		double guideY = controller.guideY();

		if (!Double.isNaN(guideX)) {
			// A guide on the right screen edge would be off-screen; keep it visible.
			int x = Math.min(width - 1, (int) Math.round(guideX));
			graphics.fill(x, 0, x + 1, height, color);
		}

		if (!Double.isNaN(guideY)) {
			int y = Math.min(height - 1, (int) Math.round(guideY));
			graphics.fill(0, y, width, y + 1, color);
		}
	}

	/** A 1px frame just outside the element, so it never covers the element itself. */
	private static void drawOutline(GuiGraphics graphics, HudEditController.Bounds bounds, int color) {
		int left = (int) bounds.x() - 1;
		int top = (int) bounds.y() - 1;
		int right = (int) Math.ceil(bounds.right()) + 1;
		int bottom = (int) Math.ceil(bounds.bottom()) + 1;
		graphics.fill(left, top, right, top + 1, color);
		graphics.fill(left, bottom - 1, right, bottom, color);
		graphics.fill(left, top + 1, left + 1, bottom - 1, color);
		graphics.fill(right - 1, top + 1, right, bottom - 1, color);
	}

	/** The element's name and scale, above it (or below when there's no room under the help text). */
	private void drawLabel(GuiGraphics graphics, HudModule element, int minTop) {
		HudEditController.Bounds bounds = controller.bounds(element);
		String text = element.name() + "  " + Math.round(element.position.scale() * 100) + "%";
		int textWidth = font.width(text);
		int x = (int) Math.max(2, Math.min(width - textWidth - 2, bounds.x()));
		int above = (int) bounds.y() - font.lineHeight - LABEL_GAP;
		int y = above >= minTop ? above : (int) Math.ceil(bounds.bottom()) + LABEL_GAP + 1;
		graphics.fill(x - 2, y - 2, x + textWidth + 2, y + font.lineHeight, Theme.withAlpha(Theme.SURFACE, 0xE0));
		graphics.drawString(font, text, x, y, Theme.TEXT, false);
	}

	private void updateCursor(GuiGraphics graphics, int mouseX, int mouseY, HudModule hovered, HudModule handle) {
		if (handle != null || controller.isScaling()) {
			graphics.requestCursor(CursorTypes.CROSSHAIR);
		} else if (hovered != null) {
			graphics.requestCursor(CursorTypes.RESIZE_ALL);
		} else {
			for (EditorButton button : buttons) {
				if (button.contains(mouseX, mouseY)) {
					graphics.requestCursor(CursorTypes.POINTING_HAND);
					return;
				}
			}
		}
	}

	/** A flat button in the shared visual style. */
	private final class EditorButton {
		private final String label;
		private final int x;
		private final int y;
		private final Runnable action;

		EditorButton(String label, int x, int y, Runnable action) {
			this.label = label;
			this.x = x;
			this.y = y;
			this.action = action;
		}

		boolean contains(double px, double py) {
			return px >= x && px < x + BUTTON_WIDTH && py >= y && py < y + BUTTON_HEIGHT;
		}

		void render(GuiGraphics graphics, int mouseX, int mouseY) {
			boolean hover = contains(mouseX, mouseY);
			graphics.fill(x, y, x + BUTTON_WIDTH, y + BUTTON_HEIGHT, hover ? Theme.ACCENT : Theme.BORDER);
			graphics.fill(x + 1, y + 1, x + BUTTON_WIDTH - 1, y + BUTTON_HEIGHT - 1, Theme.SURFACE_RAISED);
			graphics.drawCenteredString(font, label, x + BUTTON_WIDTH / 2, y + (BUTTON_HEIGHT - 8) / 2, Theme.TEXT);
		}
	}
}
