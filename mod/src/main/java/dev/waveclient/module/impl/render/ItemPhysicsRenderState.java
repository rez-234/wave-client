package dev.waveclient.module.impl.render;

/**
 * Added to the dropped item's render state (by ItemEntityRenderStateMixin): how to pose it this
 * frame, decided when the state is filled so a frame never mixes vanilla and physics poses.
 */
public interface ItemPhysicsRenderState {
	void waveclient$setPhysics(boolean physics, float tumble, boolean laid);

	boolean waveclient$physics();

	float waveclient$tumble();

	/** Whether the item lies on its back (always for flat items). */
	boolean waveclient$laid();
}
