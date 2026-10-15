package com.paddle.ocr.sevenseg

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import com.paddle.ocr.util.BitmapUtils
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfInt
import org.opencv.core.MatOfPoint
import org.opencv.core.MatOfPoint2f
import org.opencv.core.Point
import org.opencv.core.Rect
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * Seven-segment LCD weight-display decoder. Line-by-line port of the validated Python
 * prototype (ssd.py): find the cyan LCD, straighten it, isolate the dark digit ink,
 * correct italic shear, split into digit cells, read each digit from its 7 segments
 * and find the decimal point.
 *
 * [decodeLive] is the variant for the live camera: the same LCD reader with a cheaper
 * background estimate, followed - when no LCD is found - by a reader for lit digits on a
 * dark panel (LED / VFD displays), then one for over-exposed LED digits found by their own
 * glow (decodeGlow). All feed the same digit reader below.
 *
 * Safety rule (same as the prototype): NEVER guess. Any unmatched / ambiguous segment
 * pattern, unexplained ink, blank or low-contrast display rejects the whole reading.
 * A reading is only a suggestion for the user to confirm; it is never saved here.
 */
object SevenSegmentDecoder {

  data class Result(
      val ok: Boolean,
      val text: String?,
      val reason: String?,
      val detail: String? = null,
      val segs: List<String> = emptyList(),
      val shear: Double = 0.0,
      val angle: Double = 0.0,
      /** "lcd" (dark ink on the cyan LCD), "led" (lit digits on a dark panel) or "light" (dark ink on any other light panel). */
      val kind: String = "lcd",
      /** Digit height in the 480-row working image. */
      val hd: Int = 0,
      /**
       * Where the display window was found: x, y, width, height as fractions (0..1) of the
       * image that was handed in. Set on a refusal too, whenever a window was found at all;
       * null when none was.
       */
      val box: List<Double>? = null,
      /** The digit cells (x, y, width, height) and the top of the digit row, in the de-slanted working image. */
      val cells: List<IntArray> = emptyList(),
      val top: Int = 0,
  )

  /** A region of a photo that may be a display window (see [locateCandidates]). */
  data class Candidate(val kind: String, val x: Double, val y: Double, val w: Double, val h: Double, val score: Double)

  private fun rej(reason: String, detail: String? = null) = Result(false, null, reason, detail)

  // segments: a top, b upper-right, c lower-right, d bottom, e lower-left, f upper-left, g middle
  private val TABLE =
      mapOf(
          "abcdef" to "0", "bc" to "1", "abdeg" to "2", "abcdg" to "3", "bcfg" to "4",
          "acdfg" to "5", "acdefg" to "6", "abc" to "7", "abcdefg" to "8", "abcdfg" to "9")

  // segment sample boxes as fractions (x0, x1, y0, y1) of the digit box (same order as ssd.py)
  private val SEG =
      linkedMapOf(
          'a' to doubleArrayOf(0.20, 0.80, 0.00, 0.14),
          'g' to doubleArrayOf(0.20, 0.80, 0.43, 0.57),
          'd' to doubleArrayOf(0.20, 0.80, 0.86, 1.00),
          'f' to doubleArrayOf(0.00, 0.22, 0.08, 0.46),
          'b' to doubleArrayOf(0.78, 1.00, 0.08, 0.46),
          'e' to doubleArrayOf(0.00, 0.22, 0.54, 0.92),
          'c' to doubleArrayOf(0.78, 1.00, 0.54, 0.92))
  private const val ON = 0.50 // ink fraction: >= ON lit, <= OFF dark, in between = ambiguous
  private const val OFF = 0.22
  // LED digits are thin strokes, so their segments are judged by how much of the segment's
  // LENGTH is lit instead of how much of its box is filled.
  private const val COV_ON = 0.60
  private const val COV_OFF = 0.30
  // Edge softness (lit->dark transition width / digit height) above which a decimal point
  // could have run into the digit beside it - and with it a factor of ten.
  private const val SOFT_MAX = 0.040
  // LED reader: smoothing before thresholding, as a share of the 480-row working height.
  private const val LED_BLUR = 0.002
  // Dark digits on a non-cyan light panel: likewise (the cyan LCD path stays at 0.012).
  private const val LIGHT_BLUR = 0.004
  // Reflection check: a blown-out (value >= GLARE_V), colourless (saturation < GLARE_S) blob
  // whose largest inscribed circle has a radius of GLARE_SIZE panel-heights or more.
  private const val GLARE_V = 250.0
  private const val GLARE_S = 60.0
  private const val GLARE_SIZE = 0.04
  // Over-exposed LED digits (decodeGlow). Measured on a photo of a physical red LED scale:
  // lit strokes come out white (weakest channel 217-255) inside a glow where red leads the
  // other channels by 100 or more; unlit segments are grey (weakest channel up to ~200
  // where they catch the light, no glow around them).
  private const val GLOW_CORE = 170.0 // weakest colour channel of a burnt-out stroke, at least
  private const val GLOW_EXCESS = 60.0 // lead of the strongest channel in the glow, at least
  // Weakest channel of something truly burnt out (a stroke, the point, a reflection); unlit
  // segments catching the light stayed at 171-199.
  private const val GLOW_BRIGHT = 230.0
  // Strongest channel of a lit stroke: saturated. Grey unlit segments never reach it, even
  // inside the red bloom a live camera frame spreads over its neighbours (max 220-236 on the
  // phone's frames, where their weakest channel overlapped the lit strokes' at 195-233).
  private const val GLOW_SAT = 245.0
  // A blob on an unlit segment: bright where the bloom of a lit neighbour falls on it, and
  // surrounded by the rest of that grey segment instead of by glow. Share of its surroundings
  // that is grey (weakest channel >= GLOW_GREY, no glow), at least: such spots measured
  // 0.33-1.00 on the phone's live frames, lit strokes and points 0.05-0.22 there and on the
  // physical photo. They are ignored, but only outside the digits being read.
  private const val GLOW_RING_GREY = 0.28
  private const val GLOW_GREY = 140.0
  private const val GLOW_RING_LIT = 0.60 // share of a blob's surroundings that is glow: a lit stroke
  private const val GLOW_RING_NOT = 0.20 // ... at most this much: plainly something else
  private const val GLOW_RING = 0.015 // width of the surroundings looked at, as a share of GLOW_H
  private const val GLOW_MIN_DIGIT_PX = 30 // digits lower than this in the picture are too small
  private const val GLOW_H = 480 // working height; the digits fill half of it
  private const val GLOW_PAD_X = 1.0 // room taken left and right of the digits, in digit heights
  // ... of which this much must be inside the picture: a digit hidden beyond the edge (even
  // a 1, which sits at the far side of its cell) would reach into it.
  private const val GLOW_ROOM_X = 0.9
  private const val GLOW_MAX_ROW = 9.0 // longest row of digits, in digit heights (8 digits and their gaps)
  private const val GLOW_MAX_BLOBS = 4000
  // LED strokes all have one thickness. Lit ink this many times thicker than the strokes
  // is a reflection that has run into a digit (the photo's own strokes and point: 1.4).
  private const val GLOW_FAT = 1.7

  private data class Comp(val x: Int, val y: Int, val w: Int, val h: Int, val a: Int)

