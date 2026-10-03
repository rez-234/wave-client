package dev.waveclient.module.impl.render;

import com.mojang.blaze3d.pipeline.RenderPipeline;
import com.mojang.blaze3d.platform.Window;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElement;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.minecraft.client.AttackIndicatorStatus;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.debug.DebugScreenEntries;
import net.minecraft.client.gui.navigation.ScreenRectangle;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.core.component.DataComponents;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.component.AttackRange;
import net.minecraft.world.level.GameType;
import org.joml.Matrix3x2f;
import org.joml.Matrix3x2fc;

import dev.waveclient.WaveClient;
import dev.waveclient.gui.render.QuadBatchRenderState;
import dev.waveclient.mixin.GuiAccessor;
import dev.waveclient.module.Category;
import dev.waveclient.module.Module;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.ColorSetting;
import dev.waveclient.setting.EnumSetting;
import dev.waveclient.setting.Setting;
import dev.waveclient.setting.SliderSetting;

/**
 * Replaces the crosshair with a shape of your own. It shows exactly when vanilla's would (first
 * person, not over F3's 3D crosshair, spectator rules), keeps vanilla's attack indicator, and
 * never changes with what you aim at. With the default settings it draws the vanilla crosshair.
 *
 * <p>The shape is turned into rectangles once per settings change and drawn as one or two GUI
 * elements, which are reused across frames while the window, GUI scale and settings stay the
 * same.
 */
// Settings register change listeners that capture 'this', but they only run on later edits.
@SuppressWarnings("this-escape")
public final class CrosshairModule extends Module {
	public enum Blend implements EnumSetting.Labeled {
		INVERT("Invert like vanilla"),
		COLOR("Solid color");

		private final String label;

