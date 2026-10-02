package dev.waveclient.module;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

class ServerPolicyTest {
	private final ServerPolicy policy = ServerPolicy.defaults();

	@Test
	void hypixelBlocksFreelookOnAnyAddressForm() {
		for (String address : List.of("hypixel.net", "mc.hypixel.net", "MC.Hypixel.NET:25565", "hypixel.net.", " stuck.hypixel.net ")) {
			assertEquals(Set.of("freelook"), policy.blockedModules(address).keySet(), address);
		}
	}

	@Test
	void otherServersAreUnrestricted() {
		for (String address : List.of("nothypixel.net", "hypixel.net.evil.com", "localhost", "127.0.0.1:25565", "[::1]:25565", "")) {
			assertTrue(policy.blockedModules(address).isEmpty(), address);
		}

		assertTrue(policy.blockedModules(null).isEmpty());
	}

	@Test
	void normalizeHost() {
		assertEquals("mc.example.com", ServerPolicy.normalizeHost("MC.Example.com:25565"));
		assertEquals("::1", ServerPolicy.normalizeHost("[::1]:25565"));
		assertEquals("2001:db8::1", ServerPolicy.normalizeHost("2001:db8::1"));
		assertEquals("example.com", ServerPolicy.normalizeHost("example.com.."));
	}

	@Test
	void firstMatchingRuleProvidesTheReason() {
		ServerPolicy custom = new ServerPolicy(List.of(
				new ServerPolicy.Rule("Example.com", Set.of("freelook", "zoom"), "first"),
				new ServerPolicy.Rule("play.example.com", Set.of("zoom", "fullbright"), "second")));

		Map<String, String> blocked = custom.blockedModules("play.example.com");
		assertEquals(Map.of("freelook", "first", "zoom", "first", "fullbright", "second"), blocked);
		assertFalse(custom.blockedModules("example.org").containsKey("zoom"));
	}
}
