
package expo.modules.cctvtalkback

import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer

/**
 * Parser untuk mencari unit video H.264/H.265
 * dalam rekaman kamera XM/DVRIP.
 */
internal object XmClipParser {

  data class VideoTrack(
    val codec: String,
    val width: Int,
    val height: Int,
    val sps: ByteArray,
    val pps: ByteArray?,
    val vps: ByteArray?,
    val frames: List<ByteArray>
  )

  /**
   * Mengubah paket media DVRIP/XM menjadi aliran video Annex-B.
   * Format yang dikenali:
   * FC/FE = keyframe dengan header 16 byte
   * FD    = frame lanjutan dengan header 8 byte
   */
  private fun unwrapDvripFrames(raw: ByteArray): ByteArray {
    val output = ByteArrayOutputStream()
    var i = 0
    var recognized = 0

    fun u8(index: Int): Int =
      raw[index].toInt() and 0xff

    fun le32(index: Int): Long =
      (u8(index).toLong()) or
      (u8(index + 1).toLong() shl 8) or
      (u8(index + 2).toLong() shl 16) or
      (u8(index + 3).toLong() shl 24)

    while (i + 4 <= raw.size) {
      if (
        raw[i] != 0.toByte() ||
        raw[i + 1] != 0.toByte() ||
        raw[i + 2] != 1.toByte()
      ) {
        i++
        continue
      }

      val type = u8(i + 3)

      if (type == 0xFC || type == 0xFE) {
        if (i + 16 > raw.size) break

        val length = le32(i + 12)
        if (length <= 0 || length > raw.size - i - 16) {
          i++
          continue
        }

        val start = i + 16
        val end = start + length.toInt()
        output.write(raw, start, length.toInt())
        recognized++
        i = end
      } else if (type == 0xFD) {
        if (i + 8 > raw.size) break

        val length = le32(i + 4)
        if (length <= 0 || length > raw.size - i - 8) {
          i++
          continue
        }

        val start = i + 8
        val end = start + length.toInt()
        output.write(raw, start, length.toInt())
        recognized++
        i = end
      } else {
        i++
      }
    }

    // Jangan merusak data yang ternyata sudah berupa Annex-B.
    return if (recognized > 0) output.toByteArray() else raw
  }

  fun parse(raw: ByteArray): VideoTrack {
    require(raw.isNotEmpty()) {
      "Data rekaman kosong. Unduhan DVRIP belum menghasilkan data."
    }

    val videoData = unwrapDvripFrames(raw)
val nals = splitAnnexB(videoData)

    require(nals.isNotEmpty()) {
      "Format rekaman tidak memiliki pemisah NAL Annex-B."
    }

    // Coba format H.264 terlebih dahulu.
    val avcSps = nals.firstOrNull {
      it.isNotEmpty() && (it[0].toInt() and 0x1f) == 7
    }

    if (avcSps != null) {
      val pps = nals.firstOrNull {
        it.isNotEmpty() && (it[0].toInt() and 0x1f) == 8
      }

      val frames = nals.filter {
        it.isNotEmpty() &&
          ((it[0].toInt() and 0x1f) in 1..5)
      }

      require(pps != null && frames.isNotEmpty()) {
        "Data H.264 belum memiliki PPS atau frame video."
      }

      val dimensions = AvcSps.dimensions(avcSps)

      return VideoTrack(
        codec = "video/avc",
        width = dimensions.first,
        height = dimensions.second,
        sps = avcSps,
        pps = pps,
        vps = null,
        frames = frames
      )
    }

    // Jika bukan H.264, coba HEVC/H.265.
    val vps = nals.firstOrNull {
      it.size >= 2 && ((it[0].toInt() and 0x7e) shr 1) == 32
    }
    val hevcSps = nals.firstOrNull {
      it.size >= 2 && ((it[0].toInt() and 0x7e) shr 1) == 33
    }
    val hevcPps = nals.firstOrNull {
      it.size >= 2 && ((it[0].toInt() and 0x7e) shr 1) == 34
    }

    require(hevcSps != null && hevcPps != null) {
      "Parameter SPS/PPS H.264/H.265 tidak ditemukan. Rekaman mungkin masih memakai pembungkus XM."
    }

    val frames = nals.filter {
      it.size >= 2 && (((it[0].toInt() and 0x7e) shr 1) in 0..31)
    }

    require(frames.isNotEmpty()) {
      "Frame H.265 tidak ditemukan dalam data rekaman."
    }

    val dimensions = HevcSps.dimensions(hevcSps)

    return VideoTrack(
      codec = "video/hevc",
      width = dimensions.first,
      height = dimensions.second,
      sps = hevcSps,
      pps = hevcPps,
      vps = vps,
      frames = frames
    )
  }

