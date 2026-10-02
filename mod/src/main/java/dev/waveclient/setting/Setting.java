package dev.waveclient.setting;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.BooleanSupplier;
import java.util.regex.Pattern;

import com.google.gson.JsonElement;

/**
 * A single user-configurable value owned by a module or by the client itself.
 *
 * <p>Subclasses expose typed, primitive getters so reading a setting on the render path never
 * allocates. Invalid input (from JSON, commands or the GUI) is clamped or ignored, never thrown.
 *
 * @param <S> the concrete setting type, so fluent methods return it
 */
public abstract sealed class Setting<S extends Setting<S>>
		permits BooleanSetting, SliderSetting, ColorSetting, KeybindSetting, EnumSetting {
	private static final Pattern ID_PATTERN = Pattern.compile("[a-zA-Z][a-zA-Z0-9_]*");
	private static final BooleanSupplier ALWAYS_VISIBLE = () -> true;

	private final String id;
	private final String name;
	private String description = "";
	private BooleanSupplier visibility = ALWAYS_VISIBLE;
	private final List<Runnable> listeners = new ArrayList<>(1);

	protected Setting(String id, String name) {
		if (!ID_PATTERN.matcher(Objects.requireNonNull(id, "id")).matches()) {
			throw new IllegalArgumentException("Invalid setting id: " + id);
		}

		this.id = id;
		this.name = Objects.requireNonNull(name, "name");
	}

	/** Stable identifier used as the JSON key. Never change it once released. */
	public final String id() {
		return id;
	}

	public final String name() {
		return name;
	}

	public final String description() {
		return description;
	}

	public final S describe(String description) {
		this.description = Objects.requireNonNull(description, "description");
		return self();
	}

	/** Hides the setting in the GUI unless the predicate holds (e.g. only show when a parent toggle is on). */
	public final S visibleWhen(BooleanSupplier predicate) {
		this.visibility = Objects.requireNonNull(predicate, "predicate");
		return self();
	}

	public final boolean isVisible() {
		return visibility.getAsBoolean();
	}

	/** Registers a callback that runs after the value changes. */
	public final S onChange(Runnable listener) {
		listeners.add(Objects.requireNonNull(listener, "listener"));
		return self();
	}

	public abstract void reset();

	public abstract boolean isDefault();

	public abstract JsonElement toJson();

	/** Reads a value written by {@link #toJson()}. Values of the wrong type or shape are ignored. */
	public abstract void fromJson(JsonElement json);

	/**
	 * Parses user input, e.g. from the {@code /wave set} command.
	 *
	 * @return {@code false} if the input was not understood; the value is then unchanged
	 */
	public abstract boolean parse(String input);

	/** Human-readable current value. Not for use on the render path. */
	public abstract String displayValue();

	protected final void changed() {
		for (int i = 0; i < listeners.size(); i++) {
			listeners.get(i).run();
		}
	}

	@SuppressWarnings("unchecked")
	protected final S self() {
		return (S) this;
	}

	@Override
	public String toString() {
		return getClass().getSimpleName() + "[" + id + "=" + displayValue() + "]";
	}
}
