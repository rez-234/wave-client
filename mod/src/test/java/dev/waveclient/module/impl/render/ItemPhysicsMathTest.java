package dev.waveclient.module.impl.render;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Random;

import org.joml.Matrix4f;
import org.joml.Quaternionf;
import org.joml.Vector3f;
import org.junit.jupiter.api.Test;

class ItemPhysicsMathTest {
	private static final float PI = (float) Math.PI;
	// A flat item and a block, as the item renderer sizes them on the ground.
	private static final float[] ITEM_MIN = {-0.25F, -0.125F, -1F / 64};
	private static final float[] ITEM_MAX = {0.25F, 0.375F, 1F / 64};
	private static final float[] BLOCK_MIN = {-0.125F, 0.0625F, -0.125F};
	private static final float[] BLOCK_MAX = {0.125F, 0.3125F, 0.125F};

	/** Lowest point of the box, shifted dz along its depth, under the pose. */
	private static float lowest(Matrix4f pose, float[] min, float[] max, float dz) {
		float lowest = Float.MAX_VALUE;
		Vector3f corner = new Vector3f();

		for (int i = 0; i < 8; i++) {
			corner.set((i & 1) == 0 ? min[0] : max[0], (i & 2) == 0 ? min[1] : max[1], ((i & 4) == 0 ? min[2] : max[2]) + dz);
			pose.transformPosition(corner);
			lowest = Math.min(lowest, corner.y);
		}

		return lowest;
	}

	/** The pose the renderer mixin builds: lift, then rotate about the box center. */
	private static Matrix4f pose(float lift, float[] min, float[] max, float yaw, float pitch) {
		float cx = (min[0] + max[0]) / 2;
		float cy = (min[1] + max[1]) / 2;
		float cz = (min[2] + max[2]) / 2;
		return new Matrix4f().translate(0, lift, 0).translate(cx, cy, cz).rotate(new Quaternionf().rotationYXZ(yaw, pitch, 0)).translate(-cx, -cy, -cz);
	}

	@Test
	void itemsRestJustAboveTheGroundAtAnyAngle() {
		Random random = new Random(1);

		for (int count = 1; count <= 5; count++) {
			for (int round = 0; round < 200; round++) {
				float yaw = random.nextFloat() * 2 * PI;
				float pitch = random.nextFloat() * 4 * PI - 2 * PI;

				for (float[][] box : new float[][][] {{ITEM_MIN, ITEM_MAX}, {BLOCK_MIN, BLOCK_MAX}}) {
					float[] min = box[0];
					float[] max = box[1];
					float depth = max[2] - min[2];
					float lift = ItemPhysicsMath.lift(pitch, min[1], max[1], min[2], max[2], count);
					Matrix4f pose = pose(lift, min, max, yaw, pitch);
					boolean flat = ItemPhysicsMath.isFlat(depth);
					// Copies of a flat item are stacked along its depth, as the renderer does.
					float spacing = depth * 1.5F;
					float lowest = Float.MAX_VALUE;

					for (int copy = 0; copy < (flat ? count : 1); copy++) {
						lowest = Math.min(lowest, lowest(pose, min, max, flat ? -(spacing * (count - 1) / 2F) + copy * spacing : 0));
					}

					assertEquals(ItemPhysicsMath.GROUND_GAP, lowest, 1e-4, "count " + count + ", flat " + flat);
				}
			}
		}
	}

	/** The renderer's copies with their random offsets, as ItemEntityRenderer draws a stack. */
	@Test
	void jitteredCopiesStayAboveTheGround() {
		Random angles = new Random(2);

		for (int seed = 0; seed < 300; seed++) {
			for (int count = 2; count <= 5; count++) {
				float pitch = angles.nextInt(4) * PI / 2 + (seed % 3 == 0 ? angles.nextFloat() * 2 * PI : 0);

				for (float[][] box : new float[][][] {{ITEM_MIN, ITEM_MAX}, {BLOCK_MIN, BLOCK_MAX}}) {
					float[] min = box[0];
					float[] max = box[1];
					float depth = max[2] - min[2];
					boolean flat = ItemPhysicsMath.isFlat(depth);
					Random random = new Random(seed);
					float lift = ItemPhysicsMath.lift(pitch, min[1], max[1], min[2], max[2], count)
							+ ItemPhysicsMath.clusterDrop(pitch, flat, count, random::nextFloat);
					Matrix4f pose = pose(lift, min, max, 0.7F, pitch);
					float spacing = depth * 1.5F;
					random = new Random(seed);
					float lowest = Float.MAX_VALUE;

					for (int copy = 0; copy < count; copy++) {
						Matrix4f copyPose = new Matrix4f(pose);

						if (flat) {
							copyPose.translate(0, 0, -(spacing * (count - 1) / 2F) + copy * spacing);

							if (copy > 0) {
								copyPose.translate((random.nextFloat() * 2 - 1) * 0.075F, (random.nextFloat() * 2 - 1) * 0.075F, 0);
							}
						} else if (copy > 0) {
							copyPose.translate((random.nextFloat() * 2 - 1) * 0.15F, (random.nextFloat() * 2 - 1) * 0.15F, (random.nextFloat() * 2 - 1) * 0.15F);
						}

						lowest = Math.min(lowest, lowest(copyPose, min, max, 0));
					}

					String at = "seed " + seed + ", count " + count + ", flat " + flat + ", pitch " + pitch;

					if (flat) {
						// Conservative for flat items: never below, at most a jitter above.
						assertTrue(lowest >= ItemPhysicsMath.GROUND_GAP - 1e-4 && lowest <= ItemPhysicsMath.GROUND_GAP + 0.08F, at + ": " + lowest);
					} else {
						assertEquals(ItemPhysicsMath.GROUND_GAP, lowest, 1e-4, at);
					}
				}
			}
		}
	}

