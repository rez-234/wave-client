package dev.waveclient.gui.menu;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.util.Util;
import org.joml.Matrix3x2fStack;

import dev.waveclient.ClientSettings;
import dev.waveclient.WaveClient;
import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.render.Text;
import dev.waveclient.gui.screen.HudEditorScreen;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.gui.widget.Anim;
import dev.waveclient.gui.widget.Button;
import dev.waveclient.gui.widget.KeybindWidget;
import dev.waveclient.gui.widget.Popover;
import dev.waveclient.gui.widget.PopoverHost;
import dev.waveclient.gui.widget.ScrollState;
import dev.waveclient.gui.widget.TextField;
import dev.waveclient.gui.widget.TextFieldModel;
import dev.waveclient.gui.widget.Widget;
import dev.waveclient.input.KeyNames;
import dev.waveclient.input.ToggleKeyGesture;
import dev.waveclient.module.Category;
import dev.waveclient.module.Module;
import dev.waveclient.module.SettingContainer;
import dev.waveclient.setting.KeybindSetting;
import dev.waveclient.setting.Setting;

/**
 * The mod menu: a sidebar of categories, a search box, module cards with switches, and a
 * settings page per module, all drawn with the launcher's colors and Inter.
 *
 * <p>Everything is drawn and hit-tested here rather than with vanilla widgets, so input is
 * routed by hand: an open popover gets every event first, then a keybind waiting for a key,
 * then the focused widget, then the screen's own shortcuts. Escape closes the popover, cancels
 * the keybind, clears the search, or finally closes the menu, in that order.
 */
public final class ModMenuScreen extends Screen implements PopoverHost {
	private static final Component TITLE = Component.literal("Wave Client");
	private static final MenuState STATE = new MenuState();
	private static final int HEADER_HEIGHT = 32;
	private static final int SIDEBAR_ITEM_HEIGHT = 20;
	private static final int SCROLLBAR_GUTTER = 8;
	private static final double SCROLL_STEP = 30;
	private static final long TOOLTIP_DELAY_MS = 450;
	private static final int TOOLTIP_MAX_WIDTH = 180;
	private static final int GLFW_KEY_F = 70;
	private static final int GLFW_KEY_BACKSPACE = 259;
	private static final int GLFW_MOUSE_BUTTON_BACK = 3;

	private final WaveClient wave;
	private final Screen parent;
	private final Painter painter = new Painter();
	private final ScrollState scroll = new ScrollState();
	private final TextField search;
	private final Button close;
	private final Button editHud;
	private final List<SidebarItem> sidebar = new ArrayList<>();
	/** The header and sidebar widgets, which don't scroll. */
	private final List<Widget> chrome = new ArrayList<>();
	private final Map<KeybindSetting, String> keybindOwners = new IdentityHashMap<>();
	private final ToggleKeyGesture menuKey;
	private final Text wordmark = new Text(UiFont.HEADING, "Wave Client");
	private final Text version = new Text(UiFont.BODY, WaveClient.version());
	private final Text tooltipText = new Text(UiFont.BODY);

	private int panelX;
	private int panelY;
	private int panelWidth;
	private int panelHeight;
	private int sidebarWidth;
	private int contentX;
	private int contentY;
	private int contentWidth;
	private int contentHeight;

	private MenuPage page;
	private int layoutGeneration = Integer.MIN_VALUE;
	private Popover popover;
	private Widget focused;
	private Widget pressed;
	private boolean pressedInContent;
	private boolean pressedPopover;
	private boolean draggingScrollbar;
	private long lastFrame;
	private Object tooltipOwner;
	private long tooltipSince;
	private String tooltip;
	private float sidebarIndicator = Float.NaN;
	/**
	 * A key whose auto-repeats and release are ignored; see {@link #swallow}. Its release
	 * would otherwise reach Minecraft too (releasing F3 toggles the debug screen).
	 */
	private int swallowedKey = -1;
	/** Set by {@link #swallow} and the menu key until the next key press; see there. */
	private boolean swallowChars;
	/** Whether focus moved by keyboard, so focus rings should show (not after a click). */
	private boolean focusVisible;

