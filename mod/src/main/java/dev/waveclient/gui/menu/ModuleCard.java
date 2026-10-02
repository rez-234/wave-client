package dev.waveclient.gui.menu;

import com.mojang.blaze3d.platform.cursor.CursorType;
import com.mojang.blaze3d.platform.cursor.CursorTypes;
import net.minecraft.client.input.KeyEvent;

import dev.waveclient.gui.render.Painter;
import dev.waveclient.gui.render.Text;
import dev.waveclient.gui.theme.Theme;
import dev.waveclient.gui.theme.UiFont;
import dev.waveclient.gui.widget.SwitchWidget;
import dev.waveclient.gui.widget.Widget;
import dev.waveclient.module.Module;
import dev.waveclient.setting.Setting;

/** A module in the list: name, one line of detail and an on/off switch. Click to open its settings. */
final class ModuleCard extends Widget {
	static final int HEIGHT = 44;
	private static final int PADDING = 10;

	private final Module module;
	private final SwitchWidget toggle;
	private final Runnable open;
	private final Text name;
	private final Text detail = new Text(UiFont.BODY);
	private final String matchedSetting;
	private int detailWidth;
	private boolean descriptionCut;

	/**
	 * @param matchedSetting the setting a search matched, shown instead of the description
	 */
	ModuleCard(Module module, Setting<?> matchedSetting, Runnable open) {
		this.module = module;
		this.open = open;
		this.name = new Text(UiFont.STRONG, module.name());
		this.matchedSetting = matchedSetting != null ? "Setting: " + matchedSetting.name() : null;
		this.toggle = new SwitchWidget(module::isEnabled, module::toggle, () -> !module.isBlocked());
		this.height = HEIGHT;
	}

	@Override
	public void setBounds(double x, double y, int width, int height) {
		super.setBounds(x, y, width, height);
		toggle.setBounds(x + width - PADDING - SwitchWidget.WIDTH, y + 15.5 - SwitchWidget.HEIGHT / 2.0, SwitchWidget.WIDTH, SwitchWidget.HEIGHT);
		detailWidth = Math.max(0, width - 2 * PADDING);
	}

	@Override
	public void render(Painter painter, boolean hovered, double mouseX, double mouseY, float seconds) {
		animateHover(hovered && !toggle.contains(mouseX, mouseY), seconds);
		int border = module.isEnabled() && !module.isBlocked() ? Theme.mix(Theme.BORDER, Theme.ACCENT, 0.4f) : Theme.BORDER;

		// The focus ring goes underneath, so the card's own content stays on top of it.
		if (showsFocus(painter)) {
			painter.roundRect(x - 1.5, y - 1.5, width + 3, height + 3, Theme.RADIUS_MEDIUM + 1, Theme.withAlpha(Theme.ACCENT, 0xA0));
		}

		painter.roundRect(x, y, width, height, Theme.RADIUS_MEDIUM, Theme.mix(Theme.SURFACE, Theme.SURFACE_HOVER, hover), border);

		name.drawFitted(painter, x + PADDING, y + 15.5, Math.max(0, width - 2 * PADDING - SwitchWidget.WIDTH - 8), Theme.TEXT);

		int detailColor;

		if (module.isBlocked()) {
			detail.set("Blocked on this server");
			detailColor = Theme.DANGER;
		} else if (matchedSetting != null) {
			detail.set(matchedSetting);
			detailColor = Theme.ACCENT;
		} else {
			detail.set(module.description());
			detailColor = Theme.TEXT_MUTED;
		}

		descriptionCut = detailColor == Theme.TEXT_MUTED && detail.isCut(painter, detailWidth);
		detail.drawFitted(painter, x + PADDING, y + 31, detailWidth, detailColor);
		toggle.render(painter, hovered && toggle.contains(mouseX, mouseY), mouseX, mouseY, seconds);
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button, boolean doubleClick) {
		if (toggle.contains(mouseX, mouseY)) {
			return toggle.mouseClicked(mouseX, mouseY, button, doubleClick) || module.isBlocked();
		}

		if (button != 0) {
			return false;
		}

		open.run();
		return true;
	}

	/** Enter opens the settings, Space turns the module on or off. */
	@Override
	public boolean keyPressed(KeyEvent event) {
		if (event.isConfirmation()) {
			open.run();
			return true;
		}

		if (event.isSelection()) {
			return toggle.keyPressed(event) || true;
		}

		return false;
	}

	@Override
	public boolean isFocusable() {
		return true;
	}

	@Override
	public CursorType cursor(double mouseX, double mouseY) {
		return toggle.contains(mouseX, mouseY) ? toggle.cursor(mouseX, mouseY) : CursorTypes.POINTING_HAND;
	}

	@Override
	public String tooltip(double mouseX, double mouseY) {
		if (module.isBlocked()) {
			return module.blockedReason() + ".";
		}

		// The full description, when the card had to cut it short.
		return descriptionCut && !toggle.contains(mouseX, mouseY) ? module.description() : null;
	}
}
