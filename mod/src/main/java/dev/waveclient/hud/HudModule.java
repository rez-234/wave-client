package dev.waveclient.hud;

import com.google.gson.JsonObject;
import net.minecraft.client.gui.GuiGraphics;

import dev.waveclient.module.Category;
import dev.waveclient.module.Module;

/**
 * A module that draws one element on the HUD. Its {@link HudPosition} is saved under
 * {@code "hud"} in the module's config entry.
 *
 * <p>Implementations should do their expensive work (building strings, measuring text) when the
 * underlying value changes, typically in {@link #onTick()}, and keep {@link #render} to drawing
 * cached data.
 */
public abstract class HudModule extends Module {
	public final HudPosition position;

	// The position's change sink captures 'this', but only runs on later edits, never during construction.
	@SuppressWarnings("this-escape")
	protected HudModule(String id, String name, String description, Anchor anchor, double offsetX, double offsetY) {
		super(id, name, description, Category.HUD);
		this.position = new HudPosition(anchor, offsetX, offsetY);
		this.position.setChangeSink(this::markDirty);
	}

	/** Unscaled width in GUI pixels. */
	public abstract int width();

	/** Unscaled height in GUI pixels. */
	public abstract int height();

	/**
	 * Draws the element with its top-left corner at (0, 0); the HUD layer has already translated
	 * and scaled the pose.
	 */
	public abstract void render(GuiGraphics graphics);

	@Override
	protected void saveExtra(JsonObject moduleJson) {
		moduleJson.add("hud", position.toJson());
	}

	@Override
	protected void loadExtra(JsonObject moduleJson) {
		if (moduleJson.get("hud") instanceof JsonObject hud) {
			position.fromJson(hud);
		}
	}

	@Override
	protected void resetExtra() {
		position.reset();
	}
}
