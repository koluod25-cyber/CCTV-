package expo.modules.cctvtalkback

import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.TimeUnit

class Go2rtcModule : Module() {
  private val lock = Any()
  @Volatile
  private var process: Process? = null

  private var binaryFile: File? = null
  private var configFile: File? = null
  private var logFile: File? = null

  override fun definition() = ModuleDefinition {
    Name("CctvGo2rtc")

    AsyncFunction("startGo2rtc") {
        host: String,
        username: String,
        password: String ->

      start(host, username, password)
    }

    
AsyncFunction("getGo2rtcStatus") {
  status()
}

AsyncFunction("getGo2rtcDiagnostics") {
  diagnostics()
}

AsyncFunction("stopGo2rtc") {
  stop()
}

  }

  private fun start(
    host: String,
    username: String,
    password: String,
  ): Map<String, Any> = synchronized(lock) {
    require(host.matches(Regex("[0-9a-zA-Z.:-]+"))) {
      "Alamat kamera tidak valid."
    }

    val context = appContext.reactContext
      ?: error("Konteks Android tidak tersedia.")
   
    val existing = process
    if (existing != null) {
      if (isAlive(existing)) {
        existing.destroy()

        if (!existing.waitFor(2, TimeUnit.SECONDS)) {
          existing.destroyForcibly()
          existing.waitFor(2, TimeUnit.SECONDS)
        }
      }

      process = null
    }

    val binary = File(
  context.applicationInfo.nativeLibraryDir,
  "libgo2rtc.so",
)
    val config = File(context.filesDir, "go2rtc.yaml")
    val log = File(context.filesDir, "go2rtc.log")

    check(binary.exists() && binary.length() > 0L) {
  "Biner go2rtc tidak ditemukan: ${binary.absolutePath}"
}

check(binary.canExecute()) {
  "Android tidak mengizinkan eksekusi biner go2rtc: ${binary.absolutePath}"
}

val ffmpeg = File(
  context.applicationInfo.nativeLibraryDir,
  "libffmpeg.so",
)

check(ffmpeg.exists() && ffmpeg.length() > 0L) {
  "Biner FFmpeg tidak ditemukan di APK: ${ffmpeg.absolutePath}"
}

check(ffmpeg.canExecute()) {
  "Android tidak mengizinkan eksekusi FFmpeg: ${ffmpeg.absolutePath}"
}
    
    val encodedUser = Uri.encode(
      if (username.isBlank() && password.isBlank()) {
        "admin"
      } else {
        username
      }
    )

    val encodedPassword = Uri.encode(password)
    val credentials = "$encodedUser:$encodedPassword@"

    val yaml = """
      ffmpeg:
        bin: "${ffmpeg.absolutePath}"
      api:
        listen: "127.0.0.1:1985"
      rtsp:
        listen: "127.0.0.1:8556"
      streams:
        eyecam:
          - "eseecloud://${credentials}${host}:80/livestream/12"
        eyecam_h264:
          - "ffmpeg:eyecam#video=h264"
    """.trimIndent() + "\n"

    config.writeText(yaml)

    val builder = ProcessBuilder(
      binary.absolutePath,
      "-config",
      config.absolutePath,
    )

    builder.redirectErrorStream(true)
    builder.redirectOutput(log)

    val started = builder.start()

    binaryFile = binary
    configFile = config
    logFile = log
    process = started

    var ready = false

    for (attempt in 0 until 20) {
      if (!isAlive(started)) {
        val details = try {
          log.readText().takeLast(1800)
        } catch (_: Exception) {
          "Log go2rtc tidak dapat dibaca."
        }

        process = null
        error("go2rtc berhenti saat mulai. Log: $details")
      }

      if (canConnect("127.0.0.1", 1985)) {
        ready = true
        break
      }

      Thread.sleep(250)
    }

    mapOf(
      "success" to true,
      "running" to isAlive(started),
      "apiReady" to ready,
      "message" to if (ready) {
        "go2rtc berjalan. API lokal sudah merespons."
      } else {
        "Proses go2rtc berjalan, tetapi API belum siap."
      },
      "rtspUrl" to "rtsp://127.0.0.1:8556/eyecam_h264",
      "logPath" to log.absolutePath,
    )
  }

