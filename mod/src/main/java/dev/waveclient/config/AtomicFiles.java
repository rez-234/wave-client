package dev.waveclient.config;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;

final class AtomicFiles {
	private AtomicFiles() {
	}

	/**
	 * Writes to a temporary file in the same directory, flushes it to disk, then moves it over the
	 * target. A crash mid-write leaves the previous file intact instead of a truncated one.
	 */
	static void writeString(Path target, String content) throws IOException {
		Path parent = target.toAbsolutePath().getParent();
		Files.createDirectories(parent);
		Path temp = parent.resolve(target.getFileName() + ".tmp");
		ByteBuffer bytes = ByteBuffer.wrap(content.getBytes(StandardCharsets.UTF_8));

		try (FileChannel channel = FileChannel.open(temp, StandardOpenOption.CREATE, StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING)) {
			while (bytes.hasRemaining()) {
				channel.write(bytes);
			}

			channel.force(true);
		}

		try {
			Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
		} catch (AtomicMoveNotSupportedException e) {
			Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
		}
	}
}
