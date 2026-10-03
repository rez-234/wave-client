package dev.waveclient.module.impl.hud;

import java.util.ArrayList;
import java.util.List;

/**
 * Where each key of the keystrokes display goes:
 *
 * <pre>
 *      [ W ]
 * [ A ][ S ][ D ]
 * [ LMB  ][ RMB  ]
 * [    space     ]
 * </pre>
 *
 * The mouse and space rows are optional. Sizes are in unscaled GUI pixels.
 */
public final class KeystrokesLayout {
	public enum Key {
		FORWARD, LEFT, BACK, RIGHT, ATTACK, USE, JUMP
	}

	public record Cell(Key key, int x, int y, int width, int height) {
	}

	private final List<Cell> cells;
	private final int width;
	private final int height;

	private KeystrokesLayout(List<Cell> cells, int width, int height) {
		this.cells = List.copyOf(cells);
		this.width = width;
		this.height = height;
	}

	/**
	 * @param keySize side of a movement key
	 * @param gap     space between keys
	 */
	public static KeystrokesLayout of(boolean mouseRow, boolean spaceRow, int keySize, int gap) {
		List<Cell> cells = new ArrayList<>(7);
		int rowWidth = 3 * keySize + 2 * gap;
		int y = 0;

		cells.add(new Cell(Key.FORWARD, keySize + gap, y, keySize, keySize));
		y += keySize + gap;
		cells.add(new Cell(Key.LEFT, 0, y, keySize, keySize));
		cells.add(new Cell(Key.BACK, keySize + gap, y, keySize, keySize));
		cells.add(new Cell(Key.RIGHT, 2 * (keySize + gap), y, keySize, keySize));
		y += keySize;

		if (mouseRow) {
			y += gap;
			int half = (rowWidth - gap) / 2;
			cells.add(new Cell(Key.ATTACK, 0, y, half, keySize));
			cells.add(new Cell(Key.USE, rowWidth - half, y, half, keySize));
			y += keySize;
		}

		if (spaceRow) {
			y += gap;
			int spaceHeight = Math.max(4, keySize / 2);
			cells.add(new Cell(Key.JUMP, 0, y, rowWidth, spaceHeight));
			y += spaceHeight;
		}

		return new KeystrokesLayout(cells, rowWidth, y);
	}

	public List<Cell> cells() {
		return cells;
	}

	public int width() {
		return width;
	}

	public int height() {
		return height;
	}
}
