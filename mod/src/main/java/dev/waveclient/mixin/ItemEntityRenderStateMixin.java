package dev.waveclient.mixin;

import net.minecraft.client.renderer.entity.state.ItemEntityRenderState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;

import dev.waveclient.module.impl.render.ItemPhysicsRenderState;

@Mixin(ItemEntityRenderState.class)
public abstract class ItemEntityRenderStateMixin implements ItemPhysicsRenderState {
	@Unique
	private boolean waveclient$physics;
	@Unique
	private float waveclient$tumble;
	@Unique
	private boolean waveclient$laid;
	@Unique
	private float waveclient$raise;

	@Override
	public void waveclient$setPhysics(boolean physics, float tumble, boolean laid, float raise) {
		waveclient$physics = physics;
		waveclient$tumble = tumble;
		waveclient$laid = laid;
		waveclient$raise = raise;
	}

	@Override
	public boolean waveclient$physics() {
		return waveclient$physics;
	}

	@Override
	public float waveclient$tumble() {
		return waveclient$tumble;
	}

	@Override
	public boolean waveclient$laid() {
		return waveclient$laid;
	}

	@Override
	public float waveclient$raise() {
		return waveclient$raise;
	}
}
