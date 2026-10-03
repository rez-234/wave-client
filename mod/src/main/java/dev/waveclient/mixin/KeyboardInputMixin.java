package dev.waveclient.mixin;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import net.minecraft.client.player.KeyboardInput;
import net.minecraft.world.entity.player.Input;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

import dev.waveclient.WaveClient;
import dev.waveclient.module.impl.movement.ToggleSprintModule;

/**
 * Toggle sprint and sneak: changes the sneak and sprint flags of the movement input the game
 * builds from the keys each tick, as if the key were held. Nothing else about the input changes,
 * and no key or option state is written.
 */
@Mixin(KeyboardInput.class)
public abstract class KeyboardInputMixin {
	@WrapOperation(method = "tick()V", at = @At(value = "NEW", target = "(ZZZZZZZ)Lnet/minecraft/world/entity/player/Input;"))
	private Input waveclient$toggleSprintSneak(boolean forward, boolean backward, boolean left, boolean right, boolean jump,
			boolean shift, boolean sprint, Operation<Input> original) {
		WaveClient wave = WaveClient.get();

		if (wave != null && wave.toggleSprint().isActive()) {
			ToggleSprintModule module = wave.toggleSprint();
			shift = module.effectiveShift(shift);
			sprint = module.effectiveSprint(sprint);
		}

		return original.call(forward, backward, left, right, jump, shift, sprint);
	}
}
