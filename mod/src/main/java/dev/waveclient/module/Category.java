package dev.waveclient.module;

public enum Category {
	HUD("HUD"),
	RENDER("Render"),
	CAMERA("Camera"),
	MOVEMENT("Movement"),
	CHAT("Chat"),
	MISC("Misc");

	private final String label;

	Category(String label) {
		this.label = label;
	}

	public String label() {
		return label;
	}
}