	@Test
	void clusterDropIsZeroForOneCopyAndForFlatItemsLyingDown() {
		Random random = new Random(5);
		assertEquals(0, ItemPhysicsMath.clusterDrop(0.3F, false, 1, random::nextFloat));

		for (int i = 0; i < 50; i++) {
			assertEquals(0, ItemPhysicsMath.clusterDrop(ItemPhysicsMath.LAY_FLAT_PITCH, true, 5, random::nextFloat), 1e-6);
		}
	}

	@Test
	void layingFlatPutsTheFrontFaceUp() {
		Vector3f front = new Vector3f(0, 0, 1);
		new Quaternionf().rotationYXZ(1.3F, ItemPhysicsMath.LAY_FLAT_PITCH, 0).transform(front);
		assertTrue(front.y > 0.999F);
	}

	@Test
	void closedFormLifts() {
		assertEquals(-0.09375F, ItemPhysicsMath.lift(ItemPhysicsMath.LAY_FLAT_PITCH, ITEM_MIN[1], ITEM_MAX[1], ITEM_MIN[2], ITEM_MAX[2], 1), 1e-6);
		assertEquals(-0.09375F + 4 * 0.75F / 32, ItemPhysicsMath.lift(ItemPhysicsMath.LAY_FLAT_PITCH, ITEM_MIN[1], ITEM_MAX[1], ITEM_MIN[2], ITEM_MAX[2], 5), 1e-6);
		assertEquals(1F / 64 - 0.0625F, ItemPhysicsMath.lift(0, BLOCK_MIN[1], BLOCK_MAX[1], BLOCK_MIN[2], BLOCK_MAX[2], 3), 1e-6);
		assertEquals(ItemPhysicsMath.lift(PI / 2, ITEM_MIN[1], ITEM_MAX[1], ITEM_MIN[2], ITEM_MAX[2], 2),
				ItemPhysicsMath.lift(-PI / 2, ITEM_MIN[1], ITEM_MAX[1], ITEM_MIN[2], ITEM_MAX[2], 2), 1e-6);
	}

	@Test
	void flatMeansTheGamesFlatItems() {
		assertTrue(ItemPhysicsMath.isFlat(1F / 32));
		assertTrue(ItemPhysicsMath.isFlat(0.0625F));
		assertFalse(ItemPhysicsMath.isFlat(0.0626F));
		assertEquals(0, ItemPhysicsMath.flatStackHalfSpread(0.25F, 5));
	}

	@Test
	void tumbling() {
		assertEquals(0, ItemPhysicsMath.step(1.0F, Float.NaN, 10, true, 0.5F, PI), "landed on the first frame: flat at once");
		assertEquals(1.0F, ItemPhysicsMath.step(1.0F, Float.NaN, 10, false, 0.5F, PI), "in the air on the first frame: keep the angle");
		assertEquals(0.25F, ItemPhysicsMath.step(0, 10, 10.5F, false, 0.5F, PI), 1e-6, "half a tick");
		assertEquals(3.0F, ItemPhysicsMath.step(1.0F, 10, 400, false, 0.5F, PI), 1e-6, "a long gap counts as four ticks");
		assertEquals(2.0F, ItemPhysicsMath.step(1.0F, 10, 12, false, 0.5F, PI), 1e-6, "10 FPS keeps real time");
		assertEquals(0.3F, ItemPhysicsMath.step(0.3F, 5, 5, false, 0.5F, PI), "paused");
		float wrapped = ItemPhysicsMath.step(6.2F, 10, 11, false, 0.5F, PI);
		assertTrue(wrapped >= 0 && wrapped < 2 * PI);
	}

	@Test
	void landedItemsRollOntoTheirSide() {
		assertTrue(ItemPhysicsMath.step(1.0F, 10, 11, true, 0.5F, PI) > 1.0F, "rolls forward, not back");
		float angle = 1.0F;

		for (int tick = 0; tick < 40; tick++) {
			angle = ItemPhysicsMath.step(angle, tick, tick + 1, true, 0.5F, PI);
		}

		assertEquals(PI, angle, 1e-4);
		angle = 4.0F;

		for (int tick = 0; tick < 40; tick++) {
			angle = ItemPhysicsMath.step(angle, tick, tick + 1, true, 0.5F, PI);
		}

		assertEquals(0, angle, "a full turn wraps to 0");
		assertEquals(PI, ItemPhysicsMath.step(PI, 0, 1, true, 0.5F, PI));
		assertEquals(0, ItemPhysicsMath.step(0, 0, 1, true, 0.5F, PI));
	}

	@Test
	void spinSpeed() {
		assertEquals(0, ItemPhysicsMath.spinRate(0, 1));
		assertEquals(0.5F, ItemPhysicsMath.spinRate(0.5, 1), 1e-6);
		assertEquals(0.5F, ItemPhysicsMath.spinRate(3, 1), 1e-6, "capped");
		assertEquals(1.0F, ItemPhysicsMath.spinRate(3, 2), 1e-6);
	}
}
