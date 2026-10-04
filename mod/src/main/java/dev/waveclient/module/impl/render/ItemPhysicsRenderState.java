package dev.waveclient.module.impl.render;

/**
 * Added to the dropped item's render state (by ItemEntityRenderStateMixin): how to pose it this
 * frame, decided when the state is filled so a frame never mixes vanilla and physics poses.
 */
public interface ItemPhysicsRenderState {
	/**
	 * @param raise extra height on top of {@link ItemPhysicsMath#lift}: up to a fluid's surface,
	 *              plus enough that no copy of a stack ends up below the first
	 */
	void waveclient$setPhysics(boolean physics, float tumble, boolean laid, float raise);

	boolean waveclient$physics();

	float waveclient$tumble();

	/** Whether the item lies on its back (always for flat items). */
	boolean waveclient$laid();

	float waveclient$raise();
}
