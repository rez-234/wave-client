package dev.waveclient.mixin;

import net.minecraft.client.CameraType;
import net.minecraft.client.Options;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(Options.class)
public interface OptionsAccessor {
	/** The player's own perspective, ignoring the freelook and snaplook override. */
	@Accessor("cameraType")
	CameraType waveclient$rawCameraType();
}
