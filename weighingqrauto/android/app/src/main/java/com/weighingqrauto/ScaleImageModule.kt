package com.weighingqrauto

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream

// Image preparation for scale-display OCR: EXIF rotation, crop to the area the
// user framed, upscale small crops, and optional grayscale / contrast stretch /
// Otsu binarisation. Pure Bitmap maths — no extra libraries. Every call writes
// a NEW file in the app cache; the original photo is never modified.
class ScaleImageModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

  override fun getName() = "ScaleImage"

  // crop* are fractions (0..1) of the EXIF-rotated image; a non-positive
  // width/height means "no crop". mode: original | gray | binary | binaryInv
  @ReactMethod
  fun process(
      uri: String,
      cropX: Double,
      cropY: Double,
      cropW: Double,
      cropH: Double,
      mode: String,
      promise: Promise,
  ) {
    Thread {
          try {
            promise.resolve(run(uri, cropX, cropY, cropW, cropH, mode))
          } catch (e: Throwable) {
            promise.reject("SCALE_IMAGE_ERROR", e.message, e)
          }
        }
        .start()
  }

  private fun run(uri: String, cx: Double, cy: Double, cw: Double, ch: Double, mode: String) =
      Arguments.createMap().apply {
        val parsed = Uri.parse(uri)
        val resolver = ctx.contentResolver

        // 1. decode (bounded to ~4096px on the long side)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(parsed).use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 4096) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        var bmp =
            resolver.openInputStream(parsed).use { BitmapFactory.decodeStream(it, null, opts) }
                ?: throw IllegalStateException("Could not decode image")

        // 2. EXIF rotation (so crop fractions match what the user saw)
        val orientation =
            resolver.openInputStream(parsed).use {
              ExifInterface(it!!)
                  .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            }
        val m = Matrix()
        when (orientation) {
          ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
          ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
          ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
          ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
          ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
        }
        if (!m.isIdentity) {
          bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }
        putInt("originalWidth", bmp.width)
        putInt("originalHeight", bmp.height)

        // 3. crop to the user-framed area
        if (cw > 0 && ch > 0) {
          val x = (cx.coerceIn(0.0, 1.0) * bmp.width).toInt()
          val y = (cy.coerceIn(0.0, 1.0) * bmp.height).toInt()
          val w = (cw * bmp.width).toInt().coerceIn(1, bmp.width - x)
          val h = (ch * bmp.height).toInt().coerceIn(1, bmp.height - y)
          bmp = Bitmap.createBitmap(bmp, x, y, w, h)
        }

        // 4. normalise size: small crops are upscaled (<=4x), huge ones reduced
        val longSide = maxOf(bmp.width, bmp.height)
        val target =
            when {
              longSide < 1200 -> minOf(4f, 1200f / longSide)
              longSide > 2400 -> 2400f / longSide
              else -> 1f
            }
        if (target != 1f) {
          bmp =
              Bitmap.createScaledBitmap(
                  bmp,
                  maxOf(1, (bmp.width * target).toInt()),
                  maxOf(1, (bmp.height * target).toInt()),
                  true,
              )
        }

        // 5. pixel processing
        val png = mode == "binary" || mode == "binaryInv"
        if (mode != "original") bmp = grayscaleOrBinary(bmp, mode)

        // 6. write to cache
        val dir = ctx.cacheDir
        val now = System.currentTimeMillis()
        dir.listFiles { f -> f.name.startsWith("weight_ocr_") && now - f.lastModified() > 3600_000 }
            ?.forEach { it.delete() }
        val file = File(dir, "weight_ocr_${mode}_$now.${if (png) "png" else "jpg"}")
        FileOutputStream(file).use {
          bmp.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 95, it)
        }
        putString("uri", "file://" + file.absolutePath)
        putInt("width", bmp.width)
        putInt("height", bmp.height)
      }

  // gray: luminance with a 1%-99% percentile contrast stretch.
  // binary: Otsu threshold on that; the MINORITY class (the digits) is drawn
  //   black on white, whichever polarity the display has (dark-on-light LCD or
  //   bright-on-dark LED). binaryInv is the opposite polarity, for the case
  //   where the minority-class guess is wrong.
  private fun grayscaleOrBinary(src: Bitmap, mode: String): Bitmap {
    val w = src.width
    val h = src.height
    val px = IntArray(w * h)
    src.getPixels(px, 0, w, 0, 0, w, h)

    val gray = IntArray(px.size)
    val hist = IntArray(256)
    for (i in px.indices) {
      val c = px[i]
      val l = (299 * ((c shr 16) and 0xFF) + 587 * ((c shr 8) and 0xFF) + 114 * (c and 0xFF)) / 1000
      gray[i] = l
      hist[l]++
    }

    val lowCut = px.size / 100
    var acc = 0
    var lo = 0
    while (lo < 255) {
      acc += hist[lo]
      if (acc > lowCut) break
      lo++
    }
    acc = 0
    var hi = 255
    while (hi > 0) {
      acc += hist[hi]
      if (acc > lowCut) break
      hi--
    }
    val range = maxOf(1, hi - lo)
    val sh = IntArray(256)
    for (i in gray.indices) {
      val v = ((gray[i] - lo) * 255 / range).coerceIn(0, 255)
      gray[i] = v
      sh[v]++
    }

    if (mode == "gray") {
      for (i in gray.indices) {
        val v = gray[i]
        px[i] = (0xFF shl 24) or (v shl 16) or (v shl 8) or v
      }
    } else {
      // Otsu
      val total = gray.size.toDouble()
      var sumAll = 0.0
      for (t in 0..255) sumAll += t * sh[t].toDouble()
      var wB = 0.0
      var sumB = 0.0
      var best = -1.0
      var threshold = 128
      for (t in 0..255) {
        wB += sh[t]
        if (wB == 0.0) continue
        val wF = total - wB
        if (wF == 0.0) break
        sumB += t * sh[t].toDouble()
        val mB = sumB / wB
        val mF = (sumAll - sumB) / wF
        val between = wB * wF * (mB - mF) * (mB - mF)
        if (between > best) {
          best = between
          threshold = t
        }
      }
      var darkCount = 0
      for (v in gray) if (v <= threshold) darkCount++
      val darkIsMinority = darkCount * 2 < gray.size
      // black = the digits. Normal: digits are the minority class.
      val digitsAreDark = if (mode == "binary") darkIsMinority else !darkIsMinority
      for (i in gray.indices) {
        val dark = gray[i] <= threshold
        val black = if (digitsAreDark) dark else !dark
        px[i] = if (black) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
      }
    }

    val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    out.setPixels(px, 0, w, 0, 0, w, h)
    return out
  }
}
