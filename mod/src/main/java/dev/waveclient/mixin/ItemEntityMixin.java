package dev.waveclient.mixin;

import net.minecraft.world.entity.item.ItemEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;

import dev.waveclient.module.impl.render.ItemPhysicsEntity;
import dev.waveclient.module.impl.render.ItemPhysicsMath;

/** Item physics: the tumble angle lives on the item, because render states are recreated every frame. */
@Mixin(ItemEntity.class)
public abstract class ItemEntityMixin implements ItemPhysicsEntity {
	@Unique
	private float waveclient$tumble;
	@Unique
	private float waveclient$tumbleAge = Float.NaN;

	@Override
	public float waveclient$stepTumble(float age, boolean resting, float rate, float period) {
		waveclient$tumble = ItemPhysicsMath.step(waveclient$tumble, waveclient$tumbleAge, age, resting, rate, period);
		waveclient$tumbleAge = age;
		return waveclient$tumble;
	}
}
