package dev.waveclient.util;

/**
 * Counts clicks in the last second, for a CPS display. Keeps the timestamps in a fixed ring
 * buffer, so counting a click never allocates.
 */
public final class ClickCounter {
	public static final long WINDOW_MS = 1000;

	private final long[] times;
	private int head;
	private int size;

	/** @param capacity the most clicks remembered at once; more than any human can do in a second */
	public ClickCounter(int capacity) {
		if (capacity < 1) {
			throw new IllegalArgumentException("capacity must be positive");
		}

		this.times = new long[capacity];
	}

	public ClickCounter() {
		this(64);
	}

	/** Records a click at {@code nowMs} (a monotonic clock, such as {@code Util.getMillis()}). */
	public void click(long nowMs) {
		expire(nowMs);

		if (size == times.length) {
			// Full: the oldest click makes room. Only reachable with a broken input device.
			head = (head + 1) % times.length;
			size--;
		}

		times[(head + size) % times.length] = nowMs;
		size++;
	}

	/** Clicks within the last second before {@code nowMs}. */
	public int count(long nowMs) {
		expire(nowMs);
		return size;
	}

	public void reset() {
		head = 0;
		size = 0;
	}

	private void expire(long nowMs) {
		while (size > 0 && nowMs - times[head] >= WINDOW_MS) {
			head = (head + 1) % times.length;
			size--;
		}
	}
}
