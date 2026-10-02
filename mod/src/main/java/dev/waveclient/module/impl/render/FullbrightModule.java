package dev.waveclient.module.impl.render;

import java.util.Objects;

import dev.waveclient.module.Category;
import dev.waveclient.module.Module;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.Setting;
import dev.waveclient.setting.SliderSetting;

/**
 * Lights everything as if the brightness option were turned far past its maximum.
 *
 * <p>The lightmap mixin substitutes {@link #gamma()} for the option's value while this module is
 * active. The brightness option itself is never written, so turning the module off restores the
 * player's setting immediately and a crash can never leave a huge value in options.txt.
 */
public final class FullbrightModule extends Module {
	public final SliderSetting brightness = add(new SliderSetting("brightness", "Brightness", 1500, 100, 1500, 50).unit("%")
			.describe("How bright the world is lit. 100% matches the vanilla \"Bright\" setting."));
	public final BooleanSetting shaderPacks = add(new BooleanSetting("shaderPacks", "Brighten shader packs", true)
			.describe("Report full night vision to Iris shader packs, which many packs use for their own fullbright support."));

	private Runnable lightmapInvalidator = () -> { };

	public FullbrightModule() {
		super("fullbright", "Fullbright", "Lights everything up without changing your brightness option.", Category.RENDER);
	}

	/** The gamma value the lightmap uses while active (vanilla's slider tops out at 1.0). */
	public float gamma() {
		return (float) (brightness.get() / 100.0);
	}

	/** Whether to report full night vision (for shader packs) right now. */
	public boolean forcesNightVision() {
		return isActive() && shaderPacks.get();
	}

	/**
	 * Set by the client to mark the lightmap dirty, so a change shows up immediately even while
	 * singleplayer is paused (vanilla only refreshes the lightmap on unpaused ticks).
	 */
	public void setLightmapInvalidator(Runnable invalidator) {
		this.lightmapInvalidator = Objects.requireNonNull(invalidator, "invalidator");
	}

	@Override
	protected void onEnable() {
		lightmapInvalidator.run();
	}

	@Override
	protected void onDisable() {
		lightmapInvalidator.run();
	}

	@Override
	protected void onSettingChanged(Setting<?> setting) {
		if (isActive()) {
			lightmapInvalidator.run();
		}
	}
}