  private fun status(): Map<String, Any> = synchronized(lock) {
    val current = process
    val running = current != null && isAlive(current)
    val apiReady = running && canConnect("127.0.0.1", 1985)
    val rtspReady = running && canConnect("127.0.0.1", 8556)

    mapOf(
      "running" to running,
      "apiReady" to apiReady,
      "rtspReady" to rtspReady,
      "message" to when {
        !running -> "go2rtc belum berjalan."
        !apiReady -> "go2rtc berjalan, tetapi API belum siap."
        !rtspReady -> "API siap, tetapi port RTSP belum siap."
        else -> "API dan port RTSP siap."
      },
      "logPath" to (logFile?.absolutePath ?: ""),
    )
  }

private fun diagnostics(): Map<String, Any> = synchronized(lock) {
  val current = process
  val running = current != null && isAlive(current)
  val apiReady = running && canConnect("127.0.0.1", 1985)
  val rtspReady = running && canConnect("127.0.0.1", 8556)

  fun readStreamStatus(streamName: String): String {
    return try {
      val connection = java.net.URL(
        "http://127.0.0.1:1985/api/streams?src=$streamName"
      ).openConnection() as java.net.HttpURLConnection

      connection.connectTimeout = 3000
      connection.readTimeout = 5000
      connection.requestMethod = "GET"

      try {
        val code = connection.responseCode
        val responseStream = if (code in 200..299) {
          connection.inputStream
        } else {
          connection.errorStream
        }

        val body = responseStream?.bufferedReader()
          ?.use { it.readText() }
          ?: "(Respons API kosong)"

        "=== STREAM $streamName ===\nHTTP $code\n$body"
      } finally {
        connection.disconnect()
      }
    } catch (e: Exception) {
      "=== STREAM $streamName ===\nGagal membaca status: ${e.message}"
    }
  }

  
  val sourceStatus = readStreamStatus("eyecam")
  val convertedStatus = readStreamStatus("eyecam_h264")

  
  val frameStatus = try {
    val connection = java.net.URL(
      "http://127.0.0.1:1985/api/frame.jpeg?src=eyecam_h264"
    ).openConnection() as java.net.HttpURLConnection

    connection.connectTimeout = 5000
    connection.readTimeout = 15000
    connection.requestMethod = "GET"

    try {
      val code = connection.responseCode
      val contentType =
        connection.getHeaderField("Content-Type") ?: "(tidak diketahui)"
      val contentLength =
        connection.getHeaderField("Content-Length") ?: "(tidak diketahui)"

      if (code in 200..299) {
        val bytesRead = connection.inputStream.use { input ->
          val buffer = ByteArray(8192)
          var total = 0L
          var count: Int

          while (input.read(buffer).also { count = it } != -1) {
            total += count
          }

          total
        }

        "=== UJI FRAME H264 ===\n" +
          "HTTP: $code\n" +
          "Tipe: $contentType\n" +
          "Ukuran header: $contentLength byte\n" +
          "Data diterima: $bytesRead byte\n" +
          if (
            bytesRead > 0L &&
            contentType.contains("image", ignoreCase = true)
          ) {
            "HASIL: gambar berhasil diterima."
          } else if (bytesRead > 0L) {
            "HASIL: data diterima, tetapi tipe konten bukan gambar."
          } else {
            "HASIL: respons kosong."
          }
      } else {
        "=== UJI FRAME H264 ===\n" +
          "HTTP: $code\n" +
          "Tipe: $contentType\n" +
          "HASIL: endpoint tidak mengembalikan gambar."
      }
    } finally {
      connection.disconnect()
    }
  } catch (e: Exception) {
    "=== UJI FRAME H264 ===\n" +
      "GAGAL: ${e.javaClass.simpleName}: ${e.message}"
  }

  val localLog = try {
    logFile?.takeIf { it.exists() }
      ?.readText()
      ?.takeLast(12000)
      ?: "File log go2rtc belum tersedia."
  } catch (e: Exception) {
    "Gagal membaca log lokal: ${e.message}"
  }

  val configText = try {
    configFile?.takeIf { it.exists() }
      ?.readText()
      ?.replace(
        Regex("""(eseecloud://)[^@"]+@"""),
        "$1[REDACTED]@"
      )
      ?: "File konfigurasi belum tersedia."
  } catch (e: Exception) {
    "Gagal membaca konfigurasi: ${e.message}"
  }

  val diagnosticText =
    "$sourceStatus\n\n" +
    "$convertedStatus\n\n" +
    "$frameStatus\n\n" +
    "=== KONFIGURASI ===\n" +
    "$configText\n\n" +
    "=== LOG LOKAL ===\n" +
    localLog

  mapOf(
    "running" to running,
    "apiReady" to apiReady,
    "rtspReady" to rtspReady,
    "logPath" to (logFile?.absolutePath ?: ""),
    "apiLog" to (
      "$sourceStatus\n\n$convertedStatus"
    ),
    "localLog" to diagnosticText,
  )
}

  private fun stop(): Map<String, Any> = synchronized(lock) {
    val current = process
    process = null

    if (current != null) {
      current.destroy()

      if (!current.waitFor(2, TimeUnit.SECONDS)) {
        current.destroyForcibly()
        current.waitFor(2, TimeUnit.SECONDS)
      }
    }

    mapOf(
      "success" to true,
      "running" to false,
      "message" to "go2rtc dihentikan.",
    )
  }

  private fun isAlive(value: Process): Boolean {
    return try {
      value.exitValue()
      false
    } catch (_: IllegalThreadStateException) {
      true
    }
  }

  private fun canConnect(host: String, port: Int): Boolean {
    return try {
      Socket().use { socket ->
        socket.connect(InetSocketAddress(host, port), 300)
      }
      true
    } catch (_: Exception) {
      false
    }
  }
}
