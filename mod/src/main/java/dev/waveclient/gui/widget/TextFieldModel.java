package dev.waveclient.gui.widget;

import java.util.Objects;
import java.util.function.Predicate;

/**
 * The editing state of a single-line text field: value, cursor and selection. Rendering and key
 * mapping live in {@link TextField}; this class has no Minecraft dependencies so it can be tested.
 *
 * <p>Positions are {@code char} indices. The selection runs between the cursor and the anchor;
 * they are equal when nothing is selected.
 */
public final class TextFieldModel {
	private static final Predicate<String> ANYTHING = s -> true;

	private final int maxLength;
	private Predicate<String> filter = ANYTHING;
	private String value = "";
	private int cursor;
	private int anchor;

	public TextFieldModel(int maxLength) {
		if (maxLength < 1) {
			throw new IllegalArgumentException("maxLength must be positive");
		}

		this.maxLength = maxLength;
	}

	/** Only values the predicate accepts are kept; an edit that would produce anything else is ignored. */
	public TextFieldModel filter(Predicate<String> filter) {
		this.filter = Objects.requireNonNull(filter, "filter");
		return this;
	}

	public String value() {
		return value;
	}

	public int cursor() {
		return cursor;
	}

	public int anchor() {
		return anchor;
	}

	public int selectionStart() {
		return Math.min(cursor, anchor);
	}

	public int selectionEnd() {
		return Math.max(cursor, anchor);
	}

	public boolean hasSelection() {
		return cursor != anchor;
	}

	public String selectedText() {
		return value.substring(selectionStart(), selectionEnd());
	}

	/**
	 * Replaces the whole value (e.g. when the setting changed elsewhere) and puts the cursor at
	 * the end. Input that is too long is cut; input the filter rejects is ignored.
	 *
	 * @return whether the value changed
	 */
	public boolean setValue(String newValue) {
		String v = sanitize(newValue);

		if (v.length() > maxLength) {
			v = v.substring(0, maxLength);
		}

		if (!filter.test(v)) {
			return false;
		}

		boolean changed = !v.equals(value);
		value = v;
		cursor = anchor = v.length();
		return changed;
	}

	/**
	 * Types or pastes text over the selection. Line breaks and other control characters are
	 * dropped, and the text is cut to fit the maximum length.
	 *
	 * @return whether the value changed
	 */
	public boolean insert(String text) {
		String clean = sanitize(text);
		int start = selectionStart();
		int end = selectionEnd();
		int room = maxLength - (value.length() - (end - start));

		if (clean.length() > room) {
			clean = clean.substring(0, Math.max(0, room));

			// Don't split a surrogate pair at the cut.
			if (!clean.isEmpty() && Character.isHighSurrogate(clean.charAt(clean.length() - 1))) {
				clean = clean.substring(0, clean.length() - 1);
			}
		}

		if (clean.isEmpty() && start == end) {
			return false;
		}

		return replace(start, end, clean, start + clean.length());
	}

	/** Backspace: deletes the selection, or the character (or word, with {@code word}) before the cursor. */
	public boolean deleteBackward(boolean word) {
		if (hasSelection()) {
			return replace(selectionStart(), selectionEnd(), "", selectionStart());
		}

		if (cursor == 0) {
			return false;
		}

		int from = word ? wordStartBefore(cursor) : previousCodePoint(cursor);
		return replace(from, cursor, "", from);
	}

	/** Delete: deletes the selection, or the character (or word) after the cursor. */
	public boolean deleteForward(boolean word) {
		if (hasSelection()) {
			return replace(selectionStart(), selectionEnd(), "", selectionStart());
		}

		if (cursor == value.length()) {
			return false;
		}

		int to = word ? wordEndAfter(cursor) : nextCodePoint(cursor);
		return replace(cursor, to, "", cursor);
	}

	/**
	 * Left or right arrow. Without {@code select}, an existing selection collapses to its edge
	 * in that direction instead of moving.
	 */
	public void move(int direction, boolean word, boolean select) {
		if (!select && hasSelection() && !word) {
			int edge = direction < 0 ? selectionStart() : selectionEnd();
			cursor = anchor = edge;
			return;
		}

		int target;

		if (direction < 0) {
			target = word ? wordStartBefore(cursor) : previousCodePoint(cursor);
		} else {
			target = word ? wordEndAfter(cursor) : nextCodePoint(cursor);
		}

		moveTo(target, select);
	}

	/** Moves the cursor to {@code position} (clamped), extending the selection if {@code select}. */
	public void moveTo(int position, boolean select) {
		cursor = Math.max(0, Math.min(value.length(), position));

		// Never leave the cursor between the two halves of a surrogate pair.
		if (cursor > 0 && cursor < value.length() && Character.isLowSurrogate(value.charAt(cursor))
				&& Character.isHighSurrogate(value.charAt(cursor - 1))) {
			cursor--;
		}

		if (!select) {
			anchor = cursor;
		}
	}

	public void selectAll() {
		anchor = 0;
		cursor = value.length();
	}

	/** Selects the word around {@code position}, as a double-click does. */
	public void selectWordAt(int position) {
		int p = Math.max(0, Math.min(value.length(), position));
		int start = p;
		int end = p;

		while (start > 0 && isWordChar(value.charAt(start - 1))) {
			start--;
		}

		while (end < value.length() && isWordChar(value.charAt(end))) {
			end++;
		}

		anchor = start;
		cursor = end;
	}

	private boolean replace(int start, int end, String text, int newCursor) {
		String next = value.substring(0, start) + text + value.substring(end);

		if (!filter.test(next)) {
			return false;
		}

		boolean changed = !next.equals(value);
		value = next;
		cursor = anchor = newCursor;
		return changed;
	}

	private int previousCodePoint(int from) {
		return from <= 0 ? 0 : value.offsetByCodePoints(from, -1);
	}

	private int nextCodePoint(int from) {
		return from >= value.length() ? value.length() : value.offsetByCodePoints(from, 1);
	}

	/** Start of the word before {@code from}, skipping any spaces first (Ctrl+Left, Ctrl+Backspace). */
	private int wordStartBefore(int from) {
		int i = from;

		while (i > 0 && !isWordChar(value.charAt(i - 1))) {
			i--;
		}

		while (i > 0 && isWordChar(value.charAt(i - 1))) {
			i--;
		}

		return i;
	}

	/** End of the word after {@code from}, skipping any spaces first (Ctrl+Right, Ctrl+Delete). */
	private int wordEndAfter(int from) {
		int i = from;

		while (i < value.length() && !isWordChar(value.charAt(i))) {
			i++;
		}

		while (i < value.length() && isWordChar(value.charAt(i))) {
			i++;
		}

		return i;
	}

	private static boolean isWordChar(char c) {
		return Character.isLetterOrDigit(c) || Character.isSurrogate(c) || c == '_';
	}

	/** Drops control characters (including line breaks from a paste) and the section sign used for formatting codes. */
	private static String sanitize(String text) {
		StringBuilder out = new StringBuilder(text.length());

		for (int i = 0; i < text.length(); i++) {
			char c = text.charAt(i);

			if (c >= ' ' && c != '\u007f' && c != '§') {
				out.append(c);
			}
		}

		return out.toString();
	}
}
