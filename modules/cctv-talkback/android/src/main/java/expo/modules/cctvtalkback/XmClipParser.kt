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
    require(raw.isNotEmpty()) {
      "Data rekaman DVRIP kosong."
    }

    val startCode = byteArrayOf(0, 0, 0, 1)
    val output = ByteArrayOutputStream()
    var offset = 0
    var recognized = 0

    fun u8(index: Int): Int =
      raw[index].toInt() and 0xff

    fun le32(index: Int): Long =
      u8(index).toLong() or
        (u8(index + 1).toLong() shl 8) or
        (u8(index + 2).toLong() shl 16) or
        (u8(index + 3).toLong() shl 24)

    // Format DVRIP/XM: FC/FE memakai header 16 byte,
    // FD memakai header 8 byte.
    while (offset + 4 <= raw.size) {
      if (
        u8(offset) != 0 ||
        u8(offset + 1) != 0 ||
        u8(offset + 2) != 1
      ) {
        offset++
        continue
      }

      val type = u8(offset + 3)

      val headerSize = when (type) {
        0xFC, 0xFE -> 16
        0xFD -> 8
        else -> {
          offset++
          continue
        }
      }

      if (offset + headerSize > raw.size) break

      val lengthOffset =
        if (headerSize == 16) offset + 12 else offset + 4

      val length = le32(lengthOffset)

      if (
        length <= 0 ||
        length > raw.size.toLong() - offset - headerSize
      ) {
        offset++
        continue
      }

      val payloadStart = offset + headerSize
      val payloadLength = length.toInt()

      output.write(raw, payloadStart, payloadLength)
      recognized++
      offset = payloadStart + payloadLength
    }

    if (recognized > 0) {
      val unwrapped = output.toByteArray()
      if (hasAnnexB(unwrapped)) return unwrapped
    }

    // Data mungkin sudah berupa Annex-B.
    if (hasAnnexB(raw)) return raw

    // Coba format NAL dengan panjang 4 byte big-endian.
    // Hanya terima jika seluruh rangkaian valid dan berisi
    // SPS, PPS, serta frame H.264.
    val converted = ByteArrayOutputStream()
    var pos = 0
    var nalCount = 0
    var hasSps = false
    var hasPps = false
    var hasFrame = false
    var valid = true

    while (pos + 4 <= raw.size) {
      val length =
        (u8(pos).toLong() shl 24) or
        (u8(pos + 1).toLong() shl 16) or
        (u8(pos + 2).toLong() shl 8) or
        u8(pos + 3).toLong()

      pos += 4

      if (length <= 0 || length > raw.size - pos) {
        valid = false
        break
      }

      val nalLength = length.toInt()
      val nalType = u8(pos) and 0x1f

      if (nalType !in 1..23) {
        valid = false
        break
      }

      if (nalType == 7) hasSps = true
      if (nalType == 8) hasPps = true
      if (nalType in 1..5) hasFrame = true

      converted.write(startCode)
      converted.write(raw, pos, nalLength)

      pos += nalLength
      nalCount++
    }

    if (
      valid &&
      pos == raw.size &&
      nalCount >= 3 &&
      hasSps &&
      hasPps &&
      hasFrame
    ) {
      return converted.toByteArray()
    }

    // Jangan mengubah data yang formatnya belum dikenali.
    return raw
  }

  private fun hasAnnexB(data: ByteArray): Boolean {
    var i = 0

    while (i + 3 <= data.size) {
      if (
        data[i] == 0.toByte() &&
        data[i + 1] == 0.toByte() &&
        data[i + 2] == 1.toByte()
      ) {
        return true
      }

      if (
        i + 4 <= data.size &&
        data[i] == 0.toByte() &&
        data[i + 1] == 0.toByte() &&
        data[i + 2] == 0.toByte() &&
        data[i + 3] == 1.toByte()
      ) {
        return true
      }

      i++
    }

    return false
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

  fun parse(raw: ByteArray): VideoTrack {
    require(raw.isNotEmpty()) {
      "Data rekaman DVRIP kosong."
    }

    val normalized = unwrapDvripFrames(raw)
    val nals = splitAnnexB(normalized)

        require(nals.isNotEmpty()) {
      val preview = raw.take(32).joinToString(" ") {
        "%02X".format(it.toInt() and 0xFF)
      }

      "Format video DVRIP belum dikenali. " +
        "Ukuran=${raw.size} byte; " +
        "Data awal=$preview"
    }

    fun avcType(nal: ByteArray): Int =
      nal[0].toInt() and 0x1f

    fun hevcType(nal: ByteArray): Int =
      (nal[0].toInt() shr 1) and 0x3f

    val isHevc = nals.any {
      it.size >= 2 && hevcType(it) == 33
    }

    if (isHevc) {
      val vps = nals.firstOrNull { hevcType(it) == 32 }
      val sps = nals.firstOrNull { hevcType(it) == 33 }
        ?: error("SPS H.265 tidak ditemukan.")
      val pps = nals.firstOrNull { hevcType(it) == 34 }
      val (width, height) = HevcSps.dimensions(sps)
      val frames = nals.filter { hevcType(it) in 0..31 }

      require(frames.isNotEmpty()) {
        "Frame gambar H.265 tidak ditemukan."
      }

      return VideoTrack(
        codec = "video/hevc",
        width = width,
        height = height,
        sps = sps,
        pps = pps,
        vps = vps,
        frames = frames
      )
    }

    val sps = nals.firstOrNull { avcType(it) == 7 }
      ?: error("SPS H.264 tidak ditemukan.")
    val pps = nals.firstOrNull { avcType(it) == 8 }
    val (width, height) = AvcSps.dimensions(sps)
    val frames = nals.filter { avcType(it) in 1..5 }

    require(frames.isNotEmpty()) {
      "Frame gambar H.264 tidak ditemukan."
    }

    return VideoTrack(
      codec = "video/avc",
      width = width,
      height = height,
      sps = sps,
      pps = pps,
      vps = null,
      frames = frames
    )
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
