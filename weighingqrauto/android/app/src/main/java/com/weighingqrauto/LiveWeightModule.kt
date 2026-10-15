package com.weighingqrauto

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import androidx.camera.view.PreviewView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.UIManagerHelper
import com.paddle.ocr.sevenseg.SevenSegmentDecoder
import com.paddle.ocr.util.OpenCVUtils
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

// Live scale-display reading. Takes the frame the camera preview is showing
// right now (no photo is captured), cuts out the area of the on-screen guide
// box and reads the digits with the seven-segment decoder. Nothing is stored
// and no weight is saved here: the result is only shown to the user.
class LiveWeightModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

  // One frame at a time, off the UI thread.
  private val worker = Executors.newSingleThreadExecutor()
  private var lastDebugAt = 0L
  private var debugSlot = 0
  private var fixturesServed = false

  override fun getName() = "LiveWeight"

  private fun findPreview(view: View?): PreviewView? {
    if (view is PreviewView) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) findPreview(view.getChildAt(i))?.let { return it }
    }
    return null
  }

  // viewTag: any native view that contains the camera preview (the camera
  //   view itself or a non-collapsed wrapper of the same size).
  // box*: the guide box as fractions (0..1) of that view.
  // saveCrop: also write the cut-out area to the app cache and return its
  //   uri, so the unit label ("kg" / "g") can be read from it.
  // saveFrame: keep this frame for the user to review - the whole frame
  //   (frameUri) and just the display that was found in it (displayUri).
  // Resolves {ok, text?, kind?, reason?, detail?, ms, cropUri?, box?,
  // frameUri?, displayUri?, crop?}. box is where the display was found, as
  // fractions of the view. A frame that cannot be read is an ordinary result
  // with ok=false, never a rejection.
  @ReactMethod
  fun read(
      viewTag: Double,
      boxX: Double,
      boxY: Double,
      boxW: Double,
      boxH: Double,
      saveCrop: Boolean,
      saveFrame: Boolean,
      promise: Promise,
  ) {
    val tag = viewTag.toInt()
    val tCall = System.currentTimeMillis()
    ctx.runOnUiQueueThread {
      val frame: Bitmap? =
          try {
            // PreviewView.getBitmap must be called on the UI thread.
            findPreview(UIManagerHelper.getUIManagerForReactTag(ctx, tag)?.resolveView(tag))?.bitmap
          } catch (e: Throwable) {
            null
          }
      if (frame == null) {
        promise.resolve(Arguments.createMap().apply {
          putBoolean("ok", false)
          putString("reason", "no-frame")
        })
        return@runOnUiQueueThread
      }
      val grabMs = System.currentTimeMillis() - tCall
      worker.execute {
        try {
          promise.resolve(decode(frame, boxX, boxY, boxW, boxH, saveCrop, saveFrame).apply { putDouble("grabMs", grabMs.toDouble()) })
        } catch (e: Throwable) {
          promise.reject("LIVE_WEIGHT_ERROR", e.message ?: e.toString(), e)
        } finally {
          frame.recycle()
        }
      }
    }
  }

  private fun decode(frame: Bitmap, bx: Double, by: Double, bw: Double, bh: Double, saveCrop: Boolean, saveFrame: Boolean) =
      Arguments.createMap().apply {
        val t0 = System.currentTimeMillis()
        if (!OpenCVUtils.init(ctx)) throw IllegalStateException("OpenCV native library failed to load")

        // The decoder finds the display itself, so it gets the guide box plus
        // a margin: the display's frame usually reaches past the digits.
        val x0 = ((bx - 0.10 * bw).coerceIn(0.0, 1.0) * frame.width).toInt()
        val y0 = ((by - 0.40 * bh).coerceIn(0.0, 1.0) * frame.height).toInt()
        val x1 = ((bx + 1.10 * bw).coerceIn(0.0, 1.0) * frame.width).toInt()
        val y1 = ((by + 1.40 * bh).coerceIn(0.0, 1.0) * frame.height).toInt()
        if (x1 - x0 < 32 || y1 - y0 < 32) {
          putBoolean("ok", false)
          putString("reason", "box-too-small")
          return@apply
        }
        var crop = Bitmap.createBitmap(frame, x0, y0, x1 - x0, y1 - y0)
        // 900 px across is plenty for the digits and keeps each frame quick.
        if (crop.width > 900) {
          val scaled = Bitmap.createScaledBitmap(crop, 900, maxOf(1, crop.height * 900 / crop.width), true)
          if (scaled !== crop) {
            crop.recycle()
            crop = scaled
          }
        }

        val r = SevenSegmentDecoder.decodeLive(crop)
        putBoolean("ok", r.ok)
        if (r.ok) {
          putString("text", r.text)
          putString("kind", r.kind)
        } else {
          putString("reason", r.reason)
          r.detail?.let { putString("detail", it) }
        }
        // The display window, mapped from the cut-out area back to the frame
        // (which is what the view shows).
        val found = r.box?.let {
          doubleArrayOf(
              (x0 + it[0] * (x1 - x0)) / frame.width, (y0 + it[1] * (y1 - y0)) / frame.height,
              it[2] * (x1 - x0) / frame.width, it[3] * (y1 - y0) / frame.height)
        }
        found?.let { putMap("box", boxMap(it[0], it[1], it[2], it[3])) }

        if (saveFrame) {
          // New files each time (an image shown on screen must not change
          // under it); earlier captures are removed.
          ctx.cacheDir.listFiles { f -> f.name.startsWith("weight_live_cap_") }?.forEach { it.delete() }
          val frameFile = File(ctx.cacheDir, "weight_live_cap_${t0}_frame.jpg")
          FileOutputStream(frameFile).use { frame.compress(Bitmap.CompressFormat.JPEG, 95, it) }
          putString("frameUri", "file://${frameFile.absolutePath}")
          if (found != null) {
            val p = padded(found[0], found[1], found[2], found[3])
            val dx = (p[0] * frame.width).toInt().coerceIn(0, frame.width - 1)
            val dy = (p[1] * frame.height).toInt().coerceIn(0, frame.height - 1)
            val dw = (p[2] * frame.width).toInt().coerceIn(1, frame.width - dx)
            val dh = (p[3] * frame.height).toInt().coerceIn(1, frame.height - dy)
            val display = Bitmap.createBitmap(frame, dx, dy, dw, dh)
            val displayFile = File(ctx.cacheDir, "weight_live_cap_${t0}_display.jpg")
            FileOutputStream(displayFile).use { display.compress(Bitmap.CompressFormat.JPEG, 95, it) }
            if (display !== frame) display.recycle()
            putString("displayUri", "file://${displayFile.absolutePath}")
            putMap("crop", boxMap(p[0], p[1], p[2], p[3]))
          }
        }

        // TEMPORARY diagnostics (debug builds only): about once a second the
        // frame just read is kept - the 24 most recent - with what the reader
        // made of it, so displays it cannot read can be looked at afterwards.
        if (BuildConfig.DEBUG && t0 - lastDebugAt >= 1000) {
          lastDebugAt = t0
          val slot = debugSlot++ % 24
          val outcome = if (r.ok) "ok ${r.text} ${r.kind}" else "no ${r.reason} ${r.detail ?: ""}"
          try {
            FileOutputStream(File(ctx.cacheDir, "weight_live_dbg_%02d.jpg".format(slot))).use {
              crop.compress(Bitmap.CompressFormat.JPEG, 90, it)
            }
            File(ctx.cacheDir, "weight_live_dbg_%02d.txt".format(slot)).writeText("$t0 $outcome")
          } catch (e: Throwable) {
            // diagnostics must never break a read
          }
          android.util.Log.i("LiveWeight", "frame $slot: $outcome")
        }

        if (saveCrop) {
          // One fixed file, overwritten each time.
          val file = File(ctx.cacheDir, "weight_live_crop.jpg")
          FileOutputStream(file).use { crop.compress(Bitmap.CompressFormat.JPEG, 92, it) }
          putString("cropUri", "file://${file.absolutePath}")
        }
        if (crop !== frame) crop.recycle()
        putDouble("ms", (System.currentTimeMillis() - t0).toDouble())
        // TEMPORARY diagnostics (debug builds only): every frame's reading and time
        if (BuildConfig.DEBUG) {
          android.util.Log.i("LiveWeight", "read ${System.currentTimeMillis() - t0}ms " +
              (if (r.ok) "ok ${r.text}" else "no ${r.reason} ${r.detail ?: ""}"))
        }
      }

  // Reads a still image (the display the user framed on a captured photo).
  // imagePath: absolute path or file:// URI of an upright image.
  // Resolves the same shape as read(): {ok, text?, kind?, reason?, detail?, ms}.
  @ReactMethod
  fun readImage(imagePath: String, promise: Promise) {
    worker.execute {
      try {
        val t0 = System.currentTimeMillis()
        if (!OpenCVUtils.init(ctx)) throw IllegalStateException("OpenCV native library failed to load")
        val path = if (imagePath.startsWith("file:")) Uri.parse(imagePath).path else imagePath
        // decoded at no more than ~1200 px across: the size the reader is validated at
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= 1200) sample *= 2
        var bmp = BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: throw IllegalArgumentException("Cannot decode image: $imagePath")
        if (bmp.width > 1200) {
          val scaled = Bitmap.createScaledBitmap(bmp, 1200, maxOf(1, bmp.height * 1200 / bmp.width), true)
          if (scaled !== bmp) {
            bmp.recycle()
            bmp = scaled
          }
        }
        val r = SevenSegmentDecoder.decodeLive(bmp)
        bmp.recycle()
        promise.resolve(Arguments.createMap().apply {
          putBoolean("ok", r.ok)
          if (r.ok) {
            putString("text", r.text)
            putString("kind", r.kind)
          } else {
            putString("reason", r.reason)
            r.detail?.let { putString("detail", it) }
          }
          r.box?.let { putMap("box", boxMap(it[0], it[1], it[2], it[3])) }
          putDouble("ms", (System.currentTimeMillis() - t0).toDouble())
        })
      } catch (e: Throwable) {
        promise.reject("LIVE_WEIGHT_ERROR", e.message ?: e.toString(), e)
      }
    }
  }

  private fun boxMap(x: Double, y: Double, w: Double, h: Double): WritableMap =
      Arguments.createMap().apply {
        putDouble("x", x)
        putDouble("y", y)
        putDouble("w", w)
        putDouble("h", h)
      }

  // A display window plus a margin (fractions of the image), kept inside the
  // image: the window's edge is not exactly where the digits' surroundings
  // end, and cutting into a digit is worse than a little background.
  private fun padded(x: Double, y: Double, w: Double, h: Double): DoubleArray {
    val x0 = (x - PAD_X * w).coerceIn(0.0, 1.0)
    val y0 = (y - PAD_Y * h).coerceIn(0.0, 1.0)
    val x1 = (x + (1 + PAD_X) * w).coerceIn(0.0, 1.0)
    val y1 = (y + (1 + PAD_Y) * h).coerceIn(0.0, 1.0)
    return doubleArrayOf(x0, y0, x1 - x0, y1 - y0)
  }

  // An upright (EXIF-rotated) bitmap of a photo, long side bounded to ~4096 -
  // the same picture ScaleImageModule crops from, so fractions mean the same.
  private fun loadUpright(uri: String): Bitmap {
    val parsed = if (uri.startsWith("/")) Uri.fromFile(File(uri)) else Uri.parse(uri)
    val resolver = ctx.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(parsed).use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 4096) sample *= 2
    val bmp =
        resolver.openInputStream(parsed).use {
          BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: throw IllegalArgumentException("Cannot decode image: $uri")
    val orientation =
        resolver.openInputStream(parsed).use {
          ExifInterface(it!!).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        }
    val m = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
    }
    if (m.isIdentity) return bmp
    val rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    if (rotated !== bmp) bmp.recycle()
    return rotated
  }

  // The reader on one area of a photo (fractions of it), at the size it is
  // validated at. The returned box is in fractions of the whole photo.
  private fun readArea(full: Bitmap, x: Double, y: Double, w: Double, h: Double): SevenSegmentDecoder.Result {
    val px = (x * full.width).toInt().coerceIn(0, full.width - 1)
    val py = (y * full.height).toInt().coerceIn(0, full.height - 1)
    val pw = (w * full.width).toInt().coerceIn(1, full.width - px)
    val ph = (h * full.height).toInt().coerceIn(1, full.height - py)
    if (pw < 32 || ph < 32) return SevenSegmentDecoder.Result(false, null, "area-too-small")
    var area = Bitmap.createBitmap(full, px, py, pw, ph)
    if (area.width > 1200) {
      val scaled = Bitmap.createScaledBitmap(area, 1200, maxOf(1, area.height * 1200 / area.width), true)
      if (scaled !== area) {
        if (area !== full) area.recycle()
        area = scaled
      }
    }
    val r = SevenSegmentDecoder.decodeLive(area)
    if (area !== full) area.recycle()
    return r.copy(box = r.box?.let {
      listOf(
          (px + it[0] * pw) / full.width, (py + it[1] * ph) / full.height,
          it[2] * pw / full.width, it[3] * ph / full.height)
    })
  }

  // Finds the display in a whole photo, with no help from the user.
  // The reader is tried on the whole photo, then on each area that looks like
  // a display window (SevenSegmentDecoder.locateCandidates). An area counts
  // as the display only when digits were actually found in it - not because
  // it is the biggest, the brightest or the reddest thing in the picture.
  // Resolves {found, certain, ok, text?, kind?, reason?, detail?, box?, crop?,
  //   displayWidthPx?, displayHeightPx?, cutOff?, tooSmall?, imageWidth,
  //   imageHeight, tried, ms}
  //   found    a display window with a row of digits in it was located
  //   certain  ... and it is whole, large enough, and its digits were read
  //   box      the window, crop the window plus a margin - fractions of the
  //            upright photo, as ScaleImage.process takes them
  @ReactMethod
  fun detect(uri: String, promise: Promise) {
    worker.execute {
      try {
        val t0 = System.currentTimeMillis()
        if (!OpenCVUtils.init(ctx)) throw IllegalStateException("OpenCV native library failed to load")
        val full = loadUpright(uri)
        try {
          var tried = 1
          var best = readArea(full, 0.0, 0.0, 1.0, 1.0)
          if (!best.ok) {
            var unreadable = if (best.reason in DISPLAY_SEEN && best.box != null) best else null
            for (c in SevenSegmentDecoder.locateCandidates(full)) {
              val p = padded(c.x, c.y, c.w, c.h)
              val r = readArea(full, p[0], p[1], p[2], p[3])
              tried++
              if (r.ok) {
                best = r
                break
              }
              if (unreadable == null && r.reason in DISPLAY_SEEN && r.box != null) unreadable = r
            }
            if (!best.ok && unreadable != null) best = unreadable
          }

          val box = best.box
          val found = box != null && (best.ok || best.reason in DISPLAY_SEEN)
          promise.resolve(Arguments.createMap().apply {
            putBoolean("ok", best.ok)
            if (best.ok) {
              putString("text", best.text)
              putString("kind", best.kind)
            } else {
              putString("reason", best.reason)
              best.detail?.let { putString("detail", it) }
            }
            putBoolean("found", found)
            var certain = false
            if (box != null) {
              putMap("box", boxMap(box[0], box[1], box[2], box[3]))
              val p = padded(box[0], box[1], box[2], box[3])
              putMap("crop", boxMap(p[0], p[1], p[2], p[3]))
              val wPx = box[2] * full.width
              val hPx = box[3] * full.height
              // A window that runs off the photo may have digits out of view.
              // So may a row of digits the reader itself found reaching the edge.
              val cutOff = best.reason == "display-cut-off" ||
                  box[0] <= EDGE || box[1] <= EDGE || box[0] + box[2] >= 1 - EDGE || box[1] + box[3] >= 1 - EDGE
              val tooSmall = hPx < MIN_DISPLAY_PX
              putDouble("displayWidthPx", wPx)
              putDouble("displayHeightPx", hPx)
              putBoolean("cutOff", cutOff)
              putBoolean("tooSmall", tooSmall)
              certain = found && best.ok && !cutOff && !tooSmall
            }
            putBoolean("certain", certain)
            putInt("imageWidth", full.width)
            putInt("imageHeight", full.height)
            putInt("tried", tried)
            putDouble("ms", (System.currentTimeMillis() - t0).toDouble())
          })
        } finally {
          full.recycle()
        }
      } catch (e: Throwable) {
        promise.reject("LIVE_WEIGHT_ERROR", e.message ?: e.toString(), e)
      }
    }
  }

  // TEMPORARY (debug builds only): the image files in <app cache>/ocr_fixtures,
  // once per app start, for the on-device OCR check (src/dev/ocrFixtureHarness.js).
  // Empty when that folder does not exist - i.e. always, outside a test run.
  @ReactMethod
  fun fixtureFiles(promise: Promise) {
    val out = Arguments.createArray()
    if (BuildConfig.DEBUG && !fixturesServed) {
      val files = File(ctx.cacheDir, "ocr_fixtures").listFiles { f -> f.extension.lowercase() in setOf("png", "jpg", "jpeg") }
      if (files != null && files.isNotEmpty()) {
        fixturesServed = true
        files.sortedBy { it.name }.forEach { out.pushString(it.absolutePath) }
      }
    }
    promise.resolve(out)
  }

  companion object {
    // Margin kept around a detected display window, as a share of its size.
    private const val PAD_X = 0.12
    private const val PAD_Y = 0.25
    // Closer than this to the photo's edge (fraction of the photo) counts as touching it.
    private const val EDGE = 0.005
    // A display window lower than this many pixels of the photo is too small to trust.
    private const val MIN_DISPLAY_PX = 48
    // Refusals that mean "a display with digits is there, but cannot be read
    // with certainty" - as opposed to "nothing that looks like a display".
    private val DISPLAY_SEEN = setOf(
        "glare", "blurred", "ambiguous-segment", "unknown-pattern", "multiple-dots",
        "narrow-unrecognised", "merged-digits", "unassigned-ink", "display-cut-off")
  }

  override fun invalidate() {
    super.invalidate()
    worker.shutdown()
  }
}