  fun splitAnnexB(data: ByteArray): List<ByteArray> {
    val starts = mutableListOf<Pair<Int, Int>>()
    var i = 0

    while (i + 3 <= data.size) {
      if (
        i + 4 <= data.size &&
        data[i] == 0.toByte() &&
        data[i + 1] == 0.toByte() &&
        data[i + 2] == 0.toByte() &&
        data[i + 3] == 1.toByte()
      ) {
        starts.add(i to 4)
        i += 4
      } else if (
        data[i] == 0.toByte() &&
        data[i + 1] == 0.toByte() &&
        data[i + 2] == 1.toByte()
      ) {
        starts.add(i to 3)
        i += 3
      } else {
        i++
      }
    }

    val result = mutableListOf<ByteArray>()

    for (index in starts.indices) {
      val (start, prefixLength) = starts[index]
      val end = if (index + 1 < starts.size) {
        starts[index + 1].first
      } else {
        data.size
      }

      if (start + prefixLength < end) {
        var actualEnd = end
        while (actualEnd > start + prefixLength &&
          data[actualEnd - 1] == 0.toByte()
        ) {
          actualEnd--
        }

        if (actualEnd > start + prefixLength) {
          result.add(
            data.copyOfRange(start + prefixLength, actualEnd)
          )
        }
      }
    }

    return result
  }
}

/**
 * Menulis frame video yang sudah dipisahkan ke file MP4.
 */
internal object XmHevcMuxer {

  private val START_CODE = byteArrayOf(0, 0, 0, 1)

  fun writeMp4(
    raw: ByteArray,
    outputFile: File,
    durationUs: Long? = null,
    fps: Int = 12
  ) {
    val track = XmClipParser.parse(raw)

    require(track.width > 0 && track.height > 0) {
      "Resolusi video tidak valid: ${track.width}x${track.height}"
    }

    val keyFrameIndex = track.frames.indexOfFirst { nal ->
      if (track.codec == "video/avc") {
        (nal[0].toInt() and 0x1f) == 5
      } else {
        val type = (nal[0].toInt() and 0x7e) shr 1
        type in 16..21
      }
    }

    require(keyFrameIndex >= 0) {
      "Frame awal/keyframe video tidak ditemukan."
    }

    val frames = track.frames.drop(keyFrameIndex)

    val format = MediaFormat.createVideoFormat(
      track.codec,
      track.width,
      track.height
    )

    val csd0 = ByteArrayOutputStream()

    if (track.codec == "video/hevc" && track.vps != null) {
      csd0.write(START_CODE)
      csd0.write(track.vps)
    }

    csd0.write(START_CODE)
    csd0.write(track.sps)

    format.setByteBuffer(
      "csd-0",
      ByteBuffer.wrap(csd0.toByteArray())
    )

    track.pps?.let {
      format.setByteBuffer(
        "csd-1",
        ByteBuffer.wrap(START_CODE + it)
      )
    }

    outputFile.parentFile?.mkdirs()

    if (outputFile.exists()) {
      outputFile.delete()
    }

    val muxer = MediaMuxer(
      outputFile.absolutePath,
      MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4
    )

    var started = false

    try {
      val videoTrack = muxer.addTrack(format)
      muxer.start()
      started = true

      val info = MediaCodec.BufferInfo()

      val frameDuration = if (
        durationUs != null &&
        durationUs > 0
      ) {
        (durationUs / frames.size).coerceAtLeast(1L)
      } else {
        1_000_000L / fps.coerceAtLeast(1)
      }

      frames.forEachIndexed { index, nal ->
        val sample = ByteArray(4 + nal.size)
        System.arraycopy(START_CODE, 0, sample, 0, 4)
        System.arraycopy(nal, 0, sample, 4, nal.size)

        val isKey = if (track.codec == "video/avc") {
          (nal[0].toInt() and 0x1f) == 5
        } else {
          ((nal[0].toInt() and 0x7e) shr 1) in 16..21
        }

        info.set(
          0,
          sample.size,
          index.toLong() * frameDuration,
          if (isKey) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
        )

        muxer.writeSampleData(
          videoTrack,
          ByteBuffer.wrap(sample),
          info
        )
      }

      muxer.stop()
      started = false
    } finally {
      if (started) {
        runCatching { muxer.stop() }
      }
      muxer.release()
    }

    require(outputFile.exists() && outputFile.length() > 0) {
      "File MP4 gagal dibuat."
    }
  }
}

/** Membaca dimensi video dari SPS H.264. */
internal object AvcSps {

