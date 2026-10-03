package dev.waveclient.module.impl.render;

/** Added to dropped items (by ItemEntityMixin): each item's own tumble angle, kept between frames. */
public interface ItemPhysicsEntity {
	/** Advances the tumble to the item's current age and returns the angle. */
	float waveclient$stepTumble(float age, boolean resting, float rate, float period);
}
