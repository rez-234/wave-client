package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import com.llamalad7.mixinextras.sugar.Local;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.renderer.entity.ItemEntityRenderer;
import net.minecraft.client.renderer.entity.state.ItemEntityRenderState;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.phys.AABB;
import org.joml.Quaternionf;
import org.joml.Quaternionfc;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import dev.waveclient.WaveClient;
import dev.waveclient.module.impl.render.ItemPhysicsEntity;
import dev.waveclient.module.impl.render.ItemPhysicsMath;
import dev.waveclient.module.impl.render.ItemPhysicsModule;
import dev.waveclient.module.impl.render.ItemPhysicsRenderState;

/**
 * Item physics: replaces the bob and the spin of dropped items with lying flat (or tumbling).
 * Only the item's one translate and one rotation are changed; vanilla still draws the stack,
 * the glow outline, the name tag and the leash, and shader packs still get item ids.
 */
@Mixin(ItemEntityRenderer.class)
public abstract class ItemEntityRendererMixin {
	@Unique
	private static final String SUBMIT = "submit(Lnet/minecraft/client/renderer/entity/state/ItemEntityRenderState;"
			+ "Lcom/mojang/blaze3d/vertex/PoseStack;Lnet/minecraft/client/renderer/SubmitNodeCollector;"
			+ "Lnet/minecraft/client/renderer/state/CameraRenderState;)V";
	/** Reused: the pose stack applies it at once, and entities are drawn on the render thread. */
	@Unique
	private static final Quaternionf WAVECLIENT_ROTATION = new Quaternionf();

	/** Decides each item's pose when its render state is filled (the model is resolved by then). */
	@Inject(method = "extractRenderState(Lnet/minecraft/world/entity/item/ItemEntity;Lnet/minecraft/client/renderer/entity/state/ItemEntityRenderState;F)V",
			at = @At("TAIL"))
	private void waveclient$captureItemPhysics(ItemEntity entity, ItemEntityRenderState state, float partialTick, CallbackInfo ci) {
		WaveClient wave = WaveClient.get();
		ItemPhysicsModule module = wave != null ? wave.itemPhysics() : null;

		if (module == null || !module.isActive() || state.item.isEmpty()) {
			((ItemPhysicsRenderState) state).waveclient$setPhysics(false, 0, false);
			return;
		}

		boolean flat = ItemPhysicsMath.isFlat((float) state.item.getModelBoundingBox().getZsize());
		boolean resting = entity.onGround() || entity.isInWater() || entity.isInLava();
		float rate = module.spinInAir.get() ? ItemPhysicsMath.spinRate(entity.getDeltaMovement().length(), (float) (module.spinSpeed.get() / 100.0)) : 0;
		// Flat items look the same either way up, so they settle every half turn; blocks every quarter.
		float period = flat ? (float) Math.PI : (float) (Math.PI / 2);
		float tumble = ((ItemPhysicsEntity) entity).waveclient$stepTumble(state.ageInTicks, resting || rate == 0, rate, period);
		((ItemPhysicsRenderState) state).waveclient$setPhysics(true, tumble, flat || module.layBlocksFlat.get());
	}

	/** Instead of hovering and bobbing, sit just above the ground at the current angle. */
	@WrapOperation(method = SUBMIT, at = @At(value = "INVOKE", target = "Lcom/mojang/blaze3d/vertex/PoseStack;translate(FFF)V"))
	private void waveclient$itemPhysicsLift(PoseStack pose, float x, float y, float z, Operation<Void> original,
			@Local(argsOnly = true) ItemEntityRenderState state) {
		ItemPhysicsRenderState physics = (ItemPhysicsRenderState) state;

		if (!physics.waveclient$physics()) {
			original.call(pose, x, y, z);
			return;
		}

		AABB box = state.item.getModelBoundingBox();
		original.call(pose, 0.0F, ItemPhysicsMath.lift(waveclient$pitch(physics), (float) box.minY, (float) box.maxY, (float) box.minZ, (float) box.maxZ,
				state.count), 0.0F);
	}

	/**
	 * Instead of spinning, keep the item's random facing (stable for its lifetime) and lay it down
	 * or tumble it, rotating about the middle of the model.
	 */
	@WrapOperation(method = SUBMIT, at = @At(value = "INVOKE", target = "Lcom/mojang/blaze3d/vertex/PoseStack;mulPose(Lorg/joml/Quaternionfc;)V"))
	private void waveclient$itemPhysicsRotate(PoseStack pose, Quaternionfc spin, Operation<Void> original,
			@Local(argsOnly = true) ItemEntityRenderState state) {
		ItemPhysicsRenderState physics = (ItemPhysicsRenderState) state;

		if (!physics.waveclient$physics()) {
			original.call(pose, spin);
			return;
		}

		AABB box = state.item.getModelBoundingBox();
		float cx = (float) ((box.minX + box.maxX) * 0.5);
		float cy = (float) ((box.minY + box.maxY) * 0.5);
		float cz = (float) ((box.minZ + box.maxZ) * 0.5);
		pose.translate(cx, cy, cz);
		original.call(pose, WAVECLIENT_ROTATION.rotationYXZ(state.bobOffset, waveclient$pitch(physics), 0.0F));
		pose.translate(-cx, -cy, -cz);
	}

	@Unique
	private static float waveclient$pitch(ItemPhysicsRenderState physics) {
		return (physics.waveclient$laid() ? ItemPhysicsMath.LAY_FLAT_PITCH : 0.0F) + physics.waveclient$tumble();
	}
}
