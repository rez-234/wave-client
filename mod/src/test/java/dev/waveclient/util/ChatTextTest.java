package dev.waveclient.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ChatTextTest {
	private static String stamp(int h, int m, int s, boolean twelve, boolean seconds) {
		return ChatText.appendStamp(new StringBuilder(), h, m, s, twelve, seconds).toString();
	}

	@Test
	void stamps() {
		assertEquals("[14:05] ", stamp(14, 5, 9, false, false));
		assertEquals("[09:07:03] ", stamp(9, 7, 3, false, true));
		assertEquals("[00:00] ", stamp(0, 0, 0, false, false));
		assertEquals("[2:05 PM] ", stamp(14, 5, 0, true, false));
		assertEquals("[12:05 AM] ", stamp(0, 5, 0, true, false));
		assertEquals("[12:00:00 PM] ", stamp(12, 0, 0, true, true));
		assertEquals("[11:59 PM] ", stamp(23, 59, 0, true, false));
	}

	@Test
	void plainTextDropsFormattingCodesAndSprites() {
		assertEquals("Hello world", ChatText.plain("§aHello §lworld"));
		assertEquals("Steve: hi", ChatText.plain("￼Steve: hi"));
		assertEquals("trailing", ChatText.plain("trailing§"));
		assertEquals("", ChatText.plain(""));
	}

	@Test
	void blankMessagesHaveNoText() {
		assertFalse(ChatText.hasText(""));
		assertFalse(ChatText.hasText("   "));
		assertTrue(ChatText.hasText(" a "));
	}

	@Test
	void previews() {
		assertEquals("short", ChatText.preview("short", 40));
		assertEquals("abc...", ChatText.preview("abcdef", 3));
		assertEquals("first...", ChatText.preview("first\nsecond", 40));
		// A surrogate pair isn't split: the emoji is dropped whole.
		assertEquals("ab...", ChatText.preview("ab😀cd", 3));
	}
}
