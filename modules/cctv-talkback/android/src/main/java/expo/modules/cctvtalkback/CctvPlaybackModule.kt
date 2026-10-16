
package expo.modules.cctvtalkback

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import java.util.Locale

class CctvPlaybackModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CctvPlayback")

    AsyncFunction("searchRecordings") {
      host: String,
      username: String,
      password: String,
      startTime: String,
      endTime: String,
      channel: Int ->

      require(host.isNotBlank()) { "IP kamera belum diisi." }
      require(username.isNotBlank()) { "Username kamera belum diisi." }
      require(startTime.isNotBlank() && endTime.isNotBlank()) {
        "Tanggal awal dan akhir wajib diisi."
      }

      Socket().use { socket ->
        socket.connect(InetSocketAddress(host, 34567), 5000)
        socket.soTimeout = 10000

        val input = BufferedInputStream(socket.getInputStream())
        val output = BufferedOutputStream(socket.getOutputStream())
        var sequence = 1L
        var session = 0L

        fun send(id: Int, data: JSONObject, sid: Long = session) {
          val payload = (data.toString() + "\n\u0000")
            .toByteArray(Charsets.UTF_8)
          val header = ByteArray(20)
          header[0] = 0xff.toByte()
          header[1] = 0x00
          putU32(header, 4, sid)
          putU32(header, 8, sequence++)
          header[14] = (id and 0xff).toByte()
          header[15] = ((id shr 8) and 0xff).toByte()
          putU32(header, 16, payload.size.toLong())
          output.write(header)
          output.write(payload)
          output.flush()
        }

        fun read(): JSONObject {
          val header = readExact(input, 20)
          if ((header[0].toInt() and 0xff) != 0xff) {
            error("Header DVRIP kamera tidak valid.")
          }
          val size = readU32(header, 16).toInt()
          require(size in 1..(4 * 1024 * 1024)) {
            "Ukuran respons DVRIP tidak valid."
          }
          val raw = String(readExact(input, size), Charsets.UTF_8)
            .trim('\u0000', '\n', '\r', ' ')
          val jsonStart = raw.indexOf('{')
          val jsonEnd = raw.lastIndexOf('}')
          require(jsonStart >= 0 && jsonEnd >= jsonStart) {
            "Respons kamera bukan JSON."
          }
          return JSONObject(raw.substring(jsonStart, jsonEnd + 1))
        }

        val login = JSONObject()
          .put("EncryptType", "MD5")
          .put("LoginType", "DVRIP-Web")
          .put("PassWord", sofiaHash(password))
          .put("UserName", username)

        send(1000, login, 0)
        val loginResult = read()
        val ret = loginResult.optInt("Ret", -1)
        require(ret == 100 || ret == 110 || ret == 111) {
          "Login DVRIP ditolak kamera (Ret=$ret)."
        }

        val sessionText = loginResult.optString("SessionID", "0")
        session = if (sessionText.startsWith("0x", true)) {
          sessionText.substring(2).toLong(16) and 0xffffffffL
        } else {
          sessionText.toLongOrNull() ?: 0L
        }

        val query = JSONObject()
          .put("Name", "OPFileQuery")
          .put(
            "OPFileQuery",
            JSONObject()
              .put("BeginTime", startTime)
              .put("EndTime", endTime)
              .put("Channel", channel)
              .put("DriverTypeMask", "0x0000FFFF")
              .put("Event", "*")
              .put("StreamType", "0x00000000")
              .put("Type", "h264")
          )

        send(1440, query)
        val response = read()
        val queryRet = response.optInt("Ret", -1)
        require(queryRet == 100 || queryRet == 110 || queryRet == 111) {
          "Pencarian rekaman ditolak (Ret=$queryRet)."
        }

        val result = JSONArray()
        val files = response.optJSONArray("OPFileQuery")
        if (files != null) {
          for (i in 0 until files.length()) {
            val item = files.optJSONObject(i) ?: continue
            result.put(
              JSONObject()
                .put("fileName", item.optString("FileName"))
                .put("startTime", item.optString("BeginTime"))
                .put("endTime", item.optString("EndTime"))
                .put("channel", item.optInt("Channel", channel))
                .put("fileLength", item.optString("FileLength"))
            )
          }
        }

        mapOf(
          "success" to true,
          "count" to result.length(),
          "recordings" to result.toString()
        )
      }
    }
  }

  private fun sofiaHash(password: String): String {
    val chars =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    val digest = MessageDigest.getInstance("MD5")
      .digest(password.toByteArray(Charsets.UTF_8))
    return (0 until digest.size step 2).joinToString("") { i ->
      chars[((digest[i].toInt() and 0xff) +
        (digest[i + 1].toInt() and 0xff)) % chars.length].toString()
    }
  }

  private fun putU32(data: ByteArray, offset: Int, value: Long) {
    for (i in 0..3) {
      data[offset + i] = ((value ushr (8 * i)) and 0xff).toByte()
    }
  }

  private fun readU32(data: ByteArray, offset: Int): Long {
    var value = 0L
    for (i in 0..3) {
      value = value or (
        (data[offset + i].toLong() and 0xff) shl (8 * i)
      )
    }
    return value
  }

  private fun readExact(input: BufferedInputStream, size: Int): ByteArray {
    val result = ByteArray(size)
    var offset = 0
    while (offset < size) {
      val count = input.read(result, offset, size - offset)
      if (count < 0) error("Koneksi kamera terputus.")
      offset += count
    }
    return result
  }
}
