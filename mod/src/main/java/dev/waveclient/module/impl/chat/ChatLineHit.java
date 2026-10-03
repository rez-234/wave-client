package dev.waveclient.module.impl.chat;

import net.minecraft.client.gui.ActiveTextCollector;
import net.minecraft.client.gui.TextAlignment;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;
import org.joml.Matrix3x2f;
import org.joml.Vector2f;

/**
 * Finds the chat line under the mouse. The chat replays its drawing into this collector, so the
 * test uses exactly the positions the lines were drawn at, including other mods' changes to
 * them. Created per click, never per frame.
 */
final class ChatLineHit implements ActiveTextCollector {
	private final float mouseX;
	private final float mouseY;
	private final double spacing;
	private final int rowRight;
	private ActiveTextCollector.Parameters parameters = new ActiveTextCollector.Parameters(new Matrix3x2f());
	private FormattedCharSequence result;

	/** @param rowRight right edge of a row's background, in the chat's own coordinates */
	ChatLineHit(float mouseX, float mouseY, double spacing, int rowRight) {
		this.mouseX = mouseX;
		this.mouseY = mouseY;
		this.spacing = spacing;
		this.rowRight = rowRight;
	}

	/** The line under the mouse, or {@code null}. */
	FormattedCharSequence result() {
		return result;
	}

	@Override
	public ActiveTextCollector.Parameters defaultParameters() {
		return parameters;
	}

	@Override
	public void defaultParameters(ActiveTextCollector.Parameters parameters) {
		this.parameters = parameters;
	}

	@Override
	public void accept(TextAlignment alignment, int x, int y, ActiveTextCollector.Parameters lineParameters, FormattedCharSequence text) {
		Vector2f local = lineParameters.pose().invert(new Matrix3x2f()).transformPosition(mouseX, mouseY, new Vector2f());

		// A row's background runs from 4 left of the text to rowRight.
		if (local.x >= -4 && local.x < rowRight && ChatLines.rowContains(local.y, y, spacing)) {
			result = text;
		}
	}

	@Override
	public void acceptScrolling(Component text, int center, int left, int right, int top, int bottom, ActiveTextCollector.Parameters lineParameters) {
		// The chat never draws scrolling text.
	}
}
