package dev.waveclient.gui.widget;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class TextFieldModelTest {
	private static TextFieldModel field(String value) {
		TextFieldModel m = new TextFieldModel(32);
		m.setValue(value);
		return m;
	}

	@Test
	void typingInsertsAtTheCursorAndReplacesTheSelection() {
		TextFieldModel m = field("zom");
		m.move(-1, false, false);
		assertTrue(m.insert("o"));
		assertEquals("zoom", m.value());
		assertEquals(3, m.cursor());

		m.selectAll();
		m.insert("fps");
		assertEquals("fps", m.value());
		assertFalse(m.hasSelection());
	}

	@Test
	void pastedLineBreaksAndFormattingCodesAreDropped() {
		TextFieldModel m = field("");
		m.insert("a\nb\tc§d");
		assertEquals("abcd", m.value());
	}

	@Test
	void maxLengthCutsInsertedText() {
		TextFieldModel m = new TextFieldModel(5);
		m.insert("abcdefg");
		assertEquals("abcde", m.value());
		assertFalse(m.insert("x"), "full");
		m.moveTo(1, false);
		m.moveTo(3, true);
		m.insert("XYZ");
		assertEquals("aXYde", m.value(), "the selection's two characters make room for two");

		assertThrows(IllegalArgumentException.class, () -> new TextFieldModel(0));
	}

	@Test
	void surrogatePairsAreNeverSplit() {
		String emoji = "😀";
		TextFieldModel m = field("a" + emoji + "b");
		m.move(-1, false, false);
		m.move(-1, false, false);
		assertEquals(1, m.cursor(), "one step over the pair");
		m.moveTo(2, false);
		assertEquals(1, m.cursor(), "clamped out of the middle");
		m.moveTo(3, false);
		m.deleteBackward(false);
		assertEquals("ab", m.value());

		TextFieldModel tight = new TextFieldModel(2);
		tight.insert("a" + emoji);
		assertEquals("a", tight.value(), "a pair that doesn't fit is dropped whole");
	}

	@Test
	void backspaceAndDelete() {
		TextFieldModel m = field("hello world");
		assertTrue(m.deleteBackward(false));
		assertEquals("hello worl", m.value());
		assertTrue(m.deleteBackward(true));
		assertEquals("hello ", m.value());
		assertTrue(m.deleteBackward(true), "skips the space, then the word");
		assertEquals("", m.value());
		assertFalse(m.deleteBackward(false));

		m.setValue("one two");
		m.moveTo(0, false);
		assertTrue(m.deleteForward(true));
		assertEquals(" two", m.value());
		assertTrue(m.deleteForward(false));
		assertEquals("two", m.value());
		m.moveTo(3, false);
		assertFalse(m.deleteForward(false));
	}

	@Test
	void arrowsCollapseSelectionsAndShiftExtendsThem() {
		TextFieldModel m = field("abcdef");
		m.moveTo(2, false);
		m.move(1, false, true);
		m.move(1, false, true);
		assertEquals("cd", m.selectedText());
		m.move(-1, false, false);
		assertEquals(2, m.cursor(), "left collapses to the selection's start");
		assertFalse(m.hasSelection());

		m.move(1, true, false);
		assertEquals(6, m.cursor(), "word jump");
		m.selectWordAt(3);
		assertEquals("abcdef", m.selectedText());
	}

	@Test
	void filterRejectsEdits() {
		TextFieldModel m = new TextFieldModel(9).filter(s -> s.matches("#?[0-9a-fA-F]*"));
		m.insert("#12");
		assertFalse(m.insert("g"));
		assertEquals("#12", m.value());
		assertFalse(m.setValue("nope"));
		assertEquals("#12", m.value());
		m.insert("abz");
		assertEquals("#12", m.value(), "the whole paste is rejected if any of it is invalid");
	}

	@Test
	void setValueMovesTheCursorToTheEnd() {
		TextFieldModel m = field("abc");
		m.moveTo(0, false);
		assertTrue(m.setValue("xyz1"));
		assertEquals(4, m.cursor());
		assertFalse(m.setValue("xyz1"));
	}
}
