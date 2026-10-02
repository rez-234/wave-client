package dev.waveclient.mixin;

import net.minecraft.client.renderer.LightTexture;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/**
 * Marks the lightmap dirty. Vanilla only sets this flag from {@code LightTexture.tick()}, which
 * doesn't run while singleplayer is paused, so toggling Fullbright from a menu would otherwise
 * only show after unpausing.
 */
@Mixin(LightTexture.class)
public interface LightTextureAccessor {
	// The boolean field, not the method of the same name.
	@Accessor("updateLightTexture")
	void waveclient$setUpdateLightTexture(boolean dirty);
}
