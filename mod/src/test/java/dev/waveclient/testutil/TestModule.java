package dev.waveclient.testutil;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import dev.waveclient.module.Category;
import dev.waveclient.module.Module;
import dev.waveclient.setting.BooleanSetting;
import dev.waveclient.setting.ColorSetting;
import dev.waveclient.setting.SliderSetting;

public class TestModule extends Module {
	public final BooleanSetting flag = add(new BooleanSetting("flag", "Flag", false));
	public final SliderSetting amount = add(new SliderSetting("amount", "Amount", 1.0, 0.0, 10.0, 0.5));
	public final ColorSetting color = add(new ColorSetting("color", "Color", 0xFFFFFFFF));

	public int enables;
	public int disables;
	public int ticks;
	public RuntimeException failOnEnable;
	public RuntimeException failOnTick;
	public int extra = -1;

	public TestModule(String id) {
		super(id, "Test " + id, "A module for tests.", Category.MISC);
	}

	public TestModule(String id, boolean enabledByDefault) {
		this(id);
		setDefaultEnabled(enabledByDefault);
	}

	@Override
	protected void onEnable() {
		enables++;

		if (failOnEnable != null) {
			throw failOnEnable;
		}
	}

	@Override
	protected void onDisable() {
		disables++;
	}

	@Override
	protected void onTick() {
		ticks++;

		if (failOnTick != null) {
			throw failOnTick;
		}
	}

	@Override
	protected void saveExtra(JsonObject moduleJson) {
		moduleJson.addProperty("extra", extra);
	}

	@Override
	protected void resetExtra() {
		extra = -1;
	}

	@Override
	protected void loadExtra(JsonObject moduleJson) {
		JsonElement value = moduleJson.get("extra");

		if (value != null) {
			extra = value.getAsInt();
		}
	}
}
