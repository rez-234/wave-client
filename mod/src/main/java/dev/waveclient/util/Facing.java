package dev.waveclient.util;

import java.util.Locale;

/**
 * The compass direction the player faces, from Minecraft's yaw: 0 is south (+Z), 90 west (-X),
 * 180 north (-Z) and 270 east (+X).
 */
public enum Facing {
	SOUTH("S", "+Z"),
	SOUTH_WEST("SW", "-X +Z"),
	WEST("W", "-X"),
	NORTH_WEST("NW", "-X -Z"),
	NORTH("N", "-Z"),
	NORTH_EAST("NE", "+X -Z"),
	EAST("E", "+X"),
	SOUTH_EAST("SE", "+X +Z");

	private static final Facing[] VALUES = values();

	private final String shortName;
	private final String axes;
	private final String longName;

	Facing(String shortName, String axes) {
		this.shortName = shortName;
		this.axes = axes;
		String lower = name().toLowerCase(Locale.ROOT).replace("_", "");
		this.longName = Character.toUpperCase(lower.charAt(0)) + lower.substring(1);
	}

	/** "N", "SW" and so on. */
	public String shortName() {
		return shortName;
	}

	/** "North", "Southwest" and so on. */
	public String longName() {
		return longName;
	}

	/** The coordinates that grow while walking this way, e.g. "-Z" for north. */
	public String axes() {
		return axes;
	}

	/** Yaw in degrees, wrapped to [0, 360). */
	public static double normalize(double yaw) {
		double wrapped = yaw % 360;
		return wrapped < 0 ? wrapped + 360 : wrapped;
	}

	/**
	 * @param intercardinal whether to use eight directions (N, NE, E...) rather than four
	 */
	public static Facing of(double yaw, boolean intercardinal) {
		double normalized = normalize(yaw);

		if (intercardinal) {
			return VALUES[(int) Math.round(normalized / 45) % 8];
		}

		return VALUES[((int) Math.round(normalized / 90) % 4) * 2];
	}
}
