package dev.waveclient.module.impl.chat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import org.junit.jupiter.api.Test;

class ChatLinesTest {
	/** A wrapped line: which message it came from, and whether it is that message's last line. */
	private record Line(int message, boolean endOfEntry) {
	}

	/** The chat's two lists as the game keeps them: newest first, oldest dropped past the limits. */
	private static final class Model {
		final List<Integer> messages = new ArrayList<>();
		final List<Line> lines = new ArrayList<>();
		int next;

		void add(int lineCount, int messageLimit, int lineLimit) {
			int id = next++;

			// Lines are added first to last, each at the front, so the last line ends up lowest.
			for (int i = 0; i < lineCount; i++) {
				lines.add(0, new Line(id, i == lineCount - 1));
			}

			while (lines.size() > lineLimit) {
				lines.remove(lines.size() - 1);
			}

			messages.add(0, id);

			while (messages.size() > messageLimit) {
				messages.remove(messages.size() - 1);
			}
		}
	}

	@Test
	void everyLineMapsToItsOwnMessage() {
		Random random = new Random(42);

		for (int round = 0; round < 200; round++) {
			Model model = new Model();
			int messageLimit = 5 + random.nextInt(40);
			// The line limit is at least the message limit, as in the game.
			int lineLimit = messageLimit + random.nextInt(40);

			for (int n = 0; n < 150; n++) {
				model.add(1 + random.nextInt(4), messageLimit, lineLimit);

				for (int i = 0; i < model.lines.size(); i++) {
					int index = ChatLines.messageIndex(k -> model.lines.get(k).endOfEntry(), model.lines.size(), i);
					Line line = model.lines.get(i);

					// With more lines kept than messages, a line can outlive its message; the caller
					// then copies just the line.
					if (index < model.messages.size()) {
						assertEquals(line.message(), model.messages.get(index), "line " + i);
					}
				}
			}
		}
	}

	@Test
	void outOfRangeLines() {
		assertEquals(-1, ChatLines.messageIndex(k -> true, 3, -1));
		assertEquals(-1, ChatLines.messageIndex(k -> true, 3, 3));
		assertEquals(-1, ChatLines.messageIndex(k -> false, 3, 1), "no end-of-entry line below");
	}

	@Test
	void rowBands() {
		// Spacing 0: rows are 9 pixels, text drawn 1 below the row top.
		assertEquals(9, ChatLines.rowHeight(0));
		assertEquals(8, ChatLines.textOffset(0));
		assertTrue(ChatLines.rowContains(-1, 0, 0));
		assertTrue(ChatLines.rowContains(7.9F, 0, 0));
		assertFalse(ChatLines.rowContains(8, 0, 0));
		assertFalse(ChatLines.rowContains(-1.1F, 0, 0));
		// Spacing 1: 18-pixel rows.
		assertEquals(18, ChatLines.rowHeight(1));
		assertEquals(12, ChatLines.textOffset(1));
		assertTrue(ChatLines.rowContains(-6, 0, 1));
		assertFalse(ChatLines.rowContains(12, 0, 1));
	}

	@Test
	void historyNeverShrinksAnotherModsLimit() {
		assertEquals(500, ChatLines.historyLimit(100, true, 500));
		assertEquals(16384, ChatLines.historyLimit(16384, true, 500));
		assertEquals(100, ChatLines.historyLimit(100, false, 500));
	}
}
