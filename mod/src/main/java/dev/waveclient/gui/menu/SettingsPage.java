package dev.waveclient.gui.menu;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.util.Util;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.render.Text;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.gui.widget.Button;
import dev.waveclient.gui.widget.ColorWidget;
import dev.waveclient.gui.widget.DropdownWidget;
import dev.waveclient.gui.widget.KeybindWidget;
import dev.waveclient.gui.widget.PopoverHost;
import dev.waveclient.gui.widget.SliderWidget;
import dev.waveclient.gui.widget.SwitchWidget;
import dev.waveclient.gui.widget.Widget;
import dev.waveclient.hud.HudModule;
import dev.waveclient.module.Module;
import dev.waveclient.module.SettingContainer;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.ColorSetting;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.setting.KeybindSetting;
import dev.waveclient.setting.Setting;
import dev.waveclient.setting.SliderSetting;

/**
 * The settings of one module (or of the client itself): a header with the on/off switch and
 * description, then one row per visible setting with its control, then reset and, for HUD
 * modules, a shortcut to the HUD editor.
 */
final class SettingsPage extends MenuPage {
	private static final int PADDING = 12;
	private static final int ROW_PADDING = 8;
	private static final int LINE = 11;
	private static final int FIRST_LINE = 16;
	private static final int RESET_SIZE = 14;
	private static final long CONFIRM_MS = 3000;

	/** What a page shows: a module, or another group of settings such as the client's own. */
	record Subject(String key, String title, String description, SettingContainer settings, Module module) {
		static Subject of(Module module) {
			return new Subject("module:" + module.id(), module.name(), module.description(), module, module);
		}
	}

	/** Actions the page can't perform itself. */
	interface Actions {
		void back();

		/** Opens the HUD editor, or does nothing when no world is loaded. */
		void editHud();

		boolean canEditHud();
	}

	private record Row(Setting<?> setting, Text label, Text description, double top, double height, double labelWidth) {
	}

	private final Subject subject;
	private final PopoverHost host;
	private final Function<KeybindSetting, String> conflicts;
	private final Actions actions;
	private final Text title;
	private final Text description;
	private final Text status = new Text(UiFont.BODY);
	private final List<Row> rows = new ArrayList<>();
	private final List<Setting<?>> shown = new ArrayList<>();
	// Widgets are kept across layouts (a setting's visibility changing relays the page out),
	// so focus, hover and switch animations carry over.
	private final Map<Setting<?>, Widget> controls = new IdentityHashMap<>();
	private final Map<Setting<?>, ResetButton> resets = new IdentityHashMap<>();
	private final Map<Setting<?>, Text[]> texts = new IdentityHashMap<>();
	private Button back;
	private SwitchWidget enabled;
	private Button editHud;
	private double titleCenterY;
	private double descriptionTop;
	private Button resetButton;
	private long resetArmedAt = Long.MIN_VALUE;

	SettingsPage(Subject subject, PopoverHost host, Function<KeybindSetting, String> conflicts, Actions actions) {
		this.subject = subject;
		this.host = host;
		this.conflicts = conflicts;
		this.actions = actions;
		this.title = new Text(UiFont.HEADING, subject.title());
		this.description = new Text(UiFont.BODY, subject.description());
	}

	@Override
	String key() {
		return subject.key();
	}

	Subject subject() {
		return subject;
	}

	/** Settings in display order: a module's own settings first, its toggle key last. */
	private List<Setting<?>> visibleSettings() {
		List<Setting<?>> result = new ArrayList<>();
		Module module = subject.module();

		for (Setting<?> setting : subject.settings().settings()) {
			if (setting.isVisible() && (module == null || setting != module.toggleKey)) {
				result.add(setting);
			}
		}

		if (module != null) {
			result.add(module.toggleKey);
		}

		return result;
	}

	/** Checked every frame, so it compares in place instead of building a new list. */
	@Override
	boolean needsLayout() {
		Module module = subject.module();
		int index = 0;

		for (Setting<?> setting : subject.settings().settings()) {
			if (setting.isVisible() && (module == null || setting != module.toggleKey)) {
				if (index >= shown.size() || shown.get(index) != setting) {
					return true;
				}

				index++;
			}
		}

		// A module's toggle key comes last.
		return index != shown.size() - (module != null ? 1 : 0);
	}

