package dev.waveclient.gui.render;

import com.mojang.blaze3d.pipeline.RenderPipeline;
import com.mojang.blaze3d.vertex.VertexConsumer;
import net.minecraft.client.gui.navigation.ScreenRectangle;
import net.minecraft.client.gui.render.TextureSetup;
import net.minecraft.client.gui.render.state.GuiElementRenderState;
import net.minecraft.client.renderer.RenderPipelines;
import org.joml.Matrix3x2f;

/**
 * Many flat or vertically graded rectangles submitted as one GUI element.
 *
 * <p>Minecraft places every GUI element into a layer by scanning the elements already
 * submitted, which is quadratic in their number. A rounded rectangle with anti-aliased corners
 * is dozens of small rectangles, so drawing each with {@code GuiGraphics.fill} made a full menu
 * cost tens of thousands of placement checks per frame. Batched, a shape is one element.
 *
 * @param quads {@code x0, y0, x1, y1, topColor, bottomColor} per rectangle, in {@code pose}
 *              space, with x0 &lt; x1 and y0 &lt; y1 (the GUI pipeline culls back faces)
 */
record QuadBatchRenderState(Matrix3x2f pose, int[] quads, int count, ScreenRectangle scissorArea, ScreenRectangle bounds)
		implements GuiElementRenderState {
	static final int STRIDE = 6;

	@Override
	public void buildVertices(VertexConsumer consumer) {
		for (int i = 0; i < count; i++) {
			int o = i * STRIDE;
			float x0 = quads[o];
			float y0 = quads[o + 1];
			float x1 = quads[o + 2];
			float y1 = quads[o + 3];
			int top = quads[o + 4];
			int bottom = quads[o + 5];
			// Same vertex order as vanilla's ColoredRectangleRenderState.
			consumer.addVertexWith2DPose(pose, x0, y0).setColor(top);
			consumer.addVertexWith2DPose(pose, x0, y1).setColor(bottom);
			consumer.addVertexWith2DPose(pose, x1, y1).setColor(bottom);
			consumer.addVertexWith2DPose(pose, x1, y0).setColor(top);
		}
	}

	@Override
	public RenderPipeline pipeline() {
		return RenderPipelines.GUI;
	}

	@Override
	public TextureSetup textureSetup() {
		return TextureSetup.noTexture();
	}
}