	public ModMenuScreen(WaveClient wave, Screen parent) {
		this(wave, parent, null);
	}

	/**
	 * @param module a module whose settings to show right away (from the HUD editor's
	 *               right-click), or {@code null} to show where the menu was last left
	 */
	public ModMenuScreen(WaveClient wave, Screen parent, Module module) {
		super(TITLE);
		this.wave = wave;
		this.parent = parent;
		this.menuKey = new ToggleKeyGesture(wave.clientSettings().modMenuKey.isDown());
		this.search = new TextField(new TextFieldModel(64), "Search modules");
		this.search.onChange(query -> showList());
		this.close = new Button("×", Button.Kind.GHOST, this::onClose).tooltip("Close (Esc)");
		this.editHud = new Button("Edit HUD layout", Button.Kind.SECONDARY, this::openHudEditor).usableWhen(this::canEditHud);

		if (module != null) {
			STATE.setOpenModule(module.id());

			if (STATE.section() instanceof MenuState.ClientSettings) {
				STATE.setSection(new MenuState.OfCategory(module.category()));
			}
		}

		sidebar.add(new SidebarItem("All modules", () -> STATE.section() instanceof MenuState.All && !searching(), () -> selectSection(MenuState.ALL)));

		for (Category category : Category.values()) {
			if (!wave.modules().byCategory(category).isEmpty()) {
				MenuState.Section section = new MenuState.OfCategory(category);
				sidebar.add(new SidebarItem(category.label(), () -> section.equals(STATE.section()) && !searching(), () -> selectSection(section)));
			}
		}

		sidebar.add(new SidebarItem("Settings", () -> STATE.section() instanceof MenuState.ClientSettings, () -> selectSection(MenuState.CLIENT_SETTINGS)));

		for (Module m : wave.modules().all()) {
			collectKeybinds(m, m.name());
		}

		collectKeybinds(wave.clientSettings(), "Settings");
		chrome.add(search);
		chrome.add(close);
		chrome.add(editHud);
		chrome.addAll(sidebar);
	}

	private void collectKeybinds(SettingContainer container, String owner) {
		for (Setting<?> setting : container.settings()) {
			if (setting instanceof KeybindSetting keybind) {
				keybindOwners.put(keybind, setting.name() + " (" + owner + ")");
			}
		}
	}

	/** The other Wave Client bindings on the same key, or {@code null}. */
	private String conflictsOf(KeybindSetting setting) {
		StringBuilder names = null;

		for (Map.Entry<KeybindSetting, String> entry : keybindOwners.entrySet()) {
			KeybindSetting other = entry.getKey();

			if (other != setting && other.get().equals(setting.get())) {
				names = names == null ? new StringBuilder() : names.append(", ");
				names.append(entry.getValue());
			}
		}

		return names == null ? null : names.toString();
	}

	private boolean useInter() {
		return wave.clientSettings().menuFont.get() == ClientSettings.MenuFont.INTER;
	}

	private boolean searching() {
		return !ModuleSearch.normalize(search.value()).isEmpty();
	}

	private boolean canEditHud() {
		return minecraft != null && minecraft.level != null && minecraft.player != null;
	}

	// Layout.

