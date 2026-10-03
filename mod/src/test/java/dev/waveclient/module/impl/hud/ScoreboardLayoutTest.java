package dev.waveclient.module.impl.hud;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Comparator;
import java.util.Random;

import org.junit.jupiter.api.Test;

class ScoreboardLayoutTest {
	@Test
	void matchesVanillaForAnySidebar() {
		Random random = new Random(1);
		int spacer = 6;

		for (int round = 0; round < 2000; round++) {
			int guiWidth = 200 + random.nextInt(600);
			int guiHeight = 150 + random.nextInt(400);
			int rows = random.nextInt(16);
			int titleWidth = random.nextInt(120);
			int[] nameWidths = new int[rows];
			int[] scoreWidths = new int[rows];

			for (int i = 0; i < rows; i++) {
				nameWidths[i] = random.nextInt(150);
				scoreWidths[i] = random.nextBoolean() ? 0 : random.nextInt(30);
			}

			// Gui.displayScoreboardSidebar, in screen coordinates.
			int j = titleWidth;

			for (int i = 0; i < rows; i++) {
				j = Math.max(j, nameWidths[i] + (scoreWidths[i] > 0 ? spacer + scoreWidths[i] : 0));
			}

			int bottom = guiHeight / 2 + rows * 9 / 3;
			int textLeft = guiWidth - j - 3;
			int right = guiWidth - 3 + 2;
			int firstRow = bottom - rows * 9;
			int left = textLeft - 2;
			int top = firstRow - 9 - 1;

			int content = ScoreboardLayout.contentWidth(titleWidth, nameWidths, scoreWidths, rows, spacer);
			assertEquals(j, content);
			assertEquals(right - left, ScoreboardLayout.width(content));
			assertEquals(bottom - top, ScoreboardLayout.height(rows));
			assertEquals(firstRow - 1 - top, ScoreboardLayout.TITLE_BAND - 1);
			assertEquals(textLeft + j / 2 - titleWidth / 2 - left, ScoreboardLayout.titleX(content, titleWidth));
			assertEquals(firstRow - 9 - top, ScoreboardLayout.TITLE_Y);

			for (int row = 0; row < rows; row++) {
				assertEquals(bottom - (rows - row) * 9 - top, ScoreboardLayout.rowY(row));
				assertEquals(textLeft - left, ScoreboardLayout.PAD);
				assertEquals(right - scoreWidths[row] - left, ScoreboardLayout.scoreX(content, scoreWidths[row]));
			}
		}
	}

	@Test
	void backgroundAlphas() {
		// Vanilla's default: 0.3 body, 0.4 title band.
		assertEquals(76, ScoreboardLayout.bodyAlpha(0.3));
		assertEquals(102, ScoreboardLayout.titleAlpha(0.3));
		assertEquals(0, ScoreboardLayout.bodyAlpha(0));
		assertEquals(0, ScoreboardLayout.titleAlpha(0), "no background means no title band either");
		assertEquals(255, ScoreboardLayout.bodyAlpha(1));
		assertEquals(255, ScoreboardLayout.titleAlpha(1));
	}

	private record Entry(int value, String owner) {
	}

	@Test
	void sortsLikeVanilla() {
		Comparator<Entry> vanilla = Comparator.comparing(Entry::value).reversed().thenComparing(Entry::owner, String.CASE_INSENSITIVE_ORDER);
		String[] owners = {"a", "B", "b", "§a", "Zed", "zed", "#hidden", ""};
		Random random = new Random(2);

		for (int i = 0; i < 5000; i++) {
			Entry x = new Entry(random.nextInt(5) - 2, owners[random.nextInt(owners.length)]);
			Entry y = new Entry(random.nextInt(5) - 2, owners[random.nextInt(owners.length)]);
			assertEquals(Integer.signum(vanilla.compare(x, y)), Integer.signum(ScoreboardLayout.compare(x.value(), x.owner(), y.value(), y.owner())));
		}
	}
}