  /** Decodes an image file: EXIF-rotated, long side bounded to ~4096 (like ScaleImageModule). */
  fun decodeFile(path: String): Result {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / sample > 4096) sample *= 2
    var bmp =
        BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: return rej("cannot-decode-image")
    val m = Matrix()
    when (ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
      ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
    }
    if (!m.isIdentity) bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    val mat = BitmapUtils.bitmapToBGRMat(bmp)
    bmp.recycle()
    return try {
      decode(mat)
    } finally {
      mat.release()
    }
  }

  /** `bgr` must be an 8-bit 3-channel BGR image. The caller keeps ownership of it. */
  fun decode(bgr: Mat): Result {
    val scratch = ArrayList<Mat>()
    fun <T : Mat> T.keep(): T {
      scratch.add(this)
      return this
    }
    try {
      return decodeImpl(bgr, false) { it.keep() }
    } finally {
      scratch.forEach { it.release() }
    }
  }

  /**
   * Live-camera variant: the LCD reader (background estimated at quarter resolution, which
   * gives the same result on every fixture at a fraction of the cost), then the LED reader.
   * Same safety rule - a frame that cannot be read with certainty is rejected.
   */
  fun decodeLive(bitmap: Bitmap): Result {
    // Utils.bitmapToMat only takes ARGB_8888; the caller keeps ownership of `bitmap`.
    val argb = if (bitmap.config == Bitmap.Config.ARGB_8888) bitmap else bitmap.copy(Bitmap.Config.ARGB_8888, false)
    val mat = BitmapUtils.bitmapToBGRMat(argb)
    if (argb !== bitmap) argb.recycle()
    return try {
      decodeLive(mat)
    } finally {
      mat.release()
    }
  }

  /** `bgr` must be an 8-bit 3-channel BGR image. The caller keeps ownership of it. */
  fun decodeLive(bgr: Mat): Result {
    val scratch = ArrayList<Mat>()
    fun <T : Mat> T.keep(): T {
      scratch.add(this)
      return this
    }
    try {
      val lcd = decodeImpl(bgr, true) { it.keep() }
      if (lcd.ok) return lcd
      // Over-exposed LED digits with unlit segments showing (a real LED scale): found by the
      // lit strokes themselves. Tried before the dark-panel LED reader, which costs several
      // times as much and cannot read burnt-out digits anyway. Once it has found a row of lit
      // digits its verdict stands - a refusal of that row is not handed on for another
      // reader to guess at.
      val glow = decodeGlow(bgr) { it.keep() }
      if (glow.ok) return glow
      if (glow.box != null) return glow.copy(detail = "lcd=${lcd.reason} ${glow.detail ?: ""}".trim())
      val led = decodeLed(bgr) { it.keep() }
      if (led.ok) return led
      // Dark digits on a light panel of any other colour (grey, green, yellow, white
      // backlight): the LCD reader again, on whatever light window sits mid-frame.
      val panel = findLightPanel(bgr) { it.keep() }
      val light = if (panel != null) decodeImpl(bgr, true, panel) { it.keep() } else null
      if (light != null && light.ok) return light.copy(kind = "light")
      return led.copy(
          detail = "lcd=${lcd.reason} light=${light?.reason ?: "no-light-panel"} ${led.detail ?: ""}".trim(),
          box = lcd.box ?: led.box ?: light?.box)
    } finally {
      scratch.forEach { it.release() }
    }
  }

  private fun findLcd(bgr: Mat, keep: (Mat) -> Mat): MatOfPoint? {
    val h = bgr.rows()
    val w = bgr.cols()
    val hsv = keep(Mat())
    Imgproc.cvtColor(bgr, hsv, Imgproc.COLOR_BGR2HSV)
    // hue 79..99, sat 41..134, value >= 141  (== ssd.py: >78 <100, >40 <135, >140)
    val m = keep(Mat())
    Core.inRange(hsv, Scalar(79.0, 41.0, 141.0), Scalar(99.0, 134.0, 255.0), m)
    val k = max(3, (min(h, w) * 0.004).toInt())
    val m2 = keep(Mat())
    Imgproc.morphologyEx(m, m2, Imgproc.MORPH_CLOSE, keep(Mat.ones(k * 2 + 1, k * 2 + 1, CvType.CV_8U)))
    val ko = max(3, (min(h, w) * 0.01).toInt()) // cut thin bridges to neighbouring cyan-ish areas
    val m3 = keep(Mat())
    Imgproc.morphologyEx(m2, m3, Imgproc.MORPH_OPEN, keep(Mat.ones(ko * 2 + 1, ko * 2 + 1, CvType.CV_8U)))
    val cs = ArrayList<MatOfPoint>()
    Imgproc.findContours(m3, cs, keep(Mat()), Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE)
    if (cs.isEmpty()) return null
    val c = cs.maxByOrNull { Imgproc.contourArea(it) }!!
    if (Imgproc.contourArea(c) < 0.01 * h * w) return null
    return c
  }

  /**
   * A light display window of any colour: the bright region around the middle of the
   * frame, which is where the user was asked to put the display.
   */
  private fun findLightPanel(bgr: Mat, keep: (Mat) -> Mat): MatOfPoint? {
    val h = bgr.rows()
    val w = bgr.cols()
    val gray = keep(Mat())
    Imgproc.cvtColor(bgr, gray, Imgproc.COLOR_BGR2GRAY)
    val g = keep(Mat())
    Imgproc.GaussianBlur(gray, g, Size(0.0, 0.0), max(1.0, 0.004 * min(h, w)))
    val bright = keep(Mat())
    Imgproc.threshold(g, bright, 0.0, 255.0, Imgproc.THRESH_BINARY + Imgproc.THRESH_OTSU)
    // dark digits are holes in the light panel: close them so the panel is one blob
    val k = max(3, (min(h, w) * 0.06).toInt()) or 1
    val filled = keep(Mat())
    Imgproc.morphologyEx(bright, filled, Imgproc.MORPH_CLOSE, keep(Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(k.toDouble(), k.toDouble()))))
    val ko = max(3, (min(h, w) * 0.02).toInt()) or 1
    val opened = keep(Mat())
    Imgproc.morphologyEx(filled, opened, Imgproc.MORPH_OPEN, keep(Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(ko.toDouble(), ko.toDouble()))))
    val cs = ArrayList<MatOfPoint>()
    Imgproc.findContours(opened, cs, keep(Mat()), Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE)
    val centre = Point(w / 2.0, h / 2.0)
    return cs
        .filter { Imgproc.contourArea(it) >= 0.05 * h * w }
        .filter { Imgproc.pointPolygonTest(MatOfPoint2f(*it.toArray()), centre, false) >= 0 }
        .maxByOrNull { Imgproc.contourArea(it) }
  }

  private fun boxOf(c: MatOfPoint, bgr: Mat): List<Double> {
    val bb = Imgproc.boundingRect(c)
    val w = bgr.cols().toDouble()
    val h = bgr.rows().toDouble()
    return listOf(bb.x / w, bb.y / h, bb.width / w, bb.height / h)
  }

  private fun decodeImpl(bgr: Mat, fast: Boolean, panel: MatOfPoint? = null, keep: (Mat) -> Mat): Result {
    val c = panel ?: findLcd(bgr, keep) ?: return rej("no-lcd")
    return decodePanel(bgr, fast, panel, c, keep).copy(box = boxOf(c, bgr))
  }

  private fun decodePanel(bgr: Mat, fast: Boolean, panel: MatOfPoint?, c: MatOfPoint, keep: (Mat) -> Mat): Result {
    if (fast || panel != null) {
      val glare = glareSize(bgr, c, 0.0, keep)
      if (glare >= GLARE_SIZE) return rej("glare", "size=${"%.3f".format(glare)}")
    }
    val rect = Imgproc.minAreaRect(MatOfPoint2f(*c.toArray()))
    var rw = rect.size.width
    var rh = rect.size.height
    var ang = rect.angle
    if (rw < rh) {
      val t = rw; rw = rh; rh = t
      ang += 90.0
    }
    if (ang > 45) ang -= if (ang > 135) 180.0 else 90.0
    if (ang < -45) ang += 90.0
    if (rw < 3 * rh * 0.5 || rw > 6 * rh) return rej("lcd-shape", "aspect=${rw / max(rh, 1.0)}")

    val H = bgr.rows()
    val W = bgr.cols()
    val rm = keep(Imgproc.getRotationMatrix2D(Point(rect.center.x, rect.center.y), ang, 1.0))
    val rot = keep(Mat())
    Imgproc.warpAffine(bgr, rot, rm, Size(W.toDouble(), H.toDouble()), Imgproc.INTER_LINEAR, Core.BORDER_REPLICATE, Scalar(0.0))
    val mask0 = keep(Mat.zeros(H, W, CvType.CV_8U))
    val hullIdx = MatOfInt()
    Imgproc.convexHull(c, hullIdx)
    val cp = c.toArray()
    val hullPts = MatOfPoint(*hullIdx.toArray().map { cp[it] }.toTypedArray())
    Imgproc.drawContours(mask0, listOf(hullPts), -1, Scalar(255.0), -1)
    val mask = keep(Mat())
    Imgproc.warpAffine(mask0, mask, rm, Size(W.toDouble(), H.toDouble()), Imgproc.INTER_NEAREST)
    val nz = keep(Mat())
    Core.findNonZero(mask, nz)
    if (nz.rows() == 0) return rej("no-lcd")
    val bb = Imgproc.boundingRect(nz)
    val roi0 = keep(rot.submat(Rect(bb.x, bb.y, bb.width, bb.height)).clone())
    val msk0 = keep(mask.submat(Rect(bb.x, bb.y, bb.width, bb.height)).clone())

    // work at a fixed LCD height
    val sc = 480.0 / roi0.rows()
    val roi = keep(Mat())
    Imgproc.resize(roi0, roi, Size(), sc, sc, Imgproc.INTER_AREA)
    val msk1 = keep(Mat())
    Imgproc.resize(msk0, msk1, Size(roi.cols().toDouble(), roi.rows().toDouble()), 0.0, 0.0, Imgproc.INTER_NEAREST)
    val er = (0.03 * roi.rows()).toInt()
    val msk = keep(Mat())
    Imgproc.erode(msk1, msk, keep(Mat.ones(er * 2 + 1, er * 2 + 1, CvType.CV_8U)))
    val gray = keep(Mat())
    Imgproc.cvtColor(roi, gray, Imgproc.COLOR_BGR2GRAY)
    val g = keep(Mat())
    // The cyan LCD keeps the smoothing it was validated with. Other light panels get less:
    // with the full amount a decimal point close to its digit ran into it and was lost
    // ("500.0" read as "5000" on grey / green / yellow panels).
    Imgproc.GaussianBlur(gray, g, Size(0.0, 0.0), (if (panel != null) LIGHT_BLUR else 0.012) * roi.rows())
    // local background (what the LCD would look like without ink); ink = darker than it
    val kb = (0.30 * roi.rows()).toInt() or 1
    val bgest = background(g, Imgproc.MORPH_CLOSE, kb, fast, keep)
    val diff = keep(Mat())
    Core.subtract(bgest, g, diff)

    val hh = roi.rows()
    val ww = roi.cols()
    val diffB = ByteArray(hh * ww).also { diff.get(0, 0, it) }
    val mskB = ByteArray(hh * ww).also { msk.get(0, 0, it) }
    val hist = IntArray(256)
    var n = 0
    for (i in diffB.indices) if (mskB[i].toInt() != 0) {
      hist[diffB[i].toInt() and 0xFF]++
      n++
    }
    if (n < 1000) return rej("lcd-too-small")
    val vals = keep(Mat(n, 1, CvType.CV_8U))
    run {
      val arr = ByteArray(n)
      var j = 0
      for (i in diffB.indices) if (mskB[i].toInt() != 0) arr[j++] = diffB[i]
      vals.put(0, 0, arr)
    }
    val otsuOut = keep(Mat())
    val t = Imgproc.threshold(vals, otsuOut, 0.0, 255.0, Imgproc.THRESH_BINARY + Imgproc.THRESH_OTSU)
    val p99 = percentile(hist, n, 99.0)
    if (p99 < 25 || t < 12) return rej("low-contrast", "p99=$p99")
    val lcdInk = ByteArray(hh * ww)
    for (i in lcdInk.indices) if ((diffB[i].toInt() and 0xFF) > t && mskB[i].toInt() != 0) lcdInk[i] = 255.toByte()
    if (panel == null) return readInk(lcdInk, hh, ww, ang, false, keep)
    val inkBefore = keep(Mat(hh, ww, CvType.CV_8U)).also { it.put(0, 0, lcdInk) }
    val r = readInk(lcdInk, hh, ww, ang, false, keep)
    if (!r.ok) return r
    val soft = edgeSoftness(gray, inkBefore, mskB, r.hd, keep)
    return if (soft > SOFT_MAX) rej("blurred", "soft=${"%.3f".format(soft)}") else r
  }

  /**
   * Shared digit reader: a binary ink image (0 / 255, hh x ww, row-major; overwritten here)
   * -> the number it shows. `coverage` selects the thin-stroke segment test used for LED
   * digits, sampled inside each digit's own box (seen at an angle the row is not level, and
   * one shared top/bottom would miss the end segments).
   */
  private fun readInk(ink: ByteArray, hh: Int, ww: Int, ang: Double, coverage: Boolean, keep: (Mat) -> Mat): Result {
    var inkMat = keep(Mat(hh, ww, CvType.CV_8U))
    inkMat.put(0, 0, ink)

    // shear correction (italic digits): pick the shear that makes columns sharpest
    var best = -1.0
    var bs = 0.0
    val sh = keep(Mat())
    val colSum = keep(Mat())
    val colCount = IntArray(ww)
    for (i in 0..40) {
      val s = -0.40 + i * 0.02
      val mx = keep(shearMat(s, hh))
      Imgproc.warpAffine(inkMat, sh, mx, Size(ww.toDouble(), hh.toDouble()))
      // inked pixels per column, counted natively (same counts as a pixel loop)
      Imgproc.threshold(sh, sh, 0.0, 1.0, Imgproc.THRESH_BINARY)
      Core.reduce(sh, colSum, 0, Core.REDUCE_SUM, CvType.CV_32S)
      colSum.get(0, 0, colCount)
      var sc2 = 0.0
      for (v in colCount) sc2 += v.toDouble() * v
      if (sc2 > best) {
        best = sc2
        bs = s
      }
    }
    val inkS = keep(Mat())
    Imgproc.warpAffine(inkMat, inkS, keep(shearMat(bs, hh)), Size(ww.toDouble(), hh.toDouble()), Imgproc.INTER_NEAREST)
    inkS.get(0, 0, ink)

    // drop bezel/edge slivers: very thin components or ones hugging the LCD border
    run {
      val labels = keep(Mat())
      val stats = keep(Mat())
      val cent = keep(Mat())
      inkMat = keep(Mat(hh, ww, CvType.CV_8U)).also { it.put(0, 0, ink) }
      val n0 = Imgproc.connectedComponentsWithStats(inkMat, labels, stats, cent)
      val st = IntArray(n0 * 5).also { stats.get(0, 0, it) }
      val remove = BooleanArray(n0)
      var any = false
      for (i in 1 until n0) {
        val x = st[i * 5]; val y = st[i * 5 + 1]; val w = st[i * 5 + 2]; val h = st[i * 5 + 3]
        // thin slivers are only bezel edges on the thick-stroked LCD; on a thin-stroked
        // display a sliver that tall can be the digit 1, and must not vanish silently
        val thin = !coverage && w < 0.04 * hh && h > 0.3 * hh
        val edge = x <= 0.01 * ww || x + w >= 0.99 * ww || y <= 0.01 * hh || y + h >= 0.99 * hh
        if (thin || edge) {
          remove[i] = true
          any = true
        }
      }
      if (any) {
        val lab = IntArray(hh * ww).also { labels.get(0, 0, it) }
        for (i in lab.indices) if (remove[lab[i]]) ink[i] = 0
        inkMat.put(0, 0, ink)
      }
    }

    // digits: join broken segments vertically, keep tall components
    val kv = max(3, (0.18 * hh).toInt()) or 1
    val joined = keep(Mat())
    Imgproc.morphologyEx(inkMat, joined, Imgproc.MORPH_CLOSE, keep(Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(1.0, kv.toDouble()))))
    val comps = components(joined, keep).filter { it.a > 30 }
    if (comps.isEmpty()) return rej("no-ink")
    val hmax = comps.maxOf { it.h }
    if (hmax < 0.25 * hh) return rej("digits-too-small", "frac=${hmax.toDouble() / hh}")
    val tall = comps.filter { it.h >= 0.6 * hmax }
    val ref = tall.maxByOrNull { it.a }!! // largest-ink component anchors the digit row
    val rtop = ref.y
    val rbot = ref.y + ref.h
    val rhRef = ref.h
    var digs =
        tall
            .filter { abs(it.y - rtop) <= 0.15 * rhRef && abs(it.y + it.h - rbot) <= 0.15 * rhRef }
            .sortedBy { it.x }
    // narrow comps must be a solid bar to be a '1'; sparse/jagged slivers are noise
    val narrow = 0.32 * rhRef // a '1' bar is ~0.1-0.2 of digit height wide; real digits ~0.4-0.6
    digs = digs.filter { !(it.w < narrow && it.a / (it.w * it.h).toDouble() < 0.45) }
    if (digs.size !in 1..8) return rej("digit-count", "n=${digs.size}")
    val top = median(digs.map { it.y })
    val bot = median(digs.map { it.y + it.h })
    val hd = bot - top
    if (hd < 0.25 * hh) return rej("digits-too-small")
    val wide = digs.maxOf { it.w }
    if (wide > 0.9 * hd) return rej("merged-digits")

    // unexplained ink: a sizeable component on the digit row that was NOT accepted as a digit
    // means we are misreading the row (e.g. half-joined glyphs) -> reject, never guess
    for (s in comps) {
      if (digs.any { it.x == s.x && it.y == s.y && it.w == s.w && it.h == s.h }) continue
      val cyc = s.y + s.h / 2.0
      if (s.h >= 0.35 * hd && cyc >= top && cyc <= bot) {
        if (s.w < narrow && s.a / (s.w * s.h).toDouble() < 0.45) continue
        return rej("unassigned-ink", "at=${s.x} size=${s.w}x${s.h}")
      }
    }

    val chars = StringBuilder()
    val info = ArrayList<String>()
    val botC = min(bot, hh)
    for (d in digs) {
      if (d.w < narrow) { // narrow glyph: candidate '1' - one solid vertical bar
        var colMax = 0.0
        val rows = botC - top
        if (rows > 0) {
          for (cc in d.x until min(d.x + d.w, ww)) {
            var cnt = 0
            for (r in top until botC) if (ink[r * ww + cc].toInt() != 0) cnt++
            colMax = max(colMax, cnt.toDouble() / rows)
          }
        }
        if (colMax > 0.6) {
          chars.append('1')
          info.add("narrow")
          continue
        }
        return rej("narrow-unrecognised", "at=${d.x}")
      }
      val dTop = if (coverage) d.y else top
      val dHd = if (coverage) d.h else hd
      val subRows = if (coverage) min(d.y + d.h, hh) - d.y else botC - top
      val subCols = min(d.x + d.w, ww) - d.x
      val frac = LinkedHashMap<Char, Double>()
      for ((k, f) in SEG) {
        val r0 = (f[2] * dHd).toInt()
        val r1 = max((f[3] * dHd).toInt(), r0 + 1)
        val c0 = (f[0] * d.w).toInt()
        val c1 = max((f[1] * d.w).toInt(), c0 + 1)
        val rr1 = min(r1, subRows)
        val cc1 = min(c1, subCols)
        if (!coverage) {
          var cnt = 0
          var tot = 0
          for (r in r0 until rr1) for (cc in c0 until cc1) {
            tot++
            if (ink[(dTop + r) * ww + d.x + cc].toInt() != 0) cnt++
          }
          frac[k] = if (tot > 0) cnt.toDouble() / tot else 0.0
          continue
        }
        // how much of the segment's length is lit, whatever its thickness
        val rowsN = rr1 - r0
        val colsN = cc1 - c0
        if (rowsN <= 0 || colsN <= 0) {
          frac[k] = 0.0
          continue
        }
        val along = k == 'a' || k == 'g' || k == 'd' // these run across the columns
        val need = max(2, (0.15 * (if (along) rowsN else colsN)).toInt())
        var hit = 0
        if (along) {
          for (cc in c0 until cc1) {
            var cnt = 0
            for (r in r0 until rr1) if (ink[(dTop + r) * ww + d.x + cc].toInt() != 0) cnt++
            if (cnt >= need) hit++
          }
        } else {
          for (r in r0 until rr1) {
            var cnt = 0
            for (cc in c0 until cc1) if (ink[(dTop + r) * ww + d.x + cc].toInt() != 0) cnt++
            if (cnt >= need) hit++
          }
        }
        frac[k] = hit.toDouble() / (if (along) colsN else rowsN)
      }
      val on = if (coverage) COV_ON else ON
      val off = if (coverage) COV_OFF else OFF
      val amb = frac.filterValues { it > off && it < on }
      if (amb.isNotEmpty()) return rej("ambiguous-segment", "at=${d.x} " + frac.entries.joinToString(" ") { "${it.key}=${"%.2f".format(it.value)}" })
      val lit = "abcdefg".filter { frac[it]!! >= on }
      val ch = TABLE[lit] ?: return rej("unknown-pattern", "pattern=$lit at=${d.x}")
      chars.append(ch)
      info.add(lit)
    }

    // decimal point: small compact blob in the bottom of the band, BETWEEN two digits
    val dots = sortedSetOf<Int>()
    val ccs = components(inkMat, keep)
    for (cmp in ccs) {
      val cxm = cmp.x + cmp.w / 2.0
      val cym = cmp.y + cmp.h / 2.0
      if (!(top + 0.70 * hd <= cym && cym <= bot + 0.12 * hd)) continue
      if (!(0.03 * hd <= cmp.w && cmp.w <= 0.30 * hd && 0.03 * hd <= cmp.h && cmp.h <= 0.30 * hd)) continue
      if (cmp.a < 0.5 * cmp.w * cmp.h * 0.6) continue
      for (k in 0 until digs.size - 1) {
        if (digs[k].x + digs[k].w - 0.1 * wide <= cxm && cxm <= digs[k + 1].x + 0.1 * wide) dots.add(k)
      }
    }
    if (dots.size > 1) return rej("multiple-dots", "dots=$dots")
    var text = chars.toString()
    if (dots.isNotEmpty()) {
      val k = dots.first()
      text = text.substring(0, k + 1) + "." + text.substring(k + 1)
    }
    return Result(true, text, null, null, info, bs, ang, hd = hd, cells = digs.map { intArrayOf(it.x, it.y, it.w, it.h) }, top = top)
  }

  // ---- lit digits on a dark panel (LED / VFD) ---------------------------------

  /** Brightest of the three channels: a red or green LED is as "lit" as a white one. */
  private fun maxChannel(bgr: Mat, keep: (Mat) -> Mat): Mat {
    val ch = ArrayList<Mat>()
    Core.split(bgr, ch)
    ch.forEach { keep(it) }
    val m = keep(Mat())
    Core.max(ch[0], ch[1], m)
    Core.max(m, ch[2], m)
    return m
  }

  /** Largest dark region of the frame: the display window the lit digits sit in. */
  private fun findDarkPanel(bgr: Mat, keep: (Mat) -> Mat): MatOfPoint? {
    val h = bgr.rows()
    val w = bgr.cols()
    val vb = keep(Mat())
    Imgproc.GaussianBlur(maxChannel(bgr, keep), vb, Size(0.0, 0.0), max(1.0, 0.004 * min(h, w)))
    val dark = keep(Mat())
    Imgproc.threshold(vb, dark, 89.0, 255.0, Imgproc.THRESH_BINARY_INV) // < 90
    // lit digits are holes in the dark panel: close them so the panel is one blob
    val k = max(3, (min(h, w) * 0.06).toInt()) or 1
    val filled = keep(Mat())
    Imgproc.morphologyEx(dark, filled, Imgproc.MORPH_CLOSE, keep(Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(k.toDouble(), k.toDouble()))))
    val ko = max(3, (min(h, w) * 0.02).toInt()) or 1
    val opened = keep(Mat())
    Imgproc.morphologyEx(filled, opened, Imgproc.MORPH_OPEN, keep(Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(ko.toDouble(), ko.toDouble()))))
    val cs = ArrayList<MatOfPoint>()
    Imgproc.findContours(opened, cs, keep(Mat()), Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE)
    return cs.filter { Imgproc.contourArea(it) >= 0.03 * h * w }.maxByOrNull { Imgproc.contourArea(it) }
  }

  private class Straight(val roi: Mat, val mask: Mat, val ang: Double, val rw: Double, val rh: Double)

  /** Rotates the frame so region `c` is level; returns the region and its mask (as decodeImpl does for the LCD). */
  private fun straighten(bgr: Mat, c: MatOfPoint, keep: (Mat) -> Mat): Straight? {
    val rect = Imgproc.minAreaRect(MatOfPoint2f(*c.toArray()))
    var rw = rect.size.width
    var rh = rect.size.height
    var ang = rect.angle
    if (rw < rh) {
      val t = rw; rw = rh; rh = t
      ang += 90.0
    }
    if (ang > 45) ang -= if (ang > 135) 180.0 else 90.0
    if (ang < -45) ang += 90.0
    val H = bgr.rows()
    val W = bgr.cols()
    val rm = keep(Imgproc.getRotationMatrix2D(Point(rect.center.x, rect.center.y), ang, 1.0))
    val rot = keep(Mat())
    Imgproc.warpAffine(bgr, rot, rm, Size(W.toDouble(), H.toDouble()), Imgproc.INTER_LINEAR, Core.BORDER_REPLICATE, Scalar(0.0))
    val mask0 = keep(Mat.zeros(H, W, CvType.CV_8U))
    val hullIdx = MatOfInt()
    Imgproc.convexHull(c, hullIdx)
    val cp = c.toArray()
    val hullPts = MatOfPoint(*hullIdx.toArray().map { cp[it] }.toTypedArray())
    Imgproc.drawContours(mask0, listOf(hullPts), -1, Scalar(255.0), -1)
    val mask = keep(Mat())
    Imgproc.warpAffine(mask0, mask, rm, Size(W.toDouble(), H.toDouble()), Imgproc.INTER_NEAREST)
    val nz = keep(Mat())
    Core.findNonZero(mask, nz)
    if (nz.rows() == 0) return null
    val bb = Imgproc.boundingRect(nz)
    return Straight(
        keep(rot.submat(Rect(bb.x, bb.y, bb.width, bb.height)).clone()),
        keep(mask.submat(Rect(bb.x, bb.y, bb.width, bb.height)).clone()),
        ang, rw, rh)
  }

  private fun decodeLed(bgr: Mat, keep: (Mat) -> Mat): Result {
    val c = findDarkPanel(bgr, keep) ?: return rej("no-panel")
    return decodeLedPanel(bgr, c, keep).copy(box = boxOf(c, bgr))
  }

  private fun decodeLedPanel(bgr: Mat, c: MatOfPoint, keep: (Mat) -> Mat): Result {
    val st = straighten(bgr, c, keep) ?: return rej("no-panel")
    if (st.rw < 1.2 * st.rh || st.rw > 8 * st.rh) return rej("panel-shape", "aspect=${st.rw / max(st.rh, 1.0)}")
    val glare = glareSize(bgr, c, 1.5, keep)
    if (glare >= GLARE_SIZE) return rej("glare", "size=${"%.3f".format(glare)}")

    // work at a fixed panel height
    val sc = 480.0 / st.roi.rows()
    val roi = keep(Mat())
    Imgproc.resize(st.roi, roi, Size(), sc, sc, if (sc < 1) Imgproc.INTER_AREA else Imgproc.INTER_LINEAR)
    val hh = roi.rows()
    val ww = roi.cols()
    val msk1 = keep(Mat())
    Imgproc.resize(st.mask, msk1, Size(ww.toDouble(), hh.toDouble()), 0.0, 0.0, Imgproc.INTER_NEAREST)
    val er = (0.03 * hh).toInt()
    val msk = keep(Mat())
    Imgproc.erode(msk1, msk, keep(Mat.ones(er * 2 + 1, er * 2 + 1, CvType.CV_8U)))

    // lit = brighter than the local background (what the panel looks like with nothing lit)
    val v = maxChannel(roi, keep)
    val g = keep(Mat())
    // Much lighter smoothing than the LCD reader uses: LED strokes are thin and a decimal
    // point sits close to its digits - smoothed more, point and digits fuse into one blob
    // ("0.000" was refused as merged digits) or the point disappears into a digit.
    Imgproc.GaussianBlur(v, g, Size(0.0, 0.0), LED_BLUR * hh)
    val kb = (0.30 * hh).toInt() or 1
    val bgest = background(g, Imgproc.MORPH_OPEN, kb, true, keep)
    val diff = keep(Mat())
    Core.subtract(g, bgest, diff)

    val diffB = ByteArray(hh * ww).also { diff.get(0, 0, it) }
    val mskB = ByteArray(hh * ww).also { msk.get(0, 0, it) }
    val hist = IntArray(256)
    var n = 0
    for (i in diffB.indices) if (mskB[i].toInt() != 0) {
      hist[diffB[i].toInt() and 0xFF]++
      n++
    }
    if (n < 1000) return rej("panel-too-small")
    val vals = keep(Mat(n, 1, CvType.CV_8U))
    run {
      val arr = ByteArray(n)
      var j = 0
      for (i in diffB.indices) if (mskB[i].toInt() != 0) arr[j++] = diffB[i]
      vals.put(0, 0, arr)
    }
    val t = Imgproc.threshold(vals, keep(Mat()), 0.0, 255.0, Imgproc.THRESH_BINARY + Imgproc.THRESH_OTSU)
    val p99 = percentile(hist, n, 99.0)
    if (p99 < 40 || t < 20) return rej("low-contrast", "p99=$p99")
    val lit = BooleanArray(hh * ww) { (diffB[it].toInt() and 0xFF) > t && mskB[it].toInt() != 0 }

    // A printed unit label ("kg") beside the digits is lit too. Coloured digits are told
    // apart from a white label by saturation, then by the one hue most lit pixels share;
    // when the digits themselves are white there is nothing to separate and all lit ink stays.
    val hsv = keep(Mat())
    Imgproc.cvtColor(roi, hsv, Imgproc.COLOR_BGR2HSV)
    val hsvB = ByteArray(hh * ww * 3).also { hsv.get(0, 0, it) }
    var litCount = 0
    var colouredCount = 0
    val hueHist = DoubleArray(180)
    for (i in lit.indices) if (lit[i]) {
      litCount++
      if ((hsvB[i * 3 + 1].toInt() and 0xFF) >= 110) {
        colouredCount++
        hueHist[(hsvB[i * 3].toInt() and 0xFF) % 180] += 1.0
      }
    }
    if (colouredCount >= 0.5 * litCount) {
      var peak = 0
      var bestWin = -1.0
      for (hue in 0 until 180) {
        var win = 0.0
        for (d in -10..10) win += hueHist[((hue - d) % 180 + 180) % 180]
        if (win > bestWin) {
          bestWin = win
          peak = hue
        }
      }
      for (i in lit.indices) if (lit[i]) {
        val dh0 = abs((hsvB[i * 3].toInt() and 0xFF) - peak)
        val dh = min(dh0, 180 - dh0)
        lit[i] = (hsvB[i * 3 + 1].toInt() and 0xFF) >= 110 && dh <= 12
      }
    }
    val inkRaw = keep(Mat(hh, ww, CvType.CV_8U))
    inkRaw.put(0, 0, ByteArray(hh * ww) { if (lit[it]) 255.toByte() else 0 })
    val ko = max(3, (0.012 * hh).toInt()) or 1
    val inkOpen = keep(Mat())
    Imgproc.morphologyEx(inkRaw, inkOpen, Imgproc.MORPH_OPEN, keep(Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(ko.toDouble(), ko.toDouble()))))
    val inkB = ByteArray(hh * ww).also { inkOpen.get(0, 0, it) }

    val r = readInk(inkB.copyOf(), hh, ww, st.ang, true, keep)
    if (!r.ok) return r

    // Too soft and a decimal point may be hidden in the digit beside it.
    val soft = edgeSoftness(v, inkOpen, mskB, r.hd, keep)
    if (soft > SOFT_MAX) return rej("blurred", "soft=${"%.3f".format(soft)}")
    return r.copy(kind = "led")
  }

  // ---- over-exposed LED digits: white strokes in their own coloured glow ------

  /**
   * `core`: the weakest colour channel of each pixel - high only where a pixel is blown out
   * to white. `excess`: how far the strongest channel leads the next one - high in the
   * coloured glow around a lit LED stroke, near zero on anything grey or white.
   */
  private fun glowChannels(bgr: Mat, keep: (Mat) -> Mat): Triple<Mat, Mat, Mat> {
    val ch = ArrayList<Mat>()
    Core.split(bgr, ch)
    ch.forEach { keep(it) }
    val lo = keep(Mat())
    val hi = keep(Mat())
    Core.min(ch[0], ch[1], lo)
    Core.max(ch[0], ch[1], hi)
    val core = keep(Mat())
    Core.min(lo, ch[2], core)
    val top = keep(Mat())
    Core.max(hi, ch[2], top)
    // the middle one of the three: max(min(b, g), min(max(b, g), r))
    val mid = keep(Mat())
    Core.min(hi, ch[2], mid)
    Core.max(lo, mid, mid)
    val excess = keep(Mat())
    Core.subtract(top, mid, excess)
    return Triple(core, excess, top)
  }

  private class GlowInk(val lit: Mat, val unclear: Mat, val onUnlit: Mat, val coreV: Mat, val saturated: Mat)

  /**
   * Sorts every blown-out blob by what surrounds it. A lit LED stroke that the camera has
   * burnt out to white still sits inside its own coloured glow; an unlit (grey) segment, a
   * printed label or a reflection does not. `lit`: blobs surrounded by glow. `unclear`:
   * blobs only partly surrounded - a stroke with a reflection on it, or a reflection beside
   * a stroke. `onUnlit`: blobs surrounded largely by grey - a bright spot on an unlit segment
   * where a lit neighbour's bloom falls (the caller decides whether it may be ignored).
   * Everything else is ignored. Null when the picture is too busy to sort.
   */
  private fun glowInk(bgr: Mat, ring: Int, keep: (Mat) -> Mat, sortUnlit: Boolean = true): GlowInk? {
    val (coreV, excess, topV) = glowChannels(bgr, keep)
    val core = keep(Mat())
    Imgproc.threshold(coreV, core, GLOW_CORE - 1.0, 255.0, Imgproc.THRESH_BINARY)
    // burnt out means saturated too: a light-grey unlit segment is bright but never clipped
    val saturated = keep(Mat())
    Imgproc.threshold(topV, saturated, GLOW_SAT - 1.0, 255.0, Imgproc.THRESH_BINARY)
    Core.bitwise_and(core, saturated, core)
    val halo = keep(Mat())
    Imgproc.threshold(excess, halo, GLOW_EXCESS - 1.0, 255.0, Imgproc.THRESH_BINARY)
    val labels = keep(Mat())
    val stats = keep(Mat())
    val n = Imgproc.connectedComponentsWithStats(core, labels, stats, keep(Mat()))
    if (n > GLOW_MAX_BLOBS) return null
    val st = IntArray(n * 5).also { stats.get(0, 0, it) }
    val h = core.rows()
    val w = core.cols()
    val lit = keep(Mat.zeros(h, w, CvType.CV_8U))
    val unclear = keep(Mat.zeros(h, w, CvType.CV_8U))
    val onUnlit = keep(Mat.zeros(h, w, CvType.CV_8U))
    // grey: light but colourless - an unlit segment, not glow
    val grey = keep(Mat())
    Imgproc.threshold(coreV, grey, GLOW_GREY - 1.0, 255.0, Imgproc.THRESH_BINARY)
    grey.setTo(Scalar(0.0), halo)
    val k = keep(Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(2.0 * ring + 1, 2.0 * ring + 1)))
    val comp = keep(Mat())
    val around = keep(Mat())
    val glow = keep(Mat())
    val notCore = keep(Mat())
    for (i in 1 until n) {
      if (st[i * 5 + 4] < 6) continue
      val x0 = max(0, st[i * 5] - ring)
      val y0 = max(0, st[i * 5 + 1] - ring)
      val x1 = min(w, st[i * 5] + st[i * 5 + 2] + ring)
      val y1 = min(h, st[i * 5 + 1] + st[i * 5 + 3] + ring)
      val r = Rect(x0, y0, x1 - x0, y1 - y0)
      Core.compare(labels.submat(r), Scalar(i.toDouble()), comp, Core.CMP_EQ)
      Imgproc.dilate(comp, around, k)
      Core.bitwise_not(core.submat(r), notCore)
      Core.bitwise_and(around, notCore, around)
      val total = Core.countNonZero(around)
      Core.bitwise_and(around, halo.submat(r), glow)
      val frac = if (total > 0) Core.countNonZero(glow).toDouble() / total else 0.0
      Core.bitwise_and(around, grey.submat(r), glow)
      val greyFrac = if (total > 0) Core.countNonZero(glow).toDouble() / total else 0.0
      if (sortUnlit && greyFrac >= GLOW_RING_GREY) onUnlit.submat(r).setTo(Scalar(255.0), comp)
      else if (frac >= GLOW_RING_LIT) lit.submat(r).setTo(Scalar(255.0), comp)
      else if (frac > GLOW_RING_NOT) unclear.submat(r).setTo(Scalar(255.0), comp)
    }
    return GlowInk(lit, unclear, onUnlit, coreV, saturated)
  }

  /** The row of lit digits in a picture: centre, digit height, tilt (degrees) and x extent, in pixels. */
  private class GlowRow(val cx: Double, val cy: Double, val dh: Int, val ang: Double, val x0: Int, val x1: Int)

  /**
   * Finds the row of lit digits by the digits themselves - not by a window around them:
   * the housing of a real scale is often darker than its display window, and the window is
   * neither the darkest nor the brightest rectangle in the photo.
   */
  private fun findGlowRow(bgr: Mat, keep: (Mat) -> Mat): Pair<GlowRow?, Result?> {
    // (at picture scale a 3 px ring is mostly the stroke's own pale edge: spots on unlit
    // segments are told apart only at working scale, in decodeGlow)
    val ink = glowInk(bgr, 3, keep, sortUnlit = false) ?: return Pair(null, rej("no-glow", "too-busy"))
    val lit = ink.lit
    val cs = components(lit, keep).filter { it.a >= 8 }
    if (cs.isEmpty()) return Pair(null, rej("no-glow"))
    val kv = max(3, (0.6 * cs.maxOf { it.h }).toInt()) or 1
    // Points and small marks (the decimal point, an indicator lamp under the last digit) say
    // nothing about where the row is, and the vertical join below would glue them onto a
    // digit and tilt the row (a lit mark under the 0 made it 14 degrees). Strokes only.
    val longest = cs.maxOf { max(it.w, it.h) }
    val strokes = dropComponents(lit, keep) { max(it.w, it.h) < 0.3 * longest }
    val joined = keep(Mat())
    Imgproc.morphologyEx(strokes, joined, Imgproc.MORPH_CLOSE, keep(Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(1.0, kv.toDouble()))))
    val js = components(joined, keep).filter { it.a >= 8 }
    val ref = js.maxWithOrNull(compareBy<Comp> { it.h }.thenBy { it.a })!!
    val dh0 = ref.h
    if (dh0 < GLOW_MIN_DIGIT_PX) return Pair(null, rej("digits-too-small", "px=$dh0"))
    // The row is followed outwards from the tallest digit, neighbour to neighbour: seen at
    // an angle the digits shrink and climb along the row, so each is compared with the one
    // beside it, not with the tallest.
    val tall = js.filter { it.h >= 0.45 * dh0 }.sortedBy { it.x }
    fun beside(a: Comp, b: Comp): Boolean { // a is left of b
      val hmin = min(a.h, b.h)
      val hmax = max(a.h, b.h)
      return hmin >= 0.7 * hmax && b.x - (a.x + a.w) <= 1.5 * hmax &&
          abs((a.y + a.h / 2.0) - (b.y + b.h / 2.0)) <= 0.25 * hmax
    }
    var lo = tall.indexOf(ref)
    var hi = lo
    while (lo > 0 && beside(tall[lo - 1], tall[lo])) lo--
    while (hi < tall.size - 1 && beside(tall[hi], tall[hi + 1])) hi++
    val digs = tall.subList(lo, hi + 1)
    val x0 = digs.minOf { it.x }
    val x1 = digs.maxOf { it.x + it.w }
    val top = median(digs.map { it.y })
    val bot = median(digs.map { it.y + it.h })
    val dh = bot - top
    if (dh < GLOW_MIN_DIGIT_PX) return Pair(null, rej("digits-too-small", "px=$dh"))
    // a display has a handful of digits: anything much longer is not a row of them
    if (x1 - x0 > GLOW_MAX_ROW * dh) return Pair(null, rej("no-glow", "row-too-long"))
    var ang = 0.0
    if (digs.size >= 2 && (x1 - x0) > 1.2 * dh0) {
      // least-squares line through the bottoms of the digits
      val xs = digs.map { it.x + it.w / 2.0 }
      val ys = digs.map { (it.y + it.h).toDouble() }
      val mx = xs.average()
      val my = ys.average()
      var sxy = 0.0
      var sxx = 0.0
      for (i in xs.indices) {
        sxy += (xs[i] - mx) * (ys[i] - my)
        sxx += (xs[i] - mx) * (xs[i] - mx)
      }
      if (sxx > 0) ang = Math.toDegrees(Math.atan(sxy / sxx)).coerceIn(-25.0, 25.0)
    }
    // Tops and bottoms of different digits are not the same feature (a bar here, the end of
    // a stroke there), so that fit is only a start: the angle at which the horizontal bars
    // line up into the sharpest rows is searched around it.
    val pad = (0.5 * dh0).toInt()
    val ry0 = max(0, top - pad)
    val ry1 = min(lit.rows(), bot + pad)
    val rx0 = max(0, x0 - pad)
    val rx1 = min(lit.cols(), x1 + pad)
    val patch = strokes.submat(Rect(rx0, ry0, rx1 - rx0, ry1 - ry0))
    val pw = patch.cols()
    val ph = patch.rows()
    val rot = keep(Mat())
    val rowSum = keep(Mat())
    val rowCount = IntArray(ph)
    val start = ang
    var best = -1.0
    for (i in -12..12) {
      val a = start + 0.5 * i
      val mm = keep(Imgproc.getRotationMatrix2D(Point(pw / 2.0, ph / 2.0), a, 1.0))
      Imgproc.warpAffine(patch, rot, mm, Size(pw.toDouble(), ph.toDouble()))
      // inked pixels per row, counted natively (same counts as a pixel loop)
      Imgproc.threshold(rot, rot, 0.0, 1.0, Imgproc.THRESH_BINARY)
      Core.reduce(rot, rowSum, 1, Core.REDUCE_SUM, CvType.CV_32S)
      rowSum.get(0, 0, rowCount)
      var score = 0.0
      for (cnt in rowCount) score += cnt.toDouble() * cnt
      if (score > best) {
        best = score
        ang = a
      }
    }
    if (abs(ang) > 25) return Pair(null, rej("row-tilted", "angle=${"%.1f".format(ang)}"))
    return Pair(GlowRow((x0 + x1) / 2.0, (top + bot) / 2.0, dh, ang, x0, x1), null)
  }

  /**
   * Is the de-slanted ink something a seven-segment display can show? Returns the refusal
   * (reason, detail) when it is not. Each rule is there for a misreading it stopped: a
   * reflection beside a digit read as an extra 1, a reflection run into a 1 hiding the
   * decimal point, a reflection filling the middle of a 0.
   */
  private fun shapeProblem(ink: ByteArray, ww: Int, r: Result): Pair<String, String>? {
    val hd = r.hd
    // Digits sit on a fixed pitch, their right-hand strokes at the same place in every cell.
    val rights = r.cells.map { it[0] + it[2] }
    val gaps = rights.zipWithNext { a, b -> b - a }
    if (gaps.any { it < 0.5 * hd }) return "unassigned-ink" to "digits-too-close"
    if (gaps.size >= 2 && gaps.max() > 1.25 * gaps.min()) return "unassigned-ink" to "uneven-spacing"
    for ((i, c) in r.cells.withIndex()) {
      val x = c[0]; val y = c[1]; val w = c[2]; val h = c[3]
      if (r.segs[i] == "narrow") {
        // a 1 is one stroke of even thickness; a foot or a bulge is something run into it
        val widths = ArrayList<Float>()
        for (row in y until y + h) {
          var cnt = 0
          for (col in x until x + w) if (ink[row * ww + col].toInt() != 0) cnt++
          if (cnt > 0) widths.add(cnt.toFloat())
        }
        if (widths.isNotEmpty() && widths.max() > 1.7 * percentileF(widths, 50.0)) return "narrow-unrecognised" to "uneven-stroke"
        continue
      }
      // the two openings of a digit are never lit
      for ((f0, f1) in listOf(0.20 to 0.40, 0.60 to 0.80)) {
        var total = 0
        var on = 0
        for (row in y + (f0 * h).toInt() until y + (f1 * h).toInt()) {
          for (col in x + (0.32 * w).toInt() until x + (0.68 * w).toInt()) {
            total++
            if (ink[row * ww + col].toInt() != 0) on++
          }
        }
        if (total > 0 && on.toDouble() / total > 0.15) return "glare" to "ink-inside-digit"
      }
    }
    return null
  }

  /**
   * Reader for LED digits the camera has over-exposed: strokes burnt out to white, each
   * inside its own coloured glow, with the unlit segments showing grey beside them (what a
   * phone makes of a real red LED scale display). Lit strokes are told from unlit segments,
   * printed labels and reflections by that glow; the row is levelled and handed to the
   * shared digit reader.
   *
   * Refuses - never completes - a row that reaches the edge of the picture or has less
   * than a digit's width of picture beside it (a digit could be hidden there), a lit point
   * with no digit before it, a reflection on the row, ink no seven-segment display shows
   * (shapeProblem), and soft focus.
   */
  private fun decodeGlow(bgr: Mat, keep: (Mat) -> Mat): Result {
    val (row, refusal) = findGlowRow(bgr, keep)
    if (row == null) return refusal!!
    val h0 = bgr.rows()
    val w0 = bgr.cols()
    val dh = row.dh
    val cutOff = row.x0 - GLOW_ROOM_X * dh < 0 || row.x1 + GLOW_ROOM_X * dh > w0
    val sc = (GLOW_H / 2.0) / dh
    val hh = GLOW_H
    val ww = Math.round(((row.x1 - row.x0) + 2 * GLOW_PAD_X * dh) * sc).toInt()
    val m = keep(Imgproc.getRotationMatrix2D(Point(row.cx, row.cy), row.ang, sc))
    m.put(0, 2, m.get(0, 2)[0] + ww / 2.0 - row.cx)
    m.put(1, 2, m.get(1, 2)[0] + hh / 2.0 - row.cy)
    val roi = keep(Mat())
    Imgproc.warpAffine(bgr, roi, m, Size(ww.toDouble(), hh.toDouble()), Imgproc.INTER_LINEAR, Core.BORDER_CONSTANT, Scalar(0.0, 0.0, 0.0))
    val inside = keep(Mat())
    Imgproc.warpAffine(
        keep(Mat(h0, w0, CvType.CV_8U, Scalar(255.0))), inside, m, Size(ww.toDouble(), hh.toDouble()),
        Imgproc.INTER_NEAREST, Core.BORDER_CONSTANT, Scalar(0.0))

    // where that area sits in the image handed in (clipped to it)
    val inv = keep(Mat())
    Imgproc.invertAffineTransform(m, inv)
    val iv = DoubleArray(6).also { inv.get(0, 0, it) }
    val px = ArrayList<Double>()
    val py = ArrayList<Double>()
    for ((cx, cy) in listOf(0.0 to 0.0, ww.toDouble() to 0.0, ww.toDouble() to hh.toDouble(), 0.0 to hh.toDouble())) {
      px.add(iv[0] * cx + iv[1] * cy + iv[2])
      py.add(iv[3] * cx + iv[4] * cy + iv[5])
    }
    val bx0 = max(0.0, px.min())
    val by0 = max(0.0, py.min())
    val bx1 = min(w0.toDouble(), px.max())
    val by1 = min(h0.toDouble(), py.max())
    val box = listOf(bx0 / w0, by0 / h0, (bx1 - bx0) / w0, (by1 - by0) / h0)
    fun refuse(reason: String, detail: String? = null) = Result(false, null, reason, detail, kind = "led", box = box)

    if (cutOff) return refuse("display-cut-off", "no-room-beside-digits")
    val found = glowInk(roi, max(2, (GLOW_RING * hh).toInt()), keep) ?: return refuse("no-glow", "too-busy")
    val ko = max(3, (0.012 * hh).toInt()) or 1
    val opened = keep(Mat())
    Imgproc.morphologyEx(found.lit, opened, Imgproc.MORPH_OPEN, keep(Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(ko.toDouble(), ko.toDouble()))))
    // The row fills rows hh/4 .. 3hh/4. Lit ink wholly below or above it (an indicator lamp
    // under the last digit) is no part of the reading; the decimal point sits on the
    // baseline and is kept.
    val rowLo = 0.25 * hh - 0.15 * (hh / 2.0)
    val rowHi = 0.75 * hh + 0.15 * (hh / 2.0)
    val ink = dropComponents(opened, keep) { it.y >= rowHi || it.y + it.h <= rowLo }
    val inkB = ByteArray(hh * ww).also { ink.get(0, 0, it) }
    val insideB = ByteArray(hh * ww).also { inside.get(0, 0, it) }
    val band0 = (0.20 * hh).toInt()
    val band1 = (0.80 * hh).toInt()
    val dhW = hh / 2.0 // digit height in the working image

    // lit ink running out of the picture: digits may be missing
    val outside = keep(Mat())
    Core.bitwise_not(inside, outside)
    Imgproc.dilate(outside, outside, keep(Mat.ones(5, 5, CvType.CV_8U)))
    val outsideB = ByteArray(hh * ww).also { outside.get(0, 0, it) }
    for (i in inkB.indices) {
      if (inkB[i].toInt() != 0 && outsideB[i].toInt() != 0 && insideB[i].toInt() != 0) return refuse("display-cut-off", "ink-at-edge")
    }
    // lit ink on the digit row reaching the side of the area being read: the row was not
    // taken whole, and what is cut would otherwise just be dropped
    val side = max(2, (0.015 * ww).toInt())
    for (r in band0 until band1) {
      for (c in 0 until side) {
        if (inkB[r * ww + c].toInt() != 0 || inkB[r * ww + ww - 1 - c].toInt() != 0) return refuse("unassigned-ink", "ink-at-side-of-row")
      }
    }
    // a blown-out, colourless patch on the digit row that is not a lit stroke hides whatever is under it
    val hsv = keep(Mat())
    Imgproc.cvtColor(roi, hsv, Imgproc.COLOR_BGR2HSV)
    val blown = keep(Mat())
    Core.inRange(hsv, Scalar(0.0, 0.0, GLARE_V), Scalar(179.0, GLARE_S - 1.0, 255.0), blown)
    val inkWide = keep(Mat())
    Imgproc.dilate(ink, inkWide, keep(Mat.ones(5, 5, CvType.CV_8U)))
    blown.setTo(Scalar(0.0), inkWide)
    val dist = keep(Mat())
    Imgproc.distanceTransform(blown.submat(Rect(0, band0, ww, band1 - band0)), dist, Imgproc.DIST_L2, 3)
    val glare = Core.minMaxLoc(dist).maxVal / hh
    if (glare >= GLARE_SIZE) return refuse("glare", "size=${"%.3f".format(glare)}")
    // A blob only partly surrounded by glow: a stroke with a reflection on it, or a
    // reflection. And a truly burnt-out blob with no glow around it at all: a stroke or the
    // decimal point seen through a haze that has washed its glow out would otherwise be
    // dropped without a trace ("1.70" became "170").
    val doubtful = keep(Mat())
    Imgproc.threshold(found.coreV, doubtful, GLOW_BRIGHT - 1.0, 255.0, Imgproc.THRESH_BINARY)
    Core.bitwise_and(doubtful, found.saturated, doubtful)
    doubtful.setTo(Scalar(0.0), found.lit)
    doubtful.setTo(Scalar(0.0), found.onUnlit)
    Core.bitwise_or(doubtful, found.unclear, doubtful)
    for (u in components(keep(doubtful.submat(Rect(0, band0, ww, band1 - band0)).clone()), keep)) {
      if (u.a >= (0.04 * hh) * (0.04 * hh)) return refuse("glare", "unclear-ink at=${u.x} size=${u.w}x${u.h}")
    }

    // A reflection that has run into a digit: it filled the middle of a 0 into an 8.
    val thick = keep(Mat())
    Imgproc.distanceTransform(ink, thick, Imgproc.DIST_L2, 3)
    val thickA = FloatArray(hh * ww).also { thick.get(0, 0, it) }
    val onInk = ArrayList<Float>()
    for (i in inkB.indices) if (inkB[i].toInt() != 0) onInk.add(thickA[i])
    if (onInk.isNotEmpty()) {
      val half = 2.0 * percentileF(onInk, 50.0)
      val fat = onInk.max() / max(half, 1.0)
      if (fat > GLOW_FAT) return refuse("glare", "fat-ink=${"%.2f".format(fat)}")
    }

    val sheared = inkB.copyOf() // readInk leaves the de-slanted ink in here
    val r = readInk(sheared, hh, ww, row.ang, true, keep)
    if (!r.ok) return r.copy(kind = "led", box = box)
    shapeProblem(sheared, ww, r)?.let { return refuse(it.first, it.second) }
    // A bright spot on an unlit segment is ignored only beside the reading (the unlit half of
    // the digit a 1 is shown on, a blank leading digit). Anywhere from the first lit stroke to
    // where a point after the last digit would be, it could be a lit segment or the decimal
    // point under a reflection - that is not guessed at.
    run {
      // the span of the reading: lit strokes and points, not specks
      val minA = (0.03 * hh) * (0.03 * hh)
      val real = components(ink, keep).filter { it.a >= minA && it.y + it.h > band0 && it.y < band1 }
      val sx0 = real.minOfOrNull { it.x } ?: 0
      val sx1 = real.maxOfOrNull { it.x + it.w } ?: ww
      for (u in components(found.onUnlit, keep)) {
        val ux = u.x + u.w / 2.0
        val uy = u.y + u.h / 2.0
        if (u.a >= minA && ux >= sx0 && ux <= sx1 + 0.35 * dhW && uy >= band0 && uy <= band1 + 0.1 * dhW) {
          return refuse("glare", "unlit-spot-in-reading at=${u.x} size=${u.w}x${u.h}")
        }
      }
    }
    val hd = r.hd
    val rowTop = r.top
    val rowBot = r.top + hd
    val marks = components(keep(Mat(hh, ww, CvType.CV_8U)).also { it.put(0, 0, sheared) }, keep)
    val first = r.cells.first()
    for (s in marks) {
      val cy = s.y + s.h / 2.0
      // a lit bar on the digit row that belongs to no digit (a minus sign, half a digit)
      if (s.w >= 0.30 * hd && cy >= rowTop && cy <= rowBot &&
          r.cells.none { it[0] - 0.05 * hd <= s.x && s.x + s.w <= it[0] + it[2] + 0.05 * hd }) {
        return refuse("unassigned-ink", "bar at=${s.x} size=${s.w}x${s.h}")
      }
      // a lit point with no digit before it: that digit is outside the picture
      val cx = s.x + s.w / 2.0
      if (cy >= rowTop + 0.70 * hd && cy <= rowBot + 0.12 * hd && s.w >= 0.03 * hd && s.w <= 0.30 * hd &&
          s.h >= 0.03 * hd && s.h <= 0.30 * hd && cx < first[0] && s.a >= 0.3 * s.w * s.h) {
        return refuse("display-cut-off", "point-without-digit")
      }
    }
    // Too soft and a decimal point may be hidden in the digit beside it.
    val soft = edgeSoftness(found.coreV, ink, insideB, hd, keep)
    if (soft > SOFT_MAX) return refuse("blurred", "soft=${"%.3f".format(soft)}")
    return r.copy(kind = "led", box = box)
  }

  // ---- where in a whole photo the display might be ----------------------------

  /**
   * Regions of a photo that could be a display window, best first: cyan LCD areas, dark
   * windows and light windows - every one that is a filled, wide, roughly level rectangle,
   * not just the largest. Nothing is read here and none of them is assumed to be the
   * display: the caller runs the reader on each and keeps the one digits are found in.
   * Coordinates are fractions (0..1) of the image.
   */
  fun locateCandidates(bitmap: Bitmap, limit: Int = 6): List<Candidate> {
    val argb = if (bitmap.config == Bitmap.Config.ARGB_8888) bitmap else bitmap.copy(Bitmap.Config.ARGB_8888, false)
    val full = BitmapUtils.bitmapToBGRMat(argb)
    if (argb !== bitmap) argb.recycle()
    val scratch = ArrayList<Mat>()
    scratch.add(full)
    val keep: (Mat) -> Mat = { scratch.add(it); it }
    try {
      val sc = min(1.0, 1200.0 / max(full.rows(), full.cols()))
      val im = if (sc < 1.0) keep(Mat()).also { Imgproc.resize(full, it, Size(), sc, sc, Imgproc.INTER_AREA) } else full
      val h = im.rows()
      val w = im.cols()
      val out = ArrayList<Candidate>()
      fun rectKernel(f: Double): Mat {
        val k = max(3, (min(h, w) * f).toInt()) or 1
        return keep(Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(k.toDouble(), k.toDouble())))
      }
      fun add(kind: String, mask: Mat) {
        val cs = ArrayList<MatOfPoint>()
        Imgproc.findContours(mask, cs, keep(Mat()), Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE)
        for (c in cs) {
          val a = Imgproc.contourArea(c)
          if (a < 0.004 * h * w) continue
          val bb = Imgproc.boundingRect(c)
          if (bb.width > 0.92 * w && bb.height > 0.92 * h) continue // the whole frame is not a display
          val rect = Imgproc.minAreaRect(MatOfPoint2f(*c.toArray()))
          var rw = rect.size.width
          var rh = rect.size.height
          var ang = rect.angle
          if (rw < rh) {
            val t = rw; rw = rh; rh = t
            ang += 90.0
          }
          if (ang > 45) ang -= if (ang > 135) 180.0 else 90.0
          if (ang < -45) ang += 90.0
          if (rh < 1 || rw < 1.2 * rh || rw > 8 * rh) continue // display windows are wide
          if (abs(ang) > 30) continue
          val fill = a / (rw * rh)
          if (fill < 0.6) continue // a window is a filled rectangle
          val dx = (bb.x + bb.width / 2.0 - w / 2.0) / (w / 2.0)
          val dy = (bb.y + bb.height / 2.0 - h / 2.0) / (h / 2.0)
          val central = 1.0 - min(1.0, Math.sqrt(dx * dx + dy * dy) / 1.4142)
          val score = fill * (0.5 + 0.5 * central) * (if (kind == "lcd") 1.5 else 1.0)
          out.add(Candidate(kind, bb.x.toDouble() / w, bb.y.toDouble() / h, bb.width.toDouble() / w, bb.height.toDouble() / h, score))
        }
      }

      val hsv = keep(Mat())
      Imgproc.cvtColor(im, hsv, Imgproc.COLOR_BGR2HSV)
      val cyan = keep(Mat())
      Core.inRange(hsv, Scalar(79.0, 41.0, 141.0), Scalar(99.0, 134.0, 255.0), cyan)
      Imgproc.morphologyEx(cyan, cyan, Imgproc.MORPH_CLOSE, rectKernel(0.008))
      Imgproc.morphologyEx(cyan, cyan, Imgproc.MORPH_OPEN, rectKernel(0.02))
      add("lcd", cyan)

      val sigma = max(1.0, 0.004 * min(h, w))
      val vb = keep(Mat())
      Imgproc.GaussianBlur(maxChannel(im, keep), vb, Size(0.0, 0.0), sigma)
      val dark = keep(Mat())
      Imgproc.threshold(vb, dark, 89.0, 255.0, Imgproc.THRESH_BINARY_INV)
      Imgproc.morphologyEx(dark, dark, Imgproc.MORPH_CLOSE, rectKernel(0.06))
      Imgproc.morphologyEx(dark, dark, Imgproc.MORPH_OPEN, rectKernel(0.02))
      add("dark", dark)

      val gray = keep(Mat())
      Imgproc.cvtColor(im, gray, Imgproc.COLOR_BGR2GRAY)
      val g = keep(Mat())
      Imgproc.GaussianBlur(gray, g, Size(0.0, 0.0), sigma)
      val bright = keep(Mat())
      Imgproc.threshold(g, bright, 0.0, 255.0, Imgproc.THRESH_BINARY + Imgproc.THRESH_OTSU)
      Imgproc.morphologyEx(bright, bright, Imgproc.MORPH_CLOSE, rectKernel(0.06))
      Imgproc.morphologyEx(bright, bright, Imgproc.MORPH_OPEN, rectKernel(0.02))
      add("light", bright)

      return out.sortedByDescending { it.score }.take(limit)
    } finally {
      scratch.forEach { it.release() }
    }
  }

  /**
   * Size of the largest blown-out, colourless blob in the band of the frame the display
   * occupies - its bounding box plus `side` box-heights to the left and right - as a share
   * of the box height. A reflection like that hides whatever is under it: digits or the
   * decimal point go missing with no sign of it in what is left ("3190" became "31",
   * "123.4" became "123"); on a dark panel it also cuts the panel short where it reaches
   * the edge, which is why the LED reader looks to the sides as well. Thin bright print
   * such as a "kg" label stays far below the limit.
   */
  private fun glareSize(bgr: Mat, c: MatOfPoint, side: Double, keep: (Mat) -> Mat): Double {
    val bb = Imgproc.boundingRect(c)
    val x0 = max(0, bb.x - (side * bb.height).toInt())
    val x1 = min(bgr.cols(), bb.x + bb.width + (side * bb.height).toInt())
    if (x1 <= x0 || bb.height <= 0) return 0.0
    val hsv = keep(Mat())
    Imgproc.cvtColor(bgr.submat(Rect(x0, bb.y, x1 - x0, bb.height)), hsv, Imgproc.COLOR_BGR2HSV)
    val blown = keep(Mat())
    Core.inRange(hsv, Scalar(0.0, 0.0, GLARE_V), Scalar(179.0, GLARE_S - 1.0, 255.0), blown)
    val dist = keep(Mat())
    Imgproc.distanceTransform(blown, dist, Imgproc.DIST_L2, 3)
    return Core.minMaxLoc(dist).maxVal / bb.height
  }

  /**
   * Edge softness: how many pixels the ink/background transition takes at the outline of
   * the digits, relative to digit height. `v` is the 8-bit image the ink was taken from,
   * `ink` the binary ink (0 / 255) BEFORE it was de-slanted, `mskB` the panel mask.
   */
  private fun edgeSoftness(v: Mat, ink: Mat, mskB: ByteArray, hd: Int, keep: (Mat) -> Mat): Double {
    val n = v.rows() * v.cols()
    val vs = keep(Mat())
    Imgproc.GaussianBlur(v, vs, Size(0.0, 0.0), 1.0)
    val vf = keep(Mat())
    vs.convertTo(vf, CvType.CV_32F)
    val gx = keep(Mat())
    val gy = keep(Mat())
    Imgproc.Sobel(vf, gx, CvType.CV_32F, 1, 0, 3, 1.0 / 8.0, 0.0)
    Imgproc.Sobel(vf, gy, CvType.CV_32F, 0, 1, 3, 1.0 / 8.0, 0.0)
    val mag = keep(Mat())
    Core.magnitude(gx, gy, mag)
    val edge = keep(Mat())
    Imgproc.morphologyEx(ink, edge, Imgproc.MORPH_GRADIENT, keep(Mat.ones(3, 3, CvType.CV_8U)))
    val inkB = ByteArray(n).also { ink.get(0, 0, it) }
    val edgeB = ByteArray(n).also { edge.get(0, 0, it) }
    val vfA = FloatArray(n).also { vf.get(0, 0, it) }
    val magA = FloatArray(n).also { mag.get(0, 0, it) }
    val onInk = ArrayList<Float>()
    val offInk = ArrayList<Float>()
    val onEdge = ArrayList<Float>()
    for (i in 0 until n) {
      if (inkB[i].toInt() != 0) onInk.add(vfA[i]) else if (mskB[i].toInt() != 0) offInk.add(vfA[i])
      if (edgeB[i].toInt() != 0) onEdge.add(magA[i])
    }
    if (onEdge.isEmpty() || onInk.isEmpty() || offInk.isEmpty()) return 0.0
    val contrast = abs(percentileF(onInk, 50.0) - percentileF(offInk, 50.0))
    val grad = percentileF(onEdge, 75.0)
    return (contrast / max(grad, 1e-3)) / max(hd, 1)
  }

  /**
   * Morphological background estimate with an elliptical kernel of size kb. `fast` computes
   * it at quarter resolution (kernel a quarter the size) and scales it back up.
   */
  private fun background(g: Mat, op: Int, kb: Int, fast: Boolean, keep: (Mat) -> Mat): Mat {
    val out = keep(Mat())
    if (!fast) {
      Imgproc.morphologyEx(g, out, op, keep(Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(kb.toDouble(), kb.toDouble()))))
      return out
    }
    val small = keep(Mat())
    Imgproc.resize(g, small, Size(), 0.25, 0.25, Imgproc.INTER_AREA)
    val ks = max(3, kb / 4) or 1
    val est = keep(Mat())
    Imgproc.morphologyEx(small, est, op, keep(Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, Size(ks.toDouble(), ks.toDouble()))))
    Imgproc.resize(est, out, Size(g.cols().toDouble(), g.rows().toDouble()), 0.0, 0.0, Imgproc.INTER_LINEAR)
    return out
  }

  // numpy.percentile (linear interpolation) over float samples
  private fun percentileF(values: List<Float>, p: Double): Double {
    val sorted = values.sorted()
    val pos = p / 100.0 * (sorted.size - 1)
    val lo = floor(pos).toInt()
    val hi = ceil(pos).toInt()
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
  }

  private fun shearMat(s: Double, hh: Int): Mat {
    val m = Mat(2, 3, CvType.CV_32F)
    m.put(0, 0, floatArrayOf(1f, s.toFloat(), (-s * hh / 2).toFloat(), 0f, 1f, 0f))
    return m
  }

  /** A copy of `bin` without the components `drop` picks. */
  private fun dropComponents(bin: Mat, keep: (Mat) -> Mat, drop: (Comp) -> Boolean): Mat {
    val labels = keep(Mat())
    val stats = keep(Mat())
    val n = Imgproc.connectedComponentsWithStats(bin, labels, stats, keep(Mat()))
    val st = IntArray(n * 5).also { stats.get(0, 0, it) }
    val out = keep(bin.clone())
    val sel = keep(Mat())
    for (i in 1 until n) {
      val c = Comp(st[i * 5], st[i * 5 + 1], st[i * 5 + 2], st[i * 5 + 3], st[i * 5 + 4])
      if (!drop(c)) continue
      val r = Rect(c.x, c.y, c.w, c.h)
      Core.compare(labels.submat(r), Scalar(i.toDouble()), sel, Core.CMP_EQ)
      out.submat(r).setTo(Scalar(0.0), sel)
    }
    return out
  }

  private fun components(bin: Mat, keep: (Mat) -> Mat): List<Comp> {
    val labels = keep(Mat())
    val stats = keep(Mat())
    val cent = keep(Mat())
    val n = Imgproc.connectedComponentsWithStats(bin, labels, stats, cent)
    val st = IntArray(n * 5).also { stats.get(0, 0, it) }
    return (1 until n).map { Comp(st[it * 5], st[it * 5 + 1], st[it * 5 + 2], st[it * 5 + 3], st[it * 5 + 4]) }
  }

  // numpy.percentile (linear interpolation) over a uint8 histogram
  private fun percentile(hist: IntArray, n: Int, p: Double): Double {
    fun at(idx: Int): Double {
      var acc = 0
      for (v in 0..255) {
        acc += hist[v]
        if (idx < acc) return v.toDouble()
      }
      return 255.0
    }
    val pos = p / 100.0 * (n - 1)
    val lo = floor(pos).toInt()
    val hi = ceil(pos).toInt()
    val a = at(lo)
    val b = at(hi)
    return a + (b - a) * (pos - lo)
  }

  // int(np.median(values)): mean of the two middle values for even counts, truncated
  private fun median(v: List<Int>): Int {
    val s = v.sorted()
    val m = s.size
    return if (m % 2 == 1) s[m / 2] else ((s[m / 2 - 1] + s[m / 2]) / 2.0).toInt()
  }
}