	@Override
	protected void init() {
		int margin = width >= 400 ? 16 : 6;
		panelWidth = Math.min(width - 2 * margin, 640);
		panelHeight = Math.min(height - 2 * margin, 380);
		panelX = (width - panelWidth) / 2;
		panelY = (height - panelHeight) / 2;
		sidebarWidth = panelWidth >= 480 ? 116 : 90;
		contentX = panelX + sidebarWidth;
		contentY = panelY + HEADER_HEIGHT;
		contentWidth = panelWidth - sidebarWidth;
		contentHeight = panelHeight - HEADER_HEIGHT;

		// init() runs again after resizes and resource reloads: measure all text afresh.
		painter.invalidateText();
		painter.prepare(font, useInter());
		double centerY = panelY + HEADER_HEIGHT / 2.0;
		close.setBounds(panelX + panelWidth - 8 - 16, centerY - 8, 16, 16);
		int searchWidth = Math.max(100, Math.min(190, (int) (panelWidth * 0.32)));
		search.setBounds(close.x() - 6 - searchWidth, centerY - TextField.HEIGHT / 2.0, searchWidth, TextField.HEIGHT);

		double itemY = contentY + 8;

		for (int i = 0; i < sidebar.size(); i++) {
			// A gap above "Settings", the last item, to set it apart from the categories.
			if (i == sidebar.size() - 1) {
				itemY += 9;
			}

			sidebar.get(i).setBounds(panelX + 6, itemY, sidebarWidth - 12, SIDEBAR_ITEM_HEIGHT);
			itemY += SIDEBAR_ITEM_HEIGHT + 2;
		}

		// The HUD editor shortcut sits at the bottom of the sidebar, if the categories leave room.
		int editHudY = panelY + panelHeight - 8 - Button.HEIGHT;
		boolean editHudFits = itemY + 4 <= editHudY;
		editHud.setBounds(panelX + 6, editHudY, editHudFits ? sidebarWidth - 12 : 0, editHudFits ? Button.HEIGHT : 0);
		editHud.tooltip(canEditHud() ? null : "Join a world to move HUD elements.");

		if (page == null) {
			page = initialPage();
			layoutPage(STATE.scroll(page.key()));
		} else {
			closePopover();
			layoutPage(scroll.target());
		}
	}

	private MenuPage initialPage() {
		String openId = STATE.openModule();
		Module module = openId != null ? wave.modules().byId(openId) : null;

		if (module != null) {
			return moduleSettings(module);
		}

		STATE.setOpenModule(null);
		return STATE.section() instanceof MenuState.ClientSettings ? clientSettings() : list();
	}

	private void layoutPage(double scrollTo) {
		painter.prepare(font, useInter());
		int height = page.layout(painter, contentX, contentY, contentWidth - SCROLLBAR_GUTTER);
		scroll.setBounds(height, contentHeight);
		scroll.jumpTo(scrollTo);
		layoutGeneration = painter.generation();

		if (focused != null && focused != search && !page.widgets().contains(focused)) {
			setFocus(null);
		}

		if (pressed != null && pressedInContent && !page.widgets().contains(pressed)) {
			pressed = null;
		}
	}

	private void showPage(MenuPage next, double scrollTo) {
		if (page != null) {
			STATE.setScroll(page.key(), scroll.target());
		}

		closePopover();
		page = next;
		layoutPage(scrollTo);
	}

	private MenuPage list() {
		return new ModuleListPage(wave.modules().all(), STATE.section(), search.value(), this::openModule);
	}

	private MenuPage moduleSettings(Module module) {
		return new SettingsPage(SettingsPage.Subject.of(module), this, this::conflictsOf, pageActions());
	}

	private MenuPage clientSettings() {
		return new SettingsPage(new SettingsPage.Subject("client", "Settings", "Options for Wave Client itself.", wave.clientSettings(), null),
				this, this::conflictsOf, pageActions());
	}

	private SettingsPage.Actions pageActions() {
		return new SettingsPage.Actions() {
			@Override
			public void back() {
				if (STATE.section() instanceof MenuState.ClientSettings) {
					STATE.setSection(MenuState.ALL);
				}

				STATE.setOpenModule(null);
				MenuPage next = list();
				showPage(next, STATE.scroll(next.key()));
			}

			@Override
			public void editHud() {
				openHudEditor();
			}

			@Override
			public boolean canEditHud() {
				return ModMenuScreen.this.canEditHud();
			}
		};
	}

