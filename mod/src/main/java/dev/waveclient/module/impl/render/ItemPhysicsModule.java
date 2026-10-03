package dev.waveclient.module.impl.render;

import dev.waveclient.module.Category;
import dev.waveclient.module.Module;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.SliderSetting;

/**
 * Dropped items lie flat on the ground instead of floating and spinning, and tumble while they
 * fall. Purely visual: only how items are drawn changes.
 */
public final class ItemPhysicsModule extends Module {
	public final BooleanSetting spinInAir = add(new BooleanSetting("spinInAir", "Tumble while falling", true));
	public final SliderSetting spinSpeed = add(new SliderSetting("spinSpeed", "Tumble speed", 100, 25, 300, 25).unit("%")
			.visibleWhen(spinInAir::get));
	public final BooleanSetting layBlocksFlat = add(new BooleanSetting("layBlocksFlat", "Tip blocks over", false)
			.describe("Lay blocks and other 3D items on their side too, not just flat items."));

	public ItemPhysicsModule() {
		super("item_physics", "Item Physics", "Dropped items lie flat on the ground and tumble as they fall.", Category.RENDER);
	}
}
