package app.memoria.tracker;

import org.junit.Test;
import static org.junit.Assert.*;

public class ScreenshotImportPluginTest {
    @Test
    public void normalPhoneScreenshotsKeepFullResolution() {
        assertEquals(1, ScreenshotImportPlugin.imageSampleSize(1080, 2400));
        assertEquals(1, ScreenshotImportPlugin.imageSampleSize(1440, 3200));
    }

    @Test
    public void largeScreenshotsAreBoundedBeforeBitmapAllocation() {
        assertEquals(2, ScreenshotImportPlugin.imageSampleSize(7680, 4320));
        assertEquals(8, ScreenshotImportPlugin.imageSampleSize(1000, 20000));
        assertEquals(2, ScreenshotImportPlugin.imageSampleSize(4000, 4000));
    }

    @Test
    public void impossibleDimensionsAreRejectedBeforeSampling() {
        for (int[] size : new int[][] { { 0, 400 }, { 400, -1 }, { 10000, 10000 }, { Integer.MAX_VALUE, Integer.MAX_VALUE } }) {
            try {
                ScreenshotImportPlugin.imageSampleSize(size[0], size[1]);
                fail("Invalid image must be rejected.");
            } catch (IllegalArgumentException expected) { /* expected */ }
        }
    }
}
