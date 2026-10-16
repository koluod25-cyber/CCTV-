
package expo.modules.cctvtalkback

/**
 * Removes Xiongmai/XM private wrapper NAL units from
 * Annex-B HEVC video data.
 *
 * HEVC NAL unit types 124..127 are reserved/private wrapper
 * types on the referenced XM firmware. Ordinary HEVC NAL
 * units, including VPS/SPS/PPS and picture data, are retained.
 *
 * This class does not download recordings or create MP4 files.
 */
internal object XmHevcNalFilter {

  private data class NalStart(
    val offset: Int,
    val prefixLength: Int,
  )

  fun stripPrivateWrapperNals(data: ByteArray): ByteArray {
    if (data.isEmpty()) return data

    val starts = findNalStarts(data)

    require(starts.isNotEmpty()) {
      "Data rekaman tidak memiliki start code Annex-B."
    }

    val output = java.io.ByteArrayOutputStream(data.size)

    for (index in starts.indices) {
      val start = starts[index]
      val nalOffset = start.offset + start.prefixLength

      val end = if (index + 1 < starts.size) {
        starts[index + 1].offset
      } else {
        data.size
      }

      // HEVC NAL header requires at least two bytes.
      if (nalOffset + 1 >= end) continue

      val firstHeaderByte = data[nalOffset].toInt() and 0xff
      val nalType = (firstHeaderByte shr 1) and 0x3f

      // XM private wrapper NAL types documented for this firmware.
      if (nalType in 124..127) continue

      output.write(data, start.offset, end - start.offset)
    }

    val cleaned = output.toByteArray()

    require(cleaned.isNotEmpty()) {
      "Semua NAL video tersaring; format rekaman perlu diperiksa."
    }

    return cleaned
  }

  private fun findNalStarts(data: ByteArray): List<NalStart> {
    val result = mutableListOf<NalStart>()
    var index = 0

    while (index + 3 < data.size) {
      if (
        data[index] == 0.toByte() &&
        data[index + 1] == 0.toByte() &&
        data[index + 2] == 1.toByte()
      ) {
        result.add(NalStart(index, 3))
        index += 3
        continue
      }

      if (
        index + 4 <= data.size &&
        data[index] == 0.toByte() &&
        data[index + 1] == 0.toByte() &&
        data[index + 2] == 0.toByte() &&
        data[index + 3] == 1.toByte()
      ) {
        result.add(NalStart(index, 4))
        index += 4
        continue
      }

      index++
    }

    return result
  }
}
