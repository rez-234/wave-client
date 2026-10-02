package dev.waveclient.gui.widget;

/** Implemented by screens that can show a {@link Popover} next to a widget. */
public interface PopoverHost {
	/** Shows {@code popover} anchored to {@code anchor}, replacing any open popover. */
	void openPopover(Popover popover, Widget anchor);
}
