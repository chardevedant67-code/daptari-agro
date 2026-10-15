package com.paddle.ocr.sevenseg

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.paddle.ocr.util.OpenCVUtils
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.BeforeClass
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Parity test: runs the Kotlin decoder on the fixture images and checks every result
 * equals what the validated Python prototype (ssd.py) produced on the same file.
 *
 * Fixtures live in <project>/test-fixtures/seven-segment and are pushed to the phone with:
 *   adb push test-fixtures/seven-segment /data/local/tmp/ssd_fixtures
 */
@RunWith(AndroidJUnit4::class)
class SevenSegmentDecoderTest {

  companion object {
    private const val TAG = "SevenSegTest"
    private val dir = File("/data/local/tmp/ssd_fixtures")

    @JvmStatic
    @BeforeClass
    fun setUp() {
      assertTrue("OpenCV failed to load", OpenCVUtils.init(InstrumentationRegistry.getInstrumentation().targetContext))
      assertTrue("fixtures missing at $dir (adb push them first)", File(dir, "manifest.tsv").exists())
    }
  }

  private data class Case(val file: String, val python: String, val truth: String)

  private fun cases() =
      File(dir, "manifest.tsv").readLines().filter { it.isNotBlank() && !it.startsWith("#") }.map {
        val p = it.split("\t")
        Case(p[0], p[1], p.getOrElse(2) { "" })
      }

  private fun show(r: SevenSegmentDecoder.Result) = if (r.ok) r.text!! else "REJECT:${r.reason}"

  @Test
  fun realImagesDecodeToWeight() {
    val real = cases().filter { it.file.startsWith("real/") }
    assertEquals(5, real.size)
    for (c in real) {
      val t0 = System.currentTimeMillis()
      val r = SevenSegmentDecoder.decodeFile(File(dir, c.file).path)
      Log.i(TAG, "REAL ${c.file}: kotlin=${show(r)} python=${c.python} segs=${r.segs} shear=${r.shear} angle=${r.angle} ${System.currentTimeMillis() - t0}ms ${r.detail ?: ""}")
      assertEquals("real image ${c.file}", "500.0", show(r))
    }
  }

  @Test
  fun kotlinMatchesPythonOnEveryFixture() {
    var same = 0
    val diffs = ArrayList<String>()
    var wrong = 0
    for (c in cases()) {
      val r = SevenSegmentDecoder.decodeFile(File(dir, c.file).path)
      val k = show(r)
      Log.i(TAG, "PARITY ${c.file}: kotlin=$k python=${c.python} truth=${c.truth} ${r.detail ?: ""}")
      if (k == c.python) same++ else diffs.add("${c.file}: kotlin=$k python=${c.python}")
      // safety: a decoded value must never differ from the true value
      if (r.ok && c.truth.isNotEmpty() && r.text != c.truth) wrong++
    }
    Log.i(TAG, "PARITY SUMMARY same=$same total=${cases().size} diffs=${diffs.size} wrongValues=$wrong")
    diffs.forEach { Log.i(TAG, "DIFF $it") }
    assertEquals("decoded values that differ from the true value", 0, wrong)
    assertTrue("Kotlin differs from Python on: $diffs", diffs.isEmpty())
  }

  private fun liveShow(file: String): String {
    val bmp = android.graphics.BitmapFactory.decodeFile(File(dir, file).path)
    assertTrue("cannot decode $file", bmp != null)
    val t0 = System.currentTimeMillis()
    val r = SevenSegmentDecoder.decodeLive(bmp!!)
    Log.i(TAG, "LIVE $file: ${show(r)} kind=${r.kind} ${System.currentTimeMillis() - t0}ms ${r.detail ?: ""}")
    bmp.recycle()
    return if (r.ok) r.text!! else "REJECT"
  }

  /**
   * The live-camera reader (decodeLive: fast LCD path, then lit digits on a dark panel) on
   * the LED frames in led_manifest.tsv - real frames from the phone, at the size the live
   * reader works at. Each must come out exactly as the prototype read it. For a refused
   * image only the refusal is compared.
   */
  @Test
  fun liveReaderReadsLedFrames() {
    val led = File(dir, "led_manifest.tsv").readLines().filter { it.isNotBlank() && !it.startsWith("#") }
    assertEquals(8, led.size)
    val diffs = ArrayList<String>()
    for (line in led) {
      val p = line.split("	")
      val got = liveShow(p[0])
      if (got != p[1]) diffs.add("${p[0]}: live=$got expected=${p[1]}")
    }
    Log.i(TAG, "LIVE LED SUMMARY total=${led.size} diffs=${diffs.size} $diffs")
    assertTrue("live reader differs from the prototype on: $diffs", diffs.isEmpty())
  }

  /**
   * Display location: every image the live reader reads must also say where the display
   * window is (inside the image), and on the whole-photo fixtures the candidate finder
   * must offer the LCD first, as a region well inside the photo.
   */
  @Test
  fun displayWindowIsLocated() {
    val problems = ArrayList<String>()
    for (c in cases().filter { !it.python.startsWith("REJECT") }) {
      val bmp = android.graphics.BitmapFactory.decodeFile(File(dir, c.file).path)!!
      val r = SevenSegmentDecoder.decodeLive(bmp)
      bmp.recycle()
      val b = r.box
      Log.i(TAG, "BOX ${c.file}: ${show(r)} box=$b")
      if (!r.ok) continue
      if (b == null || b.size != 4 || b.any { it < 0.0 || it > 1.0 } || b[0] + b[2] > 1.0001 || b[1] + b[3] > 1.0001 || b[2] <= 0.0 || b[3] <= 0.0) {
        problems.add("${c.file}: box=$b")
      }
    }
    for (file in listOf("real/full_photo_1.jpg", "real/full_photo_2_moire.jpg")) {
      val bmp = android.graphics.BitmapFactory.decodeFile(File(dir, file).path)!!
      val cs = SevenSegmentDecoder.locateCandidates(bmp)
      bmp.recycle()
      Log.i(TAG, "CANDIDATES $file: $cs")
      val first = cs.firstOrNull()
      if (first == null || first.kind != "lcd" || first.w > 0.6 || first.h > 0.4) problems.add("$file: first candidate $first")
    }
    assertTrue("display location problems: $problems", problems.isEmpty())
  }

  /** The live reader must read every LCD fixture exactly as the validated reader does. */
  @Test
  fun liveReaderMatchesLcdFixtures() {
    val diffs = ArrayList<String>()
    for (c in cases()) {
      val expected = if (c.python.startsWith("REJECT")) "REJECT" else c.python
      val got = liveShow(c.file)
      if (got != expected) diffs.add("${c.file}: live=$got expected=$expected")
    }
    Log.i(TAG, "LIVE LCD SUMMARY total=${cases().size} diffs=${diffs.size} $diffs")
    assertTrue("live reader differs from the validated reader on: $diffs", diffs.isEmpty())
  }
}
