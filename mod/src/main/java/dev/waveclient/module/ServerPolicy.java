package dev.waveclient.module;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Which modules a server disallows. Rules match a domain and all of its subdomains,
 * so {@code hypixel.net} also covers {@code mc.hypixel.net}.
 */
public final class ServerPolicy {
	public record Rule(String domain, Set<String> moduleIds, String reason) {
		public Rule {
			domain = normalizeHost(Objects.requireNonNull(domain, "domain"));
			moduleIds = Set.copyOf(moduleIds);
			Objects.requireNonNull(reason, "reason");
		}
	}

	private final List<Rule> rules;

	public ServerPolicy(List<Rule> rules) {
		this.rules = List.copyOf(rules);
	}

	/** Rules shipped with the client. */
	public static ServerPolicy defaults() {
		return new ServerPolicy(List.of(
				new Rule("hypixel.net", Set.of("freelook"), "Hypixel does not allow freelook")
		));
	}

	public List<Rule> rules() {
		return rules;
	}

	/**
	 * @param address the address typed in the server list, e.g. {@code mc.hypixel.net:25565};
	 *                {@code null} for singleplayer
	 * @return module id to reason, for every module the server disallows
	 */
	public Map<String, String> blockedModules(String address) {
		if (address == null || address.isBlank()) {
			return Map.of();
		}

		String host = normalizeHost(address);
		Map<String, String> blocked = new HashMap<>();

		for (Rule rule : rules) {
			if (matches(host, rule.domain())) {
				for (String moduleId : rule.moduleIds()) {
					blocked.putIfAbsent(moduleId, rule.reason());
				}
			}
		}

		return Map.copyOf(blocked);
	}

	static boolean matches(String host, String domain) {
		return host.equals(domain) || host.endsWith("." + domain);
	}

	/** Lowercases and strips the port, IPv6 brackets and any trailing dot. */
	static String normalizeHost(String address) {
		String s = address.trim().toLowerCase(Locale.ROOT);

		if (s.startsWith("[")) {
			int end = s.indexOf(']');
			s = end > 0 ? s.substring(1, end) : s.substring(1);
		} else if (s.indexOf(':') == s.lastIndexOf(':') && s.indexOf(':') >= 0) {
			// Exactly one colon: host:port. More than one means a bare IPv6 address.
			s = s.substring(0, s.indexOf(':'));
		}

		while (s.endsWith(".")) {
			s = s.substring(0, s.length() - 1);
		}

		return s;
	}
}
