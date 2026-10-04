package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import com.llamalad7.mixinextras.sugar.Local;
import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.renderer.entity.ItemEntityRenderer;
import net.minecraft.client.renderer.entity.state.ItemEntityRenderState;
import net.minecraft.tags.FluidTags;
import net.minecraft.util.RandomSource;
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
 * the glow outline, the name tag and the leash, and shader packs still get item ids. Items in
 * water or lava lie on the surface.
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
	/** Replays the renderer's seeded offsets for a stack's copies; render thread only, like the renderer's own. */
	@Unique
	private static final RandomSource WAVECLIENT_CLUSTER_RANDOM = RandomSource.create();
	@Unique
	private static final ItemPhysicsMath.FloatSource WAVECLIENT_CLUSTER_SOURCE = WAVECLIENT_CLUSTER_RANDOM::nextFloat;

	/** Decides each item's pose when its render state is filled (the model is resolved by then). */
	@Inject(method = "extractRenderState(Lnet/minecraft/world/entity/item/ItemEntity;Lnet/minecraft/client/renderer/entity/state/ItemEntityRenderState;F)V",
			at = @At("TAIL"))
	private void waveclient$captureItemPhysics(ItemEntity entity, ItemEntityRenderState state, float partialTick, CallbackInfo ci) {
		WaveClient wave = WaveClient.get();
		ItemPhysicsModule module = wave != null ? wave.itemPhysics() : null;

		if (module == null || !module.isActive() || state.item.isEmpty()) {
			((ItemPhysicsRenderState) state).waveclient$setPhysics(false, 0, false, 0);
			return;
		}

		boolean flat = ItemPhysicsMath.isFlat((float) state.item.getModelBoundingBox().getZsize());
		boolean inWater = entity.isInWater();
		boolean inLava = !inWater && entity.isInLava();
		boolean resting = entity.onGround() || inWater || inLava;
		float rate = module.spinInAir.get() ? ItemPhysicsMath.spinRate(entity.getDeltaMovement().length(), (float) (module.spinSpeed.get() / 100.0)) : 0;
		// Flat items look the same either way up, so they settle every half turn; blocks every quarter.
		float period = flat ? (float) Math.PI : (float) (Math.PI / 2);
		float tumble = ((ItemPhysicsEntity) entity).waveclient$stepTumble(state.ageInTicks, resting || rate == 0, rate, period);
		boolean laid = flat || module.layBlocksFlat.get();
		float raise = 0.0F;

		if (inWater || inLava) {
			// The surface as of the last tick (the entity's box sits 0.001 into the fluid check),
			// measured from where the item is drawn this frame, so it stays still while it bobs.
			double surface = entity.getY() + 0.001 + entity.getFluidHeight(inWater ? FluidTags.WATER : FluidTags.LAVA);
			raise = (float) Math.max(0.0, surface - state.y);
		}

		if (state.count > 1) {
			WAVECLIENT_CLUSTER_RANDOM.setSeed(state.seed);
			raise += ItemPhysicsMath.clusterDrop(waveclient$pitch(laid, tumble), flat, state.count, WAVECLIENT_CLUSTER_SOURCE);
		}

		((ItemPhysicsRenderState) state).waveclient$setPhysics(true, tumble, laid, raise);
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
				state.count) + physics.waveclient$raise(), 0.0F);
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
		return waveclient$pitch(physics.waveclient$laid(), physics.waveclient$tumble());
	}

	@Unique
	private static float waveclient$pitch(boolean laid, float tumble) {
		return (laid ? ItemPhysicsMath.LAY_FLAT_PITCH : 0.0F) + tumble;
	}
}