	private void showList() {
		STATE.setOpenModule(null);

		if (STATE.section() instanceof MenuState.ClientSettings && searching()) {
			STATE.setSection(MenuState.ALL);
		}

		MenuPage next = STATE.section() instanceof MenuState.ClientSettings ? clientSettings() : list();
		showPage(next, searching() ? 0 : STATE.scroll(next.key()));
	}

	/** Shows {@code module}'s settings; used when the HUD editor returns here on a right-click. */
	public void showModule(Module module) {
		if (STATE.section() instanceof MenuState.ClientSettings) {
			STATE.setSection(new MenuState.OfCategory(module.category()));
		}

		search.setValue("");
		openModule(module);
	}

	private void openModule(Module module) {
		STATE.setOpenModule(module.id());
		showPage(moduleSettings(module), 0);
	}

	private void selectSection(MenuState.Section section) {
		STATE.setSection(section);
		search.setValue("");
		showList();
	}

	private void openHudEditor() {
		if (!canEditHud()) {
			return;
		}

		// Opened from the editor: go back to it rather than stacking a second one. Otherwise the
		// editor returns here when closed.
		minecraft.setScreen(parent instanceof HudEditorScreen ? parent : new HudEditorScreen(wave, this));
	}

	// Rendering.

	@Override
	public boolean isPauseScreen() {
		// Pause only when opened from the pause menu; from the HUD editor or a key the world
		// keeps running, like it does in multiplayer.
		return parent != null && parent.isPauseScreen();
	}

	@Override
	public void renderBackground(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		// No blur: a flat dim in a world, and an opaque background on the title screen.
		boolean inWorld = minecraft.level != null;
		graphics.fill(0, 0, width, height, inWorld ? Theme.withAlpha(Theme.BACKGROUND, 0xA0) : Theme.BACKGROUND);
	}

	@Override
	public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		long now = Util.getMillis();
		float seconds = lastFrame == 0 ? 0 : Math.min(0.25f, (now - lastFrame) / 1000f);
		lastFrame = now;
		painter.begin(graphics, font, useInter());
		painter.setFocusVisible(focusVisible);

		if (painter.generation() != layoutGeneration || page.needsLayout()) {
			layoutPage(scroll.target());
		}

		if (popover != null && popover.isClosed()) {
			closePopover();
		}

		scroll.update(seconds);
		double offset = Math.round(scroll.offset() * painter.scale()) / (double) painter.scale();
		boolean overPopover = popover != null && popover.contains(mouseX, mouseY);
		boolean overContent = !overPopover && inContent(mouseX, mouseY);
		// While a popover is open, nothing behind it reacts to the pointer.
		Widget hovered = popover != null ? null : widgetAt(mouseX, mouseY, offset);
		CursorType cursor = CursorTypes.ARROW;

		renderFrame();

		for (SidebarItem item : sidebar) {
			item.render(painter, item == hovered, mouseX, mouseY, seconds);
		}

		renderSidebarIndicator(seconds);
		editHud.render(painter, editHud == hovered, mouseX, mouseY, seconds);
		search.render(painter, search == hovered, mouseX, mouseY, seconds);
		close.render(painter, close == hovered, mouseX, mouseY, seconds);

		painter.pushClip(contentX, contentY, contentWidth, contentHeight);
		Matrix3x2fStack pose = graphics.pose();
		pose.pushMatrix();
		pose.translate(0, (float) -offset);

		try {
			double pageMouseY = mouseY + offset;
			page.renderBackground(painter, mouseX, pageMouseY, overContent, seconds);

			double visibleTop = contentY + offset;
			double visibleBottom = visibleTop + contentHeight;

			for (Widget widget : page.widgets()) {
				// Skip widgets scrolled out of view: the scissor would hide them, but they would
				// still cost layering work.
				if (widget.bottom() > visibleTop && widget.y() < visibleBottom) {
					widget.render(painter, widget == hovered, mouseX, pageMouseY, seconds);
				}
			}
		} finally {
			pose.popMatrix();
			painter.popClip();
		}

		renderScrollbar(mouseX, mouseY);