	@Override
	protected int build(Painter painter) {
		rows.clear();
		shown.clear();
		shown.addAll(visibleSettings());
		int contentWidth = width - 2 * PADDING;
		double x = left + PADDING;
		double y = top + PADDING;

		if (back == null) {
			back = new Button("‹  Back", Button.Kind.GHOST, actions::back);
		}

		back.setBounds(x - 6, y, back.preferredWidth(painter), Button.HEIGHT);
		widgets.add(back);
		y += Button.HEIGHT + 8;

		titleCenterY = y + 8;
		Module module = subject.module();

		if (module != null) {
			if (enabled == null) {
				enabled = new SwitchWidget(module::isEnabled, module::toggle, () -> !module.isBlocked());
			}

			enabled.setBounds(x + contentWidth - SwitchWidget.WIDTH, titleCenterY - SwitchWidget.HEIGHT / 2.0, SwitchWidget.WIDTH, SwitchWidget.HEIGHT);
			widgets.add(enabled);
		}

		y += 20;
		descriptionTop = y;
		y += description.lines(painter, contentWidth).size() * LINE + 12;

		int controlWidth = Math.max(110, Math.min(160, (int) (contentWidth * 0.42)));
		double labelWidth = Math.max(40, contentWidth - controlWidth - RESET_SIZE - 12);

		for (Setting<?> setting : shown) {
			Text[] text = texts.computeIfAbsent(setting, s -> new Text[] {new Text(UiFont.BODY, s.name()), new Text(UiFont.BODY, s.description())});
			Text label = text[0];
			Text help = text[1];
			int helpLines = help.isEmpty() ? 0 : help.lines(painter, (int) labelWidth).size();
			double height = 2 * ROW_PADDING + FIRST_LINE + (helpLines > 0 ? helpLines * LINE + 1 : 0);
			rows.add(new Row(setting, label, help, y, height, labelWidth));

			double centerY = y + ROW_PADDING + FIRST_LINE / 2.0;
			Widget control = controls.computeIfAbsent(setting, this::control);
			int controlHeight = control.height();
			double controlLeft = setting instanceof BooleanSetting ? x + contentWidth - SwitchWidget.WIDTH : x + contentWidth - controlWidth;
			int width = setting instanceof BooleanSetting ? SwitchWidget.WIDTH : controlWidth;
			control.setBounds(controlLeft, centerY - controlHeight / 2.0, width, controlHeight);
			widgets.add(control);

			ResetButton reset = resets.computeIfAbsent(setting, ResetButton::new);
			reset.setBounds(x + contentWidth - controlWidth - RESET_SIZE - 6, centerY - RESET_SIZE / 2.0, RESET_SIZE, RESET_SIZE);
			widgets.add(reset);
			y += height;
		}

		y += 12;
		if (resetButton == null) {
			resetButton = new Button(resetLabel(false), Button.Kind.DANGER, this::resetClicked);
		}

		// Wide enough for both labels, so arming it doesn't change its size.
		int armedWidth = resetButton.label(resetLabel(true)).preferredWidth(painter);
		int normalWidth = resetButton.label(resetLabel(false)).preferredWidth(painter);
		resetButton.setBounds(x, y, Math.max(armedWidth, normalWidth), Button.HEIGHT);
		widgets.add(resetButton);

		if (module instanceof HudModule) {
			if (editHud == null) {
				editHud = new Button("Edit position", Button.Kind.SECONDARY, actions::editHud).usableWhen(actions::canEditHud);
			}

			editHud.tooltip(actions.canEditHud() ? null : "Join a world to move HUD elements.");
			editHud.setBounds(resetButton.right() + 8, y, editHud.preferredWidth(painter), Button.HEIGHT);
			widgets.add(editHud);
		}

		y += Button.HEIGHT + PADDING;
		return (int) Math.ceil(y - top);
	}

	private String resetLabel(boolean armed) {
		return armed ? "Click again to reset" : subject.module() != null ? "Reset to defaults" : "Reset all settings";
	}

	/** Resetting is a two-click action, so a stray click can't wipe a configured module. */
	private void resetClicked() {
		long now = Util.getMillis();

		if (now - resetArmedAt < CONFIRM_MS) {
			resetArmedAt = Long.MIN_VALUE;

			if (subject.module() != null) {
				subject.module().resetToDefaults();
			} else {
				subject.settings().resetSettings();
			}
		} else {
			resetArmedAt = now;
		}
	}

