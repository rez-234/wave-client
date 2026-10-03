package dev.waveclient.util;

import java.util.function.LongSupplier;

/** Time between successive calls, from a nanosecond clock. */
public final class FrameClock {
	private final LongSupplier nanoTime;
	private long last;
	private boolean running;

	public FrameClock(LongSupplier nanoTime) {
		this.nanoTime = nanoTime;
	}

	/** @return seconds since the previous tick, or NaN for the first tick after creation or {@link #reset()} */
	public double tick() {
		long now = nanoTime.getAsLong();
		double seconds = running ? (now - last) / 1e9 : Double.NaN;
		last = now;
		running = true;
		return seconds;
	}

	public void reset() {
		running = false;
	}
}