		if (hovered != null) {
			double y = page.widgets().contains(hovered) ? mouseY + offset : mouseY;
			cursor = hovered.cursor(mouseX, y);
			updateTooltip(hovered, hovered.tooltip(mouseX, y), now);
		} else {
			updateTooltip(null, null, now);
		}

		if (draggingScrollbar) {
			cursor = CursorTypes.RESIZE_NS;
		}

		if (popover != null) {
			graphics.nextStratum();
			popover.render(painter, mouseX, mouseY, seconds);

			if (overPopover) {
				cursor = popover.cursor(mouseX, mouseY);
			}
		}

		if (pressed != null) {
			cursor = pressed.cursor(mouseX, pressedInContent ? mouseY + offset : mouseY);
		}

		if (tooltip != null && now - tooltipSince >= TOOLTIP_DELAY_MS && pressed == null) {
			graphics.nextStratum();
			renderTooltip(mouseX, mouseY);
		}

		graphics.requestCursor(cursor);
	}

	private void renderFrame() {
		painter.roundRect(panelX, panelY, panelWidth, panelHeight, Theme.RADIUS_MEDIUM, Theme.BACKGROUND, Theme.BORDER);
		float line = painter.hairline() * painter.borderWidth();
		painter.rect(panelX, contentY, panelWidth, line, Theme.BORDER);
		painter.rect(contentX - line, contentY, line, contentHeight, Theme.BORDER);

		double centerY = panelY + HEADER_HEIGHT / 2.0;
		wordmark.drawCentered(painter, panelX + 14, centerY, Theme.TEXT);
		double versionX = panelX + 14 + wordmark.width(painter) + 6;
		int room = (int) (search.x() - 8 - versionX);

		if (room > 20) {
			version.drawFitted(painter, versionX, centerY, room, Theme.TEXT_MUTED);
		}
	}

	/** The accent bar beside the selected sidebar item, sliding between items. */
	private void renderSidebarIndicator(float seconds) {
		SidebarItem selected = null;

		for (SidebarItem item : sidebar) {
			if (item.selected()) {
				selected = item;
			}
		}

		if (selected == null) {
			sidebarIndicator = Float.NaN;
			return;
		}

		float target = (float) selected.y();
		sidebarIndicator = Float.isNaN(sidebarIndicator) ? target : Anim.approach(sidebarIndicator, target, seconds, 20);
		painter.pill(selected.x() + 1, sidebarIndicator + 5, 2, SIDEBAR_ITEM_HEIGHT - 10, Theme.ACCENT);
	}

	private double trackX() {
		return contentX + contentWidth - SCROLLBAR_GUTTER + 2;
	}

	private void renderScrollbar(int mouseX, int mouseY) {
		if (!scroll.canScroll()) {
			return;
		}

		ScrollState.Thumb thumb = scroll.thumb(contentY + 6, contentHeight - 12, 16);
		boolean active = draggingScrollbar || (inScrollbar(mouseX, mouseY) && popover == null);
		painter.pill(trackX(), thumb.y(), 3, thumb.height(), active ? Theme.TEXT_MUTED : Theme.withAlpha(Theme.TEXT_MUTED, 0x70));
	}

	private void updateTooltip(Object owner, String text, long now) {
		if (owner != tooltipOwner || text == null || !text.equals(tooltip)) {
			tooltipOwner = owner;
			tooltip = text;
			tooltipSince = now;
		}
	}

	private void renderTooltip(int mouseX, int mouseY) {
		tooltipText.set(tooltip);
		List<FormattedCharSequence> lines = tooltipText.lines(painter, TOOLTIP_MAX_WIDTH);
		float widest = 0;

		for (FormattedCharSequence line : lines) {
			widest = Math.max(widest, painter.width(line));
		}

		int lineHeight = 11;
		int boxWidth = (int) Math.ceil(widest) + 12;
		int boxHeight = lines.size() * lineHeight + 8;
		double x = mouseX + 10;
		double y = mouseY + 12;

		if (x + boxWidth > width - 4) {
			x = mouseX - 6 - boxWidth;
		}

		if (y + boxHeight > height - 4) {
			y = mouseY - 6 - boxHeight;
		}

		x = Math.max(4, x);
		y = Math.max(4, y);
		painter.roundRect(x, y, boxWidth, boxHeight, Theme.RADIUS_SMALL, Theme.SURFACE_RAISED, Theme.BORDER);

		for (int i = 0; i < lines.size(); i++) {
			painter.text(lines.get(i), x + 6, painter.textTopForCenter(UiFont.BODY, y + 4 + i * lineHeight + lineHeight / 2.0), Theme.TEXT);
		}
	}

	// Hit testing.

	private boolean inContent(double mouseX, double mouseY) {
		return mouseX >= contentX && mouseX < contentX + contentWidth && mouseY >= contentY && mouseY < contentY + contentHeight;
	}

	private boolean inScrollbar(double mouseX, double mouseY) {
		return scroll.canScroll() && inContent(mouseX, mouseY) && mouseX >= trackX() - 2;
	}

	/** The widget under the pointer outside any popover; content widgets are tested in page coordinates. */
	private Widget widgetAt(double mouseX, double mouseY, double offset) {
		for (Widget widget : headerAndSidebar()) {
			if (widget.contains(mouseX, mouseY)) {
				return widget;
			}
		}

		if (inContent(mouseX, mouseY) && !inScrollbar(mouseX, mouseY)) {
			return page.widgetAt(mouseX, mouseY + offset);
		}

		return null;
	}

	private List<Widget> headerAndSidebar() {
		return chrome;
	}

	private double pageOffset() {
		return Math.round(scroll.offset() * painter.scale()) / (double) painter.scale();
	}

	// Popovers and focus.

	@Override
	public void openPopover(Popover next, Widget anchor) {
		closePopover();
		// Finish any scroll easing first, or the content would keep moving under the popover.
		scroll.jumpTo(scroll.target());
		double y = page.widgets().contains(anchor) ? anchor.y() - pageOffset() : anchor.y();
		next.place(painter, anchor.x(), y, anchor.width(), anchor.height(), width, height);
		popover = next;
		setFocus(anchor);
	}

	private void closePopover() {
		if (popover != null) {
			popover.onClosed();
			popover = null;
			pressedPopover = false;
		}
	}

	private void setFocus(Widget widget) {
		if (focused != widget) {
			if (focused != null) {
				focused.setFocused(false);
			}

			focused = widget;

			if (widget != null) {
				widget.setFocused(true);
			}
		}
	}

	// Input.

	private static boolean isListening(Widget widget) {
		return widget instanceof KeybindWidget keybind && keybind.isListening();
	}

	/**
	 * Ignores this key's auto-repeats and release, and the character it types: it just changed
	 * what the next key press means (started or finished capturing a binding, opened or picked
	 * from a popover), so holding it must not act again.
	 */
	private void swallow(int key) {
		swallowedKey = key;
		swallowChars = true;
	}

	@Override
	public boolean mouseClicked(MouseButtonEvent event, boolean doubleClick) {
		double x = event.x();
		double y = event.y();
		int button = event.button();
		focusVisible = false;

		if (isListening(focused)) {
			return ((KeybindWidget) focused).captureMouse(button);
		}

		if (wave.clientSettings().modMenuKey.get().matchesMouse(button)) {
			menuKey.onPress();
			return true;
		}

		menuKey.onOtherInput();

		if (popover != null) {
			if (popover.contains(x, y)) {
				popover.mouseClicked(x, y, button, doubleClick);
				pressedPopover = true;
			} else {
				closePopover();
			}

			return true;
		}

		if (button == GLFW_MOUSE_BUTTON_BACK) {
			return page.goBack();
		}

		if (button == 0 && inScrollbar(x, y)) {
			setFocus(null);
			draggingScrollbar = true;
			scroll.beginThumbDrag(y, contentY + 6, contentHeight - 12, 16);
			return true;
		}

		double offset = pageOffset();
		Widget target = widgetAt(x, y, offset);

		if (target == null) {
			setFocus(null);
			return inPanel(x, y);
		}

		boolean inPage = page.widgets().contains(target);
		double localY = inPage ? y + offset : y;
		setFocus(target.isFocusable() ? target : null);

		if (target.mouseClicked(x, localY, button, doubleClick)) {
			pressed = target;
			pressedInContent = inPage;
		}

		return true;
	}

	private boolean inPanel(double x, double y) {
		return x >= panelX && x < panelX + panelWidth && y >= panelY && y < panelY + panelHeight;
	}

	@Override
	public boolean mouseDragged(MouseButtonEvent event, double dragX, double dragY) {
		double x = event.x();
		double y = event.y();

		if (draggingScrollbar) {
			scroll.dragThumb(y, contentY + 6, contentHeight - 12, 16);
		} else if (pressedPopover && popover != null) {
			popover.mouseDragged(x, y, event.button());
		} else if (pressed != null) {
			pressed.mouseDragged(x, pressedInContent ? y + pageOffset() : y, event.button());
		} else {
			return false;
		}

		return true;
	}

	@Override
	public boolean mouseReleased(MouseButtonEvent event) {
		double x = event.x();
		double y = event.y();

		if (wave.clientSettings().modMenuKey.get().matchesMouse(event.button())) {
			if (menuKey.onRelease()) {
				onClose();
			}

			return true;
		}

		boolean handled = draggingScrollbar || pressedPopover || pressed != null;

		if (draggingScrollbar) {
			draggingScrollbar = false;
			scroll.endThumbDrag();
		}

		if (pressedPopover && popover != null) {
			popover.mouseReleased(x, y, event.button());
		}

		if (pressed != null) {
			pressed.mouseReleased(x, pressedInContent ? y + pageOffset() : y, event.button());
		}

		pressedPopover = false;
		pressed = null;
		return handled;
	}

	@Override
	public boolean mouseScrolled(double x, double y, double horizontal, double vertical) {
		menuKey.onOtherInput();

		if (popover != null) {
			if (popover.mouseScrolled(x, y, vertical)) {
				return true;
			}

			// The anchor is about to move, so the popover would float off it.
			closePopover();
		}

		if (inContent(x, y)) {
			scroll.scrollBy(-vertical * SCROLL_STEP);
			return true;
		}

		return false;
	}

	@Override
	public boolean keyPressed(KeyEvent event) {
		int key = event.key();

		if (key == swallowedKey) {
			return true;
		}

		swallowChars = false;
		boolean listening = isListening(focused);
		boolean typing = focused != null && focused.capturesKeyboard();

		// The menu key toggles the menu, unless it is being bound or would type into a text field.
		if (wave.clientSettings().modMenuKey.get().matchesKey(key) && popover == null && !listening && (!typing || !KeyNames.isPrintable(key))) {
			menuKey.onPress();
			swallowChars = true;
			return true;
		}

		menuKey.onOtherInput();

		if (popover != null) {
			if (event.isEscape()) {
				closePopover();
			} else {
				popover.keyPressed(event);
			}

			if (popover == null || popover.isClosed()) {
				swallow(key);
			}

			// The popover is modal: nothing behind it reacts to keys.
			return true;
		}

		if (event.isCycleFocus() && !listening) {
			cycleFocus(!event.hasShiftDown());
			return true;
		}

		if (focused != null && focused.keyPressed(event)) {
			if (listening != isListening(focused) || popover != null) {
				swallow(key);
			}

			return true;
		}

		if (event.isEscape()) {
			// Reached only when nothing above used it, e.g. Escape in an empty search box.
			onClose();
			return true;
		}

		if (typing) {
			return true;
		}

		if (key == GLFW_KEY_F && event.hasControlDownWithQuirk()) {
			setFocus(search);
			search.model().selectAll();
			return true;
		}

		if (key == GLFW_KEY_BACKSPACE && focused == null) {
			return page.goBack();
		}

		return false;
	}

	/** Tab and Shift+Tab: search, sidebar, page controls, close. Scrolls the new focus into view. */
	private void cycleFocus(boolean forward) {
		List<Widget> order = new ArrayList<>();

		for (Widget widget : chrome) {
			if (widget != close && widget.isFocusable() && widget.width() > 0) {
				order.add(widget);
			}
		}

		for (Widget widget : page.widgets()) {
			if (widget.isFocusable()) {
				order.add(widget);
			}
		}

		order.add(close);
		int index = order.indexOf(focused);
		int next = index < 0 ? (forward ? 0 : order.size() - 1) : Math.floorMod(index + (forward ? 1 : -1), order.size());
		Widget target = order.get(next);
		setFocus(target);
		focusVisible = true;

		if (page.widgets().contains(target)) {
			scroll.reveal(target.y() - contentY - 8, target.bottom() - contentY + 8);
		}
	}

	@Override
	public boolean keyReleased(KeyEvent event) {
		if (event.key() == swallowedKey) {
			swallowedKey = -1;
			return true;
		}

		if (wave.clientSettings().modMenuKey.get().matchesKey(event.key())) {
			if (menuKey.onRelease()) {
				onClose();
			}

			return true;
		}

		return false;
	}

	@Override
	public boolean charTyped(CharacterEvent event) {
		// The character of a key that was just used for something else, e.g. a captured binding.
		if (swallowChars) {
			return true;
		}

		if (popover != null) {
			popover.charTyped(event);
			return true;
		}

		if (focused != null && focused.charTyped(event)) {
			return true;
		}

		if (focused != null && focused.capturesKeyboard()) {
			return true;
		}

		// Start typing anywhere to search, except with the key that opened the menu still held.
		if (event.isAllowedChatCharacter() && !Character.isWhitespace(event.codepoint()) && !menuKey.isHoldingOpeningPress()) {
			setFocus(search);
			return search.charTyped(event);
		}

		return false;
	}

	@Override
	public void onClose() {
		minecraft.setScreen(parent);
	}

	@Override
	public void removed() {
		closePopover();
		setFocus(null);

		if (page != null) {
			STATE.setScroll(page.key(), scroll.target());
		}

		if (wave.config().isDirty()) {
			wave.config().saveAsync();
		}
	}

	/** A category in the sidebar. */
	private static final class SidebarItem extends Widget {
		private final Text label;
		private final BooleanSupplier selected;
		private final Runnable select;

		SidebarItem(String label, BooleanSupplier selected, Runnable select) {
			this.label = new Text(UiFont.STRONG, label);
			this.selected = selected;
			this.select = select;
		}

		boolean selected() {
			return selected.getAsBoolean();
		}

		@Override
		public void render(Painter painter, boolean hovered, double mouseX, double mouseY, float seconds) {
			animateHover(hovered, seconds);
			boolean on = selected();
			int fill = on ? Theme.SURFACE_RAISED : Theme.withAlpha(Theme.SURFACE, Math.round(hover * 255));
			painter.roundRect(x, y, width, height, Theme.RADIUS_SMALL, fill);
			label.drawFitted(painter, x + 10, y + height / 2.0, width - 14, on ? Theme.TEXT : Theme.mix(Theme.TEXT_MUTED, Theme.TEXT, hover));

			if (showsFocus(painter)) {
				painter.outline(x, y, width, height, Theme.withAlpha(Theme.ACCENT, 0xA0));
			}
		}

		@Override
		public boolean keyPressed(KeyEvent event) {
			if (event.isSelection()) {
				select.run();
				return true;
			}

			return false;
		}

		@Override
		public boolean isFocusable() {
			return true;
		}

		@Override
		public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
			if (button != 0) {
				return false;
			}

			select.run();
			return true;
		}

		@Override
		public CursorType cursor(double mouseX, double mouseY) {
			return CursorTypes.POINTING_HAND;
		}
	}
}