	private Widget control(Setting<?> setting) {
		return switch (setting) {
			case BooleanSetting b -> new SwitchWidget(b::get, b::toggle);
			case SliderSetting s -> new SliderWidget(s);
			case ColorSetting c -> new ColorWidget(c, host);
			case KeybindSetting k -> new KeybindWidget(k, conflicts);
			case EnumSetting<?> e -> new DropdownWidget(e, host);
		};
	}

	@Override
	void renderBackground(Painter painter, double mouseX, double mouseY, boolean mouseInside, float seconds) {
		boolean armed = Util.getMillis() - resetArmedAt < CONFIRM_MS;

		if (resetButton != null) {
			resetButton.label(resetLabel(armed));
		}

		int contentWidth = width - 2 * PADDING;
		double x = left + PADDING;
		Module module = subject.module();
		title.drawFitted(painter, x, titleCenterY, contentWidth - (module != null ? 120 : 0), Theme.TEXT);

		if (module != null) {
			boolean blocked = module.isBlocked();
			status.set(blocked ? "Blocked on this server" : module.isEnabled() ? "On" : "Off");
			float statusWidth = status.width(painter);
			status.drawCentered(painter, x + contentWidth - SwitchWidget.WIDTH - 8 - statusWidth, titleCenterY,
					blocked ? Theme.DANGER : module.isEnabled() ? Theme.ACCENT : Theme.TEXT_MUTED);
		}

		description.drawWrapped(painter, x, descriptionTop, contentWidth, LINE, Theme.TEXT_MUTED);

		for (int i = 0; i < rows.size(); i++) {
			Row row = rows.get(i);
			painter.rect(x, row.top(), contentWidth, painter.hairline(), Theme.BORDER);
			double centerY = row.top() + ROW_PADDING + FIRST_LINE / 2.0;
			row.label().drawFitted(painter, x, centerY, (int) row.labelWidth(), Theme.TEXT);

			if (!row.description().isEmpty()) {
				List<FormattedCharSequence> lines = row.description().lines(painter, (int) row.labelWidth());
				double lineTop = row.top() + ROW_PADDING + FIRST_LINE + 1;

				for (int j = 0; j < lines.size(); j++) {
					painter.text(lines.get(j), x, painter.textTopForCenter(UiFont.BODY, lineTop + j * LINE + LINE / 2.0), Theme.TEXT_MUTED);
				}
			}

			if (i == rows.size() - 1) {
				painter.rect(x, row.top() + row.height(), contentWidth, painter.hairline(), Theme.BORDER);
			}
		}
	}

	@Override
	boolean goBack() {
		actions.back();
		return true;
	}

	/** A small "reset to default" button beside a control, only there while the value differs. */
	private static final class ResetButton extends Widget {
		private static final String GLYPH = "↺";
		private final Setting<?> setting;
		private final Text glyph = new Text(UiFont.STRONG, GLYPH);

		ResetButton(Setting<?> setting) {
			this.setting = setting;
		}

		private boolean active() {
			return !setting.isDefault();
		}

		@Override
		public boolean contains(double mouseX, double mouseY) {
			return active() && super.contains(mouseX, mouseY);
		}

		@Override
		public void render(Painter painter, boolean hovered, double mouseX, double mouseY, float seconds) {
			animateHover(hovered, seconds);

			if (!active()) {
				hover = 0;
				return;
			}

			painter.roundRect(x, y, width, height, Theme.RADIUS_SMALL, Theme.withAlpha(Theme.SURFACE_RAISED, Math.round(hover * 255)));
			float glyphWidth = glyph.width(painter);
			glyph.drawCentered(painter, x + (width - glyphWidth) / 2, y + height / 2.0, Theme.mix(Theme.TEXT_MUTED, Theme.TEXT, hover));
		}

		@Override
		public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
			if (button != 0 || !active()) {
				return false;
			}

			setting.reset();
			return true;
		}

		@Override
		public CursorType cursor(double mouseX, double mouseY) {
			return CursorTypes.POINTING_HAND;
		}

		@Override
		public String tooltip(double mouseX, double mouseY) {
			return "Reset to default";
		}
	}
}
