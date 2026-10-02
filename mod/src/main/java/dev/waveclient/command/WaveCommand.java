package dev.waveclient.command;

import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.argument;
import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.literal;

import java.util.ArrayList;
import java.util.List;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.network.chat.Component;

import dev.waveclient.WaveClient;
import dev.waveclient.module.Module;
import dev.waveclient.module.SettingContainer;
import dev.waveclient.setting.Setting;

/**
 * {@code /wave}: inspect and change modules and settings from chat.
 *
 * <pre>
 * /wave list
 * /wave toggle &lt;module&gt;
 * /wave get &lt;module|client&gt;
 * /wave set &lt;module|client&gt; &lt;setting&gt; &lt;value&gt;
 * /wave reset &lt;module|client&gt;
 * /wave save | reload
 * </pre>
 */
public final class WaveCommand {
	private static final String CLIENT_TARGET = "client";
	private static final Component PREFIX = Component.literal("[Wave] ").withStyle(ChatFormatting.BLUE);

	private WaveCommand() {
	}

	public static void register(CommandDispatcher<FabricClientCommandSource> dispatcher, WaveClient wave) {
		SuggestionProvider<FabricClientCommandSource> moduleIds = (context, builder) ->
				SharedSuggestionProvider.suggest(moduleIds(wave), builder);
		SuggestionProvider<FabricClientCommandSource> targets = (context, builder) -> {
			List<String> ids = new ArrayList<>(moduleIds(wave));
			ids.add(CLIENT_TARGET);
			return SharedSuggestionProvider.suggest(ids, builder);
		};
		SuggestionProvider<FabricClientCommandSource> settingIds = (context, builder) -> {
			SettingContainer container;

			try {
				container = resolve(wave, StringArgumentType.getString(context, "target"));
			} catch (IllegalArgumentException e) {
				container = null;
			}

			if (container == null) {
				return builder.buildFuture();
			}

			return SharedSuggestionProvider.suggest(container.settings().stream().map(Setting::id).toList(), builder);
		};

		dispatcher.register(literal("wave")
				.executes(context -> help(context.getSource()))
				.then(literal("list").executes(context -> list(context.getSource(), wave)))
				.then(literal("toggle")
						.then(argument("module", StringArgumentType.word())
								.suggests(moduleIds)
								.executes(context -> toggle(context, wave))))
				.then(literal("get")
						.then(argument("target", StringArgumentType.word())
								.suggests(targets)
								.executes(context -> get(context, wave))))
				.then(literal("set")
						.then(argument("target", StringArgumentType.word())
								.suggests(targets)
								.then(argument("setting", StringArgumentType.word())
										.suggests(settingIds)
										.then(argument("value", StringArgumentType.greedyString())
												.executes(context -> set(context, wave))))))
				.then(literal("reset")
						.then(argument("target", StringArgumentType.word())
								.suggests(targets)
								.executes(context -> reset(context, wave))))
				.then(literal("save").executes(context -> save(context.getSource(), wave)))
				.then(literal("reload").executes(context -> reload(context.getSource(), wave))));
	}

	private static int help(FabricClientCommandSource source) {
		feedback(source, "Wave Client " + WaveClient.version()
				+ ". Commands: list, toggle <module>, get <target>, set <target> <setting> <value>, reset <target>, save, reload");
		return 1;
	}

	private static int list(FabricClientCommandSource source, WaveClient wave) {
		List<Module> modules = wave.modules().all();

		if (modules.isEmpty()) {
			feedback(source, "No modules registered.");
			return 1;
		}

		for (Module module : modules) {
			feedback(source, module.id() + " (" + module.category().label() + "): " + stateOf(module));
		}

		return 1;
	}

	private static int toggle(CommandContext<FabricClientCommandSource> context, WaveClient wave) {
		String id = StringArgumentType.getString(context, "module");
		Module module = wave.modules().byId(id);

		if (module == null) {
			return error(context.getSource(), "Unknown module: " + id);
		}

		module.toggle();
		feedback(context.getSource(), module.name() + ": " + stateOf(module));
		return 1;
	}

	private static int get(CommandContext<FabricClientCommandSource> context, WaveClient wave) {
		String target = StringArgumentType.getString(context, "target");
		SettingContainer container = resolve(wave, target);

		if (container == null) {
			return error(context.getSource(), "Unknown module: " + target);
		}

		if (container instanceof Module module) {
			feedback(context.getSource(), module.name() + ": " + stateOf(module));
		}

		for (Setting<?> setting : container.settings()) {
			feedback(context.getSource(), "  " + setting.id() + " = " + setting.displayValue());
		}

		return 1;
	}

	private static int set(CommandContext<FabricClientCommandSource> context, WaveClient wave) {
		String target = StringArgumentType.getString(context, "target");
		String settingId = StringArgumentType.getString(context, "setting");
		String value = StringArgumentType.getString(context, "value");
		SettingContainer container = resolve(wave, target);

		if (container == null) {
			return error(context.getSource(), "Unknown module: " + target);
		}

		Setting<?> setting = container.setting(settingId);

		if (setting == null) {
			return error(context.getSource(), "Unknown setting '" + settingId + "' for " + target);
		}

		if (!setting.parse(value)) {
			return error(context.getSource(), "Invalid value for " + settingId + ": " + value);
		}

		feedback(context.getSource(), target + "." + settingId + " = " + setting.displayValue());
		return 1;
	}

	private static int reset(CommandContext<FabricClientCommandSource> context, WaveClient wave) {
		String target = StringArgumentType.getString(context, "target");
		SettingContainer container = resolve(wave, target);

		if (container == null) {
			return error(context.getSource(), "Unknown module: " + target);
		}

		if (container instanceof Module module) {
			module.resetToDefaults();
		} else {
			container.resetSettings();
		}

		feedback(context.getSource(), "Reset " + target + " to defaults.");
		return 1;
	}

	private static int save(FabricClientCommandSource source, WaveClient wave) {
		wave.config().saveNow();
		feedback(source, "Saved " + wave.config().file());
		return 1;
	}

	private static int reload(FabricClientCommandSource source, WaveClient wave) {
		wave.config().load();
		feedback(source, "Reloaded " + wave.config().file());
		return 1;
	}

	private static SettingContainer resolve(WaveClient wave, String target) {
		return CLIENT_TARGET.equals(target) ? wave.clientSettings() : wave.modules().byId(target);
	}

	private static List<String> moduleIds(WaveClient wave) {
		return wave.modules().all().stream().map(Module::id).toList();
	}

	private static String stateOf(Module module) {
		if (module.isBlocked() && module.isEnabled()) {
			return "on, but unavailable here (" + module.blockedReason() + ")";
		}

		return module.isEnabled() ? "on" : "off";
	}

	private static void feedback(FabricClientCommandSource source, String message) {
		// Children inherit their parent's style, so the prefix is a sibling, not the parent.
		source.sendFeedback(Component.empty().append(PREFIX).append(Component.literal(message)));
	}

	private static int error(FabricClientCommandSource source, String message) {
		source.sendError(Component.literal(message));
		return 0;
	}
}
