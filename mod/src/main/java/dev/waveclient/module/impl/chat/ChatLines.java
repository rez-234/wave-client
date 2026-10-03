package dev.waveclient.module.impl.chat;

import java.util.function.IntPredicate;

/**
 * How the chat stores and draws messages. Chat keeps whole messages and the wrapped lines they
 * are drawn as, both newest first; the last line of a message (its lowest index) is marked as
 * the end of the entry.
 */
public final class ChatLines {
	private ChatLines() {
	}

	/**
	 * The index of the message that wrapped line {@code line} belongs to, or -1.
	 *
	 * @param endOfEntry whether a line is the last line of its message
	 */
	public static int messageIndex(IntPredicate endOfEntry, int lineCount, int line) {
		if (line < 0 || line >= lineCount) {
			return -1;
		}

		int last = line;

		while (last >= 0 && !endOfEntry.test(last)) {
			last--;
		}

		if (last < 0) {
			return -1;
		}

		int index = 0;

		for (int i = 0; i < last; i++) {
			if (endOfEntry.test(i)) {
				index++;
			}
		}

		return index;
	}

	/** Height of one chat row for the "Line spacing" option, as the chat draws it. */
	public static int rowHeight(double spacing) {
		return (int) (9.0 * (spacing + 1.0));
	}

	/** How far above a row's bottom its text is drawn. */
	public static int textOffset(double spacing) {
		return (int) Math.round(8.0 * (spacing + 1.0) - 4.0 * spacing);
	}

	/** Whether {@code localY} (in the chat's own coordinates) is within the row whose text is drawn at {@code textY}. */
	public static boolean rowContains(float localY, int textY, double spacing) {
		int bottom = textY + textOffset(spacing);
		return localY >= bottom - rowHeight(spacing) && localY < bottom;
	}

	/** The message limit: ours when it is larger, never lowering another mod's. */
	public static int historyLimit(int current, boolean active, int configured) {
		return active ? Math.max(current, configured) : current;
	}
}