		Blend(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	public enum Units implements EnumSetting.Labeled {
		GUI("Scale with GUI"),
		SCREEN("Screen pixels");

		private final String label;

		Units(String label) {
			this.label = label;
		}

		@Override
		public String label() {
			return label;
		}
	}

	private static final Identifier INDICATOR_FULL = Identifier.withDefaultNamespace("hud/crosshair_attack_indicator_full");
	private static final Identifier INDICATOR_BACKGROUND = Identifier.withDefaultNamespace("hud/crosshair_attack_indicator_background");
	private static final Identifier INDICATOR_PROGRESS = Identifier.withDefaultNamespace("hud/crosshair_attack_indicator_progress");

	public final EnumSetting<CrosshairShape.Style> style = add(new EnumSetting<>("style", "Shape", CrosshairShape.Style.CROSS));
	public final SliderSetting length = add(new SliderSetting("length", "Size", 4, 1, 20, 1)
			.describe("Arm length, or the radius of a circle or square.")
			.visibleWhen(() -> style.get() != CrosshairShape.Style.DOT));
	public final SliderSetting gap = add(new SliderSetting("gap", "Gap", 0, 0, 10, 1)
			.describe("Space between the center and the arms. 0 joins them, like vanilla.")
			.visibleWhen(() -> style.get() == CrosshairShape.Style.CROSS || style.get() == CrosshairShape.Style.T));
	public final SliderSetting thickness = add(new SliderSetting("thickness", "Thickness", 1, 1, 6, 1)
			.visibleWhen(() -> style.get() != CrosshairShape.Style.DOT));
	public final BooleanSetting centerDot = add(new BooleanSetting("centerDot", "Center dot", false)
			.visibleWhen(() -> style.get() != CrosshairShape.Style.DOT));
	public final SliderSetting dotSize = add(new SliderSetting("dotSize", "Dot size", 1, 1, 6, 1)
			.visibleWhen(() -> centerDot.get() || style.get() == CrosshairShape.Style.DOT));
	public final EnumSetting<Blend> blend = add(new EnumSetting<>("blend", "Color", Blend.INVERT)
			.describe("Invert shows the opposite of what's behind it, so it stays visible on any background."));
	public final SliderSetting invertStrength = add(new SliderSetting("invertStrength", "Invert strength", 100, 0, 100, 5).unit("%")
			.visibleWhen(() -> blend.get() == Blend.INVERT));
	public final ColorSetting color = add(new ColorSetting("color", "Crosshair color", 0xFFFFFFFF)
			.visibleWhen(() -> blend.get() == Blend.COLOR));
	public final SliderSetting outline = add(new SliderSetting("outline", "Outline", 0, 0, 3, 1)
			.describe("A border around the shape. Helps on grey backgrounds, where inverting changes little."));
	public final ColorSetting outlineColor = add(new ColorSetting("outlineColor", "Outline color", 0xFF000000)
			.visibleWhen(() -> outline.getInt() > 0));
	public final EnumSetting<Units> units = add(new EnumSetting<>("units", "Size in", Units.GUI)
			.describe("Screen pixels keep the same size at every GUI scale."));
	public final BooleanSetting moveIndicator = add(new BooleanSetting("moveIndicator", "Keep attack indicator below", true)
			.describe("Move the attack indicator down when the crosshair is taller than vanilla's."));

	private boolean dirty = true;
	private int version;
	private CrosshairShape shape;
	private int[] fillQuads;
	private int[] outlineQuads;

	// The elements last built, and what they were built for.
	private QuadBatchRenderState fillElement;
	private QuadBatchRenderState outlineElement;
	private int indicatorTop;
	private int builtVersion = -1;
	private int builtGuiWidth;
	private int builtGuiHeight;
	private int builtWidth;
	private int builtHeight;
	private int builtScale;
	private ScreenRectangle builtScissor;
	private final Matrix3x2f builtPose = new Matrix3x2f();

	public CrosshairModule() {
		super("crosshair", "Custom Crosshair", "Replace the crosshair with your own shape and color.", Category.RENDER);
	}

	/** Call once, at client init. */
	public static void register(CrosshairModule module) {
		Element element = new Element(module);
		HudElementRegistry.replaceElement(VanillaHudElements.CROSSHAIR, element::wrap);
	}

	@Override
	protected void onSettingChanged(Setting<?> setting) {
		// Rebuilt on the next frame, so a slider drag rebuilds at most once per frame.
		dirty = true;
	}

	private void rebuildShape() {
		shape = CrosshairShape.of(new CrosshairShape.Spec(style.get(), length.getInt(), gap.getInt(), thickness.getInt(),
				centerDot.get(), dotSize.getInt(), outline.getInt()));
		int fillColor = blend.get() == Blend.INVERT ? CrosshairShape.invertColor(invertStrength.get() / 100.0) : color.get();
		fillQuads = quads(shape.fillRects(), fillColor);
		outlineQuads = quads(shape.outlineRects(), outlineColor.get());
		dirty = false;
		version++;
	}

	private static int[] quads(int[] rects, int color) {
		int count = rects.length / 4;
		int[] out = new int[count * QuadBatchRenderState.STRIDE];

		for (int i = 0; i < count; i++) {
			int o = i * QuadBatchRenderState.STRIDE;
			out[o] = rects[i * 4];
			out[o + 1] = rects[i * 4 + 1];
			out[o + 2] = rects[i * 4 + 2];
			out[o + 3] = rects[i * 4 + 3];
			out[o + 4] = color;
			out[o + 5] = color;
		}

		return out;
	}

	private void draw(GuiGraphics graphics, Minecraft minecraft) {
		if (dirty) {
			rebuildShape();
		}

		Window window = minecraft.getWindow();
		int guiWidth = graphics.guiWidth();
		int guiHeight = graphics.guiHeight();
		int width = window.getWidth();
		int height = window.getHeight();
		int scale = window.getGuiScale();
		ScreenRectangle scissor = graphics.scissorStack.peek();

		if (version != builtVersion || guiWidth != builtGuiWidth || guiHeight != builtGuiHeight || width != builtWidth
				|| height != builtHeight || scale != builtScale || scissor != builtScissor || !samePose(graphics.pose(), builtPose)) {
			buildElements(graphics, guiWidth, guiHeight, width, height, scale, scissor);
		}

		// Like vanilla: invert against the finished world and camera overlays.
		graphics.nextStratum();

		if (outlineElement != null) {
			graphics.guiRenderState.submitGuiElement(outlineElement);
		}

		if (fillElement != null) {
			graphics.guiRenderState.submitGuiElement(fillElement);
		}

		if (minecraft.options.attackIndicator().get() == AttackIndicatorStatus.CROSSHAIR) {
			drawAttackIndicator(graphics, minecraft, indicatorTop);
		}
	}

	private void buildElements(GuiGraphics graphics, int guiWidth, int guiHeight, int width, int height, int scale, ScreenRectangle scissor) {
		builtVersion = version;
		builtGuiWidth = guiWidth;
		builtGuiHeight = guiHeight;
		builtWidth = width;
		builtHeight = height;
		builtScale = scale;
		builtScissor = scissor;
		builtPose.set(graphics.pose());

		// Rectangles are relative to the center pixel, the one vanilla centers its crosshair on.
		Matrix3x2f pose = new Matrix3x2f(graphics.pose());
		int bottom;

		if (units.get() == Units.GUI) {
			pose.translate(CrosshairShape.centerPixel(guiWidth), CrosshairShape.centerPixel(guiHeight));
			bottom = shape.maxY();
		} else {
			float s = Math.max(1, scale);
			pose.translate(CrosshairShape.centerPixel(width) / s, CrosshairShape.centerPixel(height) / s).scale(1 / s);
			bottom = (int) Math.ceil((CrosshairShape.centerPixel(height) + shape.maxY()) / s) - CrosshairShape.centerPixel(guiHeight);
		}

		indicatorTop = moveIndicator.get() ? CrosshairShape.indicatorTop(guiHeight, bottom) : guiHeight / 2 - 7 + 16;
		RenderPipeline fillPipeline = blend.get() == Blend.INVERT ? RenderPipelines.GUI_INVERT : RenderPipelines.GUI;
		fillElement = element(fillPipeline, pose, fillQuads, scissor);
		outlineElement = element(RenderPipelines.GUI, pose, outlineQuads, scissor);
	}

	private QuadBatchRenderState element(RenderPipeline pipeline, Matrix3x2f pose, int[] quads, ScreenRectangle scissor) {
		int count = quads.length / QuadBatchRenderState.STRIDE;

		if (count == 0) {
			return null;
		}

		return QuadBatchRenderState.of(pipeline, pose, quads, count, scissor, shape.minX(), shape.minY(), shape.maxX(), shape.maxY());
	}

	/** Matrix3x2f.equals compares classes too, and the pose is a Matrix3x2fStack. */
	private static boolean samePose(Matrix3x2fc a, Matrix3x2fc b) {
		return a.m00() == b.m00() && a.m01() == b.m01() && a.m10() == b.m10() && a.m11() == b.m11() && a.m20() == b.m20() && a.m21() == b.m21();
	}

	/** Vanilla's attack indicator under the crosshair (Gui.renderCrosshair), at {@code top}. */
	private static void drawAttackIndicator(GuiGraphics graphics, Minecraft minecraft, int top) {
		LocalPlayer player = minecraft.player;
		float strength = player.getAttackStrengthScale(0.0F);
		boolean full = false;

		if (minecraft.crosshairPickEntity instanceof LivingEntity && strength >= 1.0F) {
			full = player.getCurrentItemAttackStrengthDelay() > 5.0F;
			full &= minecraft.crosshairPickEntity.isAlive();
			AttackRange range = player.getActiveItem().get(DataComponents.ATTACK_RANGE);
			full &= range == null || range.isInRange(player, minecraft.hitResult.getLocation());
		}

		int x = graphics.guiWidth() / 2 - 8;

		if (full) {
			graphics.blitSprite(RenderPipelines.CROSSHAIR, INDICATOR_FULL, x, top, 16, 16);
		} else if (strength < 1.0F) {
			graphics.blitSprite(RenderPipelines.CROSSHAIR, INDICATOR_BACKGROUND, x, top, 16, 4);
			graphics.blitSprite(RenderPipelines.CROSSHAIR, INDICATOR_PROGRESS, 16, 4, 0, 0, x, top, (int) (strength * 17.0F), 4);
		}
	}

	/** Whether vanilla would draw a crosshair now (Gui.renderCrosshair's own checks). */
	private static boolean vanillaWouldDraw(Minecraft minecraft) {
		if (minecraft.player == null || minecraft.gameMode == null) {
			return false;
		}

		// getCameraType, not the option itself: freelook and snaplook report third person.
		if (!minecraft.options.getCameraType().isFirstPerson()) {
			return false;
		}

		if (minecraft.gameMode.getPlayerMode() == GameType.SPECTATOR
				&& !((GuiAccessor) minecraft.gui).waveclient$canRenderCrosshairForSpectator(minecraft.hitResult)) {
			return false;
		}

		// F3's 3D crosshair (it already accounts for reduced debug info).
		return !minecraft.debugEntries.isCurrentlyEnabled(DebugScreenEntries.THREE_DIMENSIONAL_CROSSHAIR);
	}

	/**
	 * Stands in for the vanilla crosshair element. Fabric applies the replacement every frame, so
	 * this keeps the latest original in a field and hands back the same object. Whenever vanilla
	 * would draw nothing, the original runs, so mods that show a crosshair in more situations
	 * (third-person crosshair mods) still work.
	 */
	private static final class Element implements HudElement {
		private final CrosshairModule module;
		private HudElement original;

		Element(CrosshairModule module) {
			this.module = module;
		}

		HudElement wrap(HudElement vanilla) {
			original = vanilla;
			return this;
		}

		@Override
		public void render(GuiGraphics graphics, DeltaTracker deltaTracker) {
			Minecraft minecraft = Minecraft.getInstance();

			if (module.isActive() && vanillaWouldDraw(minecraft)) {
				try {
					module.draw(graphics, minecraft);
					return;
				} catch (RuntimeException e) {
					WaveClient.LOGGER.error("Custom crosshair failed to draw; disabling it", e);
					module.setEnabled(false);
				}
			}

			if (original != null) {
				original.render(graphics, deltaTracker);
			}
		}
	}
}
