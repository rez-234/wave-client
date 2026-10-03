package dev.waveclient.module.impl.render;

import java.util.Objects;

import dev.waveclient.module.Category;
import dev.waveclient.module.Module;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.SliderSetting;

/**
 * Blends each frame with the frames before it. Only the world is blurred: the HUD, chat and
 * menus are drawn afterwards. The blending happens in {@code MotionBlurRenderer}; this class
 * only holds the settings.
 */
public final class MotionBlurModule extends Module {
	public final SliderSetting strength = add(new SliderSetting("strength", "Strength", 50, 5, 95, 5).unit("%")
			.describe("Higher leaves a longer trail. It lasts the same time at any frame rate."));
	public final BooleanSetting naturalBlending = add(new BooleanSetting("naturalBlending", "Natural blending", true)
			.describe("Blend the way light adds up, so bright things leave bright trails instead of grey ones."));

	private Runnable resourceReleaser = () -> { };

	public MotionBlurModule() {
		super("motion_blur", "Motion Blur", "Blends recent frames for smoother-looking motion. Off while an Iris shader pack is in use.",
				Category.RENDER);
	}

	/** Frees the textures the effect keeps, when the module turns off. */
	public void setResourceReleaser(Runnable releaser) {
		this.resourceReleaser = Objects.requireNonNull(releaser, "releaser");
	}

	@Override
	protected void onDisable() {
		resourceReleaser.run();
	}
}
