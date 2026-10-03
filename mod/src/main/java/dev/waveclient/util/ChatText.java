package dev.waveclient.util;

/** Text helpers for chat: timestamps and plain text for copying. */
public final class ChatText {
	private static final char SECTION_SIGN = '§';
	/** What object components (player heads and other sprites) become in styled text. */
	private static final char OBJECT_PLACEHOLDER = '￼';

	private ChatText() {
	}

	/** Appends a stamp such as {@code "[14:05] "} or {@code "[2:05 PM] "}. */
	public static StringBuilder appendStamp(StringBuilder out, int hour, int minute, int second, boolean twelveHour, boolean seconds) {
		out.append('[');
		TimeFormat.appendClock(out, hour, minute, second, twelveHour, seconds);
		return out.append("] ");
	}

	/**
	 * Appends {@code segment} without legacy formatting codes (a section sign and the character
	 * after it, as the game itself skips them) or object placeholders.
	 */
	public static void appendPlain(StringBuilder out, String segment) {
		for (int i = 0; i < segment.length(); i++) {
			char c = segment.charAt(i);

			if (c == SECTION_SIGN) {
				i++;
			} else if (c != OBJECT_PLACEHOLDER) {
				out.append(c);
			}
		}
	}

	public static String plain(CharSequence text) {
		StringBuilder out = new StringBuilder(text.length());
		appendPlain(out, text.toString());
		return out.toString();
	}

	/** Whether there is anything visible, so blank spacer lines aren't stamped. */
	public static boolean hasText(CharSequence text) {
		return !text.toString().isBlank();
	}

	/** The first line, cut to {@code maxChars} with "..." when longer, never splitting a surrogate pair. */
	public static String preview(String text, int maxChars) {
		int newline = text.indexOf('\n');
		String first = newline >= 0 ? text.substring(0, newline) : text;

		if (first.length() <= maxChars && newline < 0) {
			return first;
		}

		int cut = Math.min(first.length(), maxChars);

		if (cut > 0 && Character.isHighSurrogate(first.charAt(cut - 1))) {
			cut--;
		}

		return first.substring(0, cut) + "...";
	}
}