  fun dimensions(sps: ByteArray): Pair<Int, Int> {
    require(sps.size >= 4) { "SPS H.264 terlalu pendek." }

    val br = BitReader(unescape(sps, 1))

    val profile = br.read(8)
    br.read(8)
    br.read(8)
    br.ue()

    if (profile in intArrayOf(
        100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135
      )
    ) {
      val chroma = br.ue()
      if (chroma == 3) br.read(1)
      br.ue()
      br.ue()
      br.read(1)

      if (br.read(1) == 1) {
        val count = if (chroma == 3) 12 else 8
        repeat(count) { index ->
          if (br.read(1) == 1) {
            var last = 8
            var next = 8
            val size = if (index < 6) 16 else 64

            repeat(size) {
              if (next != 0) {
                next = (last + br.se() + 256) % 256
              }
              if (next != 0) last = next
            }
          }
        }
      }
    }

    br.ue()
    val poc = br.ue()

    when (poc) {
      0 -> br.ue()
      1 -> {
        br.read(1)
        br.se()
        br.se()
        repeat(br.ue().coerceAtMost(256)) { br.se() }
      }
    }

    br.ue()
    br.read(1)

    val width = (br.ue() + 1) * 16
    val heightUnits = br.ue() + 1
    val frameOnly = br.read(1)

    if (frameOnly == 0) br.read(1)
    br.read(1)

    var w = width
    var h = heightUnits * 16 * (if (frameOnly == 0) 2 else 1)

    if (br.read(1) == 1) {
      val left = br.ue()
      val right = br.ue()
      val top = br.ue()
      val bottom = br.ue()

      w -= (left + right) * 2
      h -= (top + bottom) * 2 * (if (frameOnly == 0) 2 else 1)
    }

    return w to h
  }

  private fun unescape(data: ByteArray, offset: Int): ByteArray {
    val out = ByteArrayOutputStream()
    var zeros = 0

    for (i in offset until data.size) {
      val b = data[i].toInt() and 0xff

      if (
        zeros >= 2 &&
        b == 3 &&
        i + 1 < data.size &&
        (data[i + 1].toInt() and 0xff) <= 3
      ) {
        zeros = 0
      } else {
        out.write(b)
        zeros = if (b == 0) zeros + 1 else 0
      }
    }

    return out.toByteArray()
  }
}

/** Membaca bit dan Exp-Golomb dari data SPS. */
internal class BitReader(private val data: ByteArray) {
  private var bit = 0

  fun read(count: Int): Int {
    require(count in 0..31) { "Jumlah bit tidak valid." }

    var result = 0
    repeat(count) {
      val byteIndex = bit ushr 3

      require(byteIndex < data.size) {
        "Data SPS terpotong."
      }

      val value = data[byteIndex].toInt() and 0xff
      result = (result shl 1) or
        ((value shr (7 - (bit and 7))) and 1)

      bit++
    }

    return result
  }

  fun skip(count: Int) {
    require(count >= 0) {
      "Jumlah bit tidak valid."
    }

    repeat(count) {
      read(1)
    }
  }

  fun ue(): Int {
    var zeros = 0

    while (read(1) == 0) {
      zeros++
      require(zeros <= 30) { "Nilai SPS tidak valid." }
    }

    return ((1 shl zeros) - 1) + if (zeros == 0) 0 else read(zeros)
  }

  fun se(): Int {
    val value = ue()
    return if (value % 2 == 0) -(value / 2) else (value + 1) / 2
  }
}

/** Membaca dimensi dasar dari SPS H.265. */
internal object HevcSps {

  fun dimensions(sps: ByteArray): Pair<Int, Int> {
    require(sps.size > 4) { "SPS H.265 terlalu pendek." }

    val br = BitReader(unescape(sps, 2))

    br.read(4)
    val maxSubLayers = br.read(3)
    br.read(1)

    br.read(96)

    val profilePresent = BooleanArray(maxSubLayers)
    val levelPresent = BooleanArray(maxSubLayers)

    for (i in 0 until maxSubLayers) {
      profilePresent[i] = br.read(1) == 1
      levelPresent[i] = br.read(1) == 1
    }

    if (maxSubLayers > 0) {
      for (i in maxSubLayers until 8) br.read(2)
    }

    for (i in 0 until maxSubLayers) {
      if (profilePresent[i]) br.skip(88)
      if (levelPresent[i]) br.skip(8)
    }

    br.ue()
    val chroma = br.ue()

    if (chroma == 3) br.read(1)

    val width = br.ue()
    val height = br.ue()

    require(width > 0 && height > 0) {
      "Resolusi H.265 tidak valid."
    }

    return width to height
  }

  private fun unescape(data: ByteArray, offset: Int): ByteArray {
    val out = ByteArrayOutputStream()
    var zeros = 0

    for (i in offset until data.size) {
      val b = data[i].toInt() and 0xff

      if (
        zeros >= 2 &&
        b == 3 &&
        i + 1 < data.size &&
        (data[i + 1].toInt() and 0xff) <= 3
      ) {
        zeros = 0
      } else {
        out.write(b)
        zeros = if (b == 0) zeros + 1 else 0
      }
    }

    return out.toByteArray()
  }
}
