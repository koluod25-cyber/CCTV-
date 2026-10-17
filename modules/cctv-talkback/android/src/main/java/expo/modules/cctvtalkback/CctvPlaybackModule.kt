package expo.modules.cctvtalkback

import android.net.Uri
import android.content.ContentValues
import android.os.Build
import android.provider.MediaStore
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.time.Duration
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

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

      withDvrip(host, username, password) { socket, input, output, session ->
        var sequence = 2L

        fun send(id: Int, data: JSONObject) {
          sendPacket(output, id, data, session, sequence++)
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
        val response = readJsonPacket(input)
        val ret = response.optInt("Ret", -1)

        require(ret == 100 || ret == 110 || ret == 111) {
          "Pencarian rekaman ditolak (Ret=$ret)."
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

    AsyncFunction("prepareRecordingPlayback") {
      host: String,
      username: String,
      password: String,
      fileName: String,
      startTime: String,
      endTime: String ->

      require(host.isNotBlank()) { "IP kamera belum diisi." }
      require(username.isNotBlank()) { "Username kamera belum diisi." }
      require(password.isNotEmpty()) { "Password kamera belum diisi." }
      require(fileName.isNotBlank()) { "Nama file rekaman kosong." }
      require(startTime.isNotBlank() && endTime.isNotBlank()) {
        "Waktu rekaman belum lengkap."
      }

      
      val normalizedName = fileName.replace('\\', '/')
      val pathParts = normalizedName.split('/')

      require(
        normalizedName.startsWith("/") &&
          normalizedName.length <= 1024 &&
          pathParts.none { it == ".." } &&
          pathParts.lastOrNull()
            ?.matches(Regex("[A-Za-z0-9._@\\[\\]-]+")) == true
      ) {
        "Nama file rekaman tidak valid."
      }

      val raw = downloadRecording(
        host,
        username,
        password,
        fileName,
        startTime,
        endTime
      )

      require(raw.isNotEmpty()) {
        "Kamera tidak mengirim data rekaman."
      }

      val cache = appContext.cacheDirectory
      val outputFile = File(
        cache,
        "cctv_playback_${System.currentTimeMillis()}.mp4"
      )

      val durationUs = clipDurationUs(startTime, endTime)

      try {
        XmHevcMuxer.writeMp4(
          raw,
          outputFile,
          durationUs = durationUs
        )
      } catch (error: Exception) {
        outputFile.delete()
        throw IllegalStateException(
          "Rekaman berhasil diunduh (${raw.size} byte), " +
            "tetapi belum dapat dikonversi menjadi MP4: " +
            (error.message ?: error.javaClass.simpleName)
        )
      }

      
      mapOf(
        "success" to true,
        "uri" to Uri.fromFile(outputFile).toString(),
        "size" to outputFile.length()
      )
    }

    AsyncFunction("downloadRecordingToPhone") {
      host: String,
      username: String,
      password: String,
      fileName: String,
      startTime: String,
      endTime: String ->

      require(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        "Simpan ke Unduhan memerlukan Android 10 atau lebih baru."
      }
      require(host.isNotBlank()) { "IP kamera belum diisi." }
      require(username.isNotBlank()) { "Username kamera belum diisi." }
      require(password.isNotEmpty()) { "Password kamera belum diisi." }
      require(fileName.startsWith("/") &&
        !fileName.contains("..") &&
        fileName.length <= 1024 &&
        startTime.isNotBlank() &&
        endTime.isNotBlank()
      ) {
        "Informasi rekaman tidak valid."
      }

      val raw = downloadRecording(
        host,
        username,
        password,
        fileName,
        startTime,
        endTime
      )

      require(raw.isNotEmpty()) {
        "Kamera tidak mengirim data rekaman."
      }

      val tempFile = File(
        appContext.cacheDirectory,
        "cctv_export_${System.currentTimeMillis()}.mp4"
      )

      try {
        XmHevcMuxer.writeMp4(
          raw,
          tempFile,
          durationUs = clipDurationUs(startTime, endTime)
        )

        val baseName = fileName
          .substringAfterLast("/")
          .substringBeforeLast(".")
          .replace(Regex("[^A-Za-z0-9_-]"), "_")
          .ifBlank { "cctv_recording" }

        val displayName =
          "${baseName}_${System.currentTimeMillis()}.mp4"

        val values = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
          put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
          put(
            MediaStore.MediaColumns.RELATIVE_PATH,
            "Download/CCTV Universal Monitor"
          )
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }

        val context = appContext.reactContext
          ?: error("Konteks Android tidak tersedia.")

        val resolver = context.contentResolver
        val savedUri = resolver.insert(
          MediaStore.Downloads.EXTERNAL_CONTENT_URI,
          values
        ) ?: error("Tidak dapat membuat file di folder Unduhan.")

        try {
          val destination = resolver.openOutputStream(savedUri)
            ?: error("Tidak dapat menulis file Unduhan.")

          destination.use { output ->
            tempFile.inputStream().use { input ->
              input.copyTo(output)
            }
          }

          val completed = ContentValues().apply {
            put(MediaStore.MediaColumns.IS_PENDING, 0)
          }
          resolver.update(savedUri, completed, null, null)
        } catch (error: Exception) {
          resolver.delete(savedUri, null, null)
          throw error
        }

        mapOf(
          "success" to true,
          "uri" to savedUri.toString(),
          "size" to tempFile.length(),
          "fileName" to displayName
        )
      } finally {
        tempFile.delete()
      }
    }
  }

  private fun downloadRecording(
    host: String,
    username: String,
    password: String,
    fileName: String,
    startTime: String,
    endTime: String
  ): ByteArray {

    Socket().use { socket ->
      socket.connect(InetSocketAddress(host, 34567), 8000)
      socket.soTimeout = 180000

      val input = BufferedInputStream(socket.getInputStream())
      val output = BufferedOutputStream(socket.getOutputStream())

      var sequence = 1L

      fun send(id: Int, data: JSONObject, session: Long) {
        sendPacket(output, id, data, session, sequence++)
      }

      send(
        1000,
        JSONObject()
          .put("EncryptType", "MD5")
          .put("LoginType", "DVRIP-Web")
          .put("PassWord", sofiaHash(password))
          .put("UserName", username),
        0L
      )

      val login = readJsonPacket(input)
      val ret = login.optInt("Ret", -1)

      require(ret == 100 || ret == 110 || ret == 111) {
        "Login DVRIP ditolak kamera (Ret=$ret)."
      }

      val sessionText = login.optString("SessionID", "0")
      val session = if (sessionText.startsWith("0x", true)) {
        sessionText.substring(2).toLong(16) and 0xffffffffL
      } else {
        sessionText.toLongOrNull() ?: 0L
      }

      require(session != 0L) {
        "Kamera tidak memberikan SessionID DVRIP yang valid."
      }

      fun playbackCommand(action: String) = JSONObject()
        .put("Name", "OPPlayBack")
        .put(
          "OPPlayBack",
          JSONObject()
            .put("Action", action)
            .put("StartTime", startTime)
            .put("EndTime", endTime)
            .put(
              "Parameter",
              JSONObject()
                .put("PlayMode", "ByName")
                .put("FileName", fileName)
                .put("StreamType", 0)
                .put("Value", 0)
                .put("TransMode", "TCP")
            )
        )
        .put("SessionID", "0x%08x".format(session))

      val data = java.io.ByteArrayOutputStream()

      try {
        // Claim dan mulai pengunduhan sesuai protokol DVRIP/XM.
        send(1424, playbackCommand("Claim"), session)
        send(1420, playbackCommand("DownloadStart"), session)

        var finished = false

        while (!finished) {
          val header = readExact(input, 20)

          require((header[0].toInt() and 0xff) == 0xff) {
            "Header data rekaman DVRIP tidak valid."
          }

          val messageId =
            (header[14].toInt() and 0xff) or
              ((header[15].toInt() and 0xff) shl 8)

          val payloadSize = readU32(header, 16).toInt()

          require(payloadSize in 0..(16 * 1024 * 1024)) {
            "Ukuran paket rekaman DVRIP tidak valid."
          }

          if (payloadSize == 0) {
            if (messageId == 1426) {
              finished = true
            }
            continue
          }

          val payload = readExact(input, payloadSize)

          // Abaikan ACK/JSON. Terima paket video DVRIP dan
          // paket yang jelas mengandung pemisah Annex-B.
          val isJson = payload.firstOrNull()?.toInt()?.toChar() == '{'
          val hasAnnexB = containsAnnexBPrefix(payload)

          if (!isJson && (messageId == 1426 || hasAnnexB)) {
            require(data.size().toLong() + payload.size <= MAX_DOWNLOAD_BYTES) {
              "Rekaman terlalu besar untuk diolah dalam memori."
            }
            data.write(payload)
          }

          if (data.size() >= MAX_DOWNLOAD_BYTES) {
            error("Batas ukuran unduhan rekaman tercapai.")
          }
        }
      } catch (error: SocketTimeoutException) {
        if (data.size() == 0) {
          throw IllegalStateException(
            "Waktu tunggu unduhan habis. Kamera belum mengirim data rekaman."
          )
        }
        // Beberapa firmware tidak mengirim paket terminasi.
      } finally {
        runCatching {
          send(1420, playbackCommand("DownloadStop"), session)
        }
      }

      return data.toByteArray()
    }
  }

  private fun withDvrip(
    host: String,
    username: String,
    password: String,
    action: (
      Socket,
      BufferedInputStream,
      BufferedOutputStream,
      Long
    ) -> Any
  ): Any {
    require(host.isNotBlank()) { "IP kamera belum diisi." }
    require(username.isNotBlank()) { "Username belum diisi." }

    Socket().use { socket ->
      socket.connect(InetSocketAddress(host, 34567), 8000)
      socket.soTimeout = 15000

      val input = BufferedInputStream(socket.getInputStream())
      val output = BufferedOutputStream(socket.getOutputStream())

      sendPacket(
        output,
        1000,
        JSONObject()
          .put("EncryptType", "MD5")
          .put("LoginType", "DVRIP-Web")
          .put("PassWord", sofiaHash(password))
          .put("UserName", username),
        0L,
        1L
      )

      val login = readJsonPacket(input)
      val ret = login.optInt("Ret", -1)

      require(ret == 100 || ret == 110 || ret == 111) {
        "Login DVRIP ditolak kamera (Ret=$ret)."
      }

      val text = login.optString("SessionID", "0")
      val session = if (text.startsWith("0x", true)) {
        text.substring(2).toLong(16) and 0xffffffffL
      } else {
        text.toLongOrNull() ?: 0L
      }

      return action(socket, input, output, session)
    }
  }

  private fun sendPacket(
    output: BufferedOutputStream,
    id: Int,
    data: JSONObject,
    session: Long,
    sequence: Long
  ) {
    val payload = (data.toString() + "\n\u0000")
      .toByteArray(Charsets.UTF_8)

    val header = ByteArray(20)
    header[0] = 0xff.toByte()
    header[1] = 0x00.toByte()

    putU32(header, 4, session)
    putU32(header, 8, sequence)

    header[14] = (id and 0xff).toByte()
    header[15] = ((id shr 8) and 0xff).toByte()

    putU32(header, 16, payload.size.toLong())

    output.write(header)
    output.write(payload)
    output.flush()
  }

  private fun readJsonPacket(input: BufferedInputStream): JSONObject {
    val header = readExact(input, 20)

    require((header[0].toInt() and 0xff) == 0xff) {
      "Header DVRIP kamera tidak valid."
    }

    val size = readU32(header, 16).toInt()

    require(size in 1..(4 * 1024 * 1024)) {
      "Ukuran respons DVRIP tidak valid."
    }

    val raw = String(readExact(input, size), Charsets.UTF_8)
      .trim('\u0000', '\n', '\r', ' ')

    val start = raw.indexOf('{')
    val end = raw.lastIndexOf('}')

    require(start >= 0 && end >= start) {
      "Respons kamera bukan JSON."
    }

    return JSONObject(raw.substring(start, end + 1))
  }

  private fun containsAnnexBPrefix(data: ByteArray): Boolean {
    for (i in 0 until data.size - 2) {
      if (
        data[i] == 0.toByte() &&
        data[i + 1] == 0.toByte() &&
        data[i + 2] == 1.toByte()
      ) return true

      if (
        i + 3 < data.size &&
        data[i] == 0.toByte() &&
        data[i + 1] == 0.toByte() &&
        data[i + 2] == 0.toByte() &&
        data[i + 3] == 1.toByte()
      ) return true
    }

    return false
  }

  private fun clipDurationUs(begin: String, end: String): Long? {
    return try {
      val formatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
      val start = LocalDateTime.parse(begin.trim(), formatter)
      val finish = LocalDateTime.parse(end.trim(), formatter)
      val millis = Duration.between(start, finish).toMillis()

      if (millis in 1000..86_400_000) millis * 1000L else null
    } catch (_: Exception) {
      null
    }
  }

  private fun sofiaHash(password: String): String {
    val chars =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

    val digest = MessageDigest.getInstance("MD5")
      .digest(password.toByteArray(Charsets.UTF_8))

    return (0 until digest.size step 2).joinToString("") { i ->
      chars[
        ((digest[i].toInt() and 0xff) +
          (digest[i + 1].toInt() and 0xff)) % chars.length
      ].toString()
    }
  }

  private fun putU32(data: ByteArray, offset: Int, value: Long) {
    for (i in 0..3) {
      data[offset + i] =
        ((value ushr (8 * i)) and 0xff).toByte()
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

  private fun readExact(
    input: BufferedInputStream,
    size: Int
  ): ByteArray {
    val result = ByteArray(size)
    var offset = 0

    while (offset < size) {
      val count = input.read(result, offset, size - offset)
      if (count < 0) error("Koneksi kamera terputus.")
      offset += count
    }

    return result
  }

  companion object {
    private const val MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024
  }
}
