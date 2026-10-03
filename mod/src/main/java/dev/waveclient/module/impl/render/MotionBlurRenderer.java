package dev.waveclient.module.impl.render;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.OptionalInt;
import java.util.function.Supplier;

import com.mojang.blaze3d.buffers.GpuBuffer;
import com.mojang.blaze3d.buffers.GpuBufferSlice;
import com.mojang.blaze3d.pipeline.RenderPipeline;
import com.mojang.blaze3d.pipeline.RenderTarget;
import com.mojang.blaze3d.pipeline.TextureTarget;
import com.mojang.blaze3d.shaders.UniformType;
import com.mojang.blaze3d.systems.CommandEncoder;
import com.mojang.blaze3d.systems.GpuDevice;
import com.mojang.blaze3d.systems.RenderPass;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.textures.FilterMode;
import com.mojang.blaze3d.textures.GpuSampler;
import com.mojang.blaze3d.textures.GpuTexture;
import com.mojang.blaze3d.textures.GpuTextureView;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.resources.Identifier;

import dev.waveclient.WaveClient;
import dev.waveclient.compat.IrisCompat;
import dev.waveclient.util.FrameClock;

/**
 * Draws motion blur: after the world is rendered (and before the HUD), one full-screen pass
 * blends the frame with the image kept from earlier frames, and the result becomes both the
 * frame and the new kept image.
 *
 * <p>The pipeline is not registered with the game, so a shader that fails to compile (a broken
 * resource pack) switches the effect off instead of failing the resource reload. Everything here
 * runs on the render thread, and nothing is allocated per frame.
 */
public final class MotionBlurRenderer {
	private static final Supplier<String> PASS_LABEL = () -> "Wave Client motion blur";
	private static final Supplier<String> CONFIG_LABEL = () -> "Wave Client motion blur config";
	private static final String CONFIG_BLOCK = "MotionBlurConfig";
	private static final int CONFIG_SIZE = 16;

	/** Built on first use, on the render thread. */
	private static final class Pipeline {
		static final RenderPipeline INSTANCE = RenderPipeline.builder(RenderPipelines.POST_PROCESSING_SNIPPET)
				.withLocation(Identifier.fromNamespaceAndPath(WaveClient.MOD_ID, "pipeline/motion_blur"))
				.withVertexShader("core/screenquad")
				.withFragmentShader(Identifier.fromNamespaceAndPath(WaveClient.MOD_ID, "post/motion_blur"))
				.withSampler("CurrentSampler")
				.withSampler("HistorySampler")
				.withUniform(CONFIG_BLOCK, UniformType.UNIFORM_BUFFER)
				.withoutBlend()
				.build();
	}

	private final MotionBlurModule module;
	private final FrameClock clock = new FrameClock(System::nanoTime);
	private final ByteBuffer configData = ByteBuffer.allocateDirect(CONFIG_SIZE).order(ByteOrder.nativeOrder());
	/** The image kept from earlier frames, and where this frame's blend is drawn; swapped every frame. */
	private TextureTarget history;
	private TextureTarget scratch;
	private GpuBuffer config;
	private GpuBufferSlice configSlice;
	private boolean historyValid;
	private boolean warnedInvalid;
	private boolean releaseRequested;

	public MotionBlurRenderer(MotionBlurModule module) {
		this.module = module;
	}

	/** Runs after the world is drawn and before the HUD and screens (from GameRendererMixin). */
	public void afterWorld() {
		if (releaseRequested) {
			release();
		}

		// Shader packs usually have their own motion blur, and draw the world differently.
		if (!module.isActive() || IrisCompat.isShaderPackInUse()) {
			historyValid = false;
			clock.reset();
			return;
		}

		try {
			float weight = (float) MotionBlurMath.historyWeight(clock.tick(), module.strength.get() / 100.0);
			apply(Minecraft.getInstance().getMainRenderTarget(), weight, module.naturalBlending.get());
		} catch (RuntimeException e) {
			WaveClient.LOGGER.error("Motion blur failed; disabling it", e);
			module.setEnabled(false);
		}
	}

	/** Whether the last frame was blended: the shader compiled and the textures exist. */
	public boolean isRunning() {
		return historyValid && !warnedInvalid;
	}

	/** Frees the textures and buffer now if on the render thread, otherwise before the next frame. */
	public void requestRelease() {
		if (RenderSystem.isOnRenderThread()) {
			release();
		} else {
			releaseRequested = true;
		}
	}

	private void apply(RenderTarget main, float weight, boolean linearLight) {
		GpuTexture mainColor = main.getColorTexture();
		GpuTextureView mainView = main.getColorTextureView();

		if (mainColor == null || mainView == null || main.width <= 0 || main.height <= 0) {
			return;
		}

		GpuDevice device = RenderSystem.getDevice();

		// A pass whose shader didn't compile is skipped silently, which would show a stale image.
		if (!device.precompilePipeline(Pipeline.INSTANCE).isValid()) {
			historyValid = false;

			if (!warnedInvalid) {
				warnedInvalid = true;
				WaveClient.LOGGER.warn("The motion blur shader didn't compile; motion blur is off until resources reload");
			}

			return;
		}

		warnedInvalid = false;
		ensureTargets(device, main.width, main.height);
		CommandEncoder encoder = device.createCommandEncoder();

		if (!historyValid) {
			// Start the trail from this frame rather than from black or an old image.
			encoder.copyTextureToTexture(mainColor, history.getColorTexture(), 0, 0, 0, 0, 0, main.width, main.height);
			historyValid = true;
			return;
		}

		configData.putFloat(0, weight).putFloat(4, linearLight ? 1.0F : 0.0F).putFloat(8, 0.0F).putFloat(12, 0.0F);
		encoder.writeToBuffer(configSlice, configData);
		GpuSampler nearest = RenderSystem.getSamplerCache().getClampToEdge(FilterMode.NEAREST);

		try (RenderPass pass = encoder.createRenderPass(PASS_LABEL, scratch.getColorTextureView(), OptionalInt.empty())) {
			pass.setPipeline(Pipeline.INSTANCE);
			pass.setUniform(CONFIG_BLOCK, configSlice);
			pass.bindTexture("CurrentSampler", mainView, nearest);
			pass.bindTexture("HistorySampler", history.getColorTextureView(), nearest);
			pass.draw(0, 3);
		}

		encoder.copyTextureToTexture(scratch.getColorTexture(), mainColor, 0, 0, 0, 0, 0, main.width, main.height);
		TextureTarget kept = scratch;
		scratch = history;
		history = kept;
	}

	private void ensureTargets(GpuDevice device, int width, int height) {
		if (config == null) {
			config = device.createBuffer(CONFIG_LABEL, GpuBuffer.USAGE_UNIFORM | GpuBuffer.USAGE_COPY_DST, CONFIG_SIZE);
			configSlice = config.slice();
		}

		if (history == null) {
			history = new TextureTarget("Wave Client motion blur history", width, height, false);
			scratch = new TextureTarget("Wave Client motion blur scratch", width, height, false);
			historyValid = false;
		} else if (history.width != width || history.height != height) {
			history.resize(width, height);
			scratch.resize(width, height);
			historyValid = false;
		}
	}

	private void release() {
		releaseRequested = false;
		historyValid = false;
		clock.reset();

		if (history != null) {
			history.destroyBuffers();
			scratch.destroyBuffers();
			history = null;
			scratch = null;
		}

		if (config != null) {
			config.close();
			config = null;
			configSlice = null;
		}
	}
}
