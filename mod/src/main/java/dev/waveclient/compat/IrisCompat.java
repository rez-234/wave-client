package dev.waveclient.compat;

import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;

import net.fabricmc.loader.api.FabricLoader;

import dev.waveclient.WaveClient;

/**
 * Asks Iris, if it is installed, whether a shader pack is in use. Uses Iris's public API by
 * reflection, so Wave Client neither needs Iris to build nor to run.
 */
public final class IrisCompat {
	private static final MethodHandle IS_SHADER_PACK_IN_USE = find();
	private static boolean broken;

	private IrisCompat() {
	}

	private static MethodHandle find() {
		if (!FabricLoader.getInstance().isModLoaded("iris")) {
			return null;
		}

		try {
			Class<?> api = Class.forName("net.irisshaders.iris.api.v0.IrisApi", true, IrisCompat.class.getClassLoader());
			Object instance = api.getMethod("getInstance").invoke(null);
			return MethodHandles.publicLookup().findVirtual(api, "isShaderPackInUse", MethodType.methodType(boolean.class)).bindTo(instance);
		} catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
			WaveClient.LOGGER.warn("Couldn't use Iris's API; effects that turn off with shader packs will stay on", e);
			return null;
		}
	}

	/** Whether Iris is installed and rendering with a shader pack. Cheap enough to call every frame. */
	public static boolean isShaderPackInUse() {
		MethodHandle handle = IS_SHADER_PACK_IN_USE;

		if (handle == null || broken) {
			return false;
		}

		try {
			return (boolean) handle.invokeExact();
		} catch (Throwable t) {
			broken = true;
			WaveClient.LOGGER.warn("Iris's API failed; effects that turn off with shader packs will stay on", t);
			return false;
		}
	}
}
