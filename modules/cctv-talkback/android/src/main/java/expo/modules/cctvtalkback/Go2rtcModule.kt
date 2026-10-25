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
    if (existing != null && isAlive(existing)) {
      return mapOf(
        "success" to true,
        "running" to true,
        "message" to "go2rtc sudah berjalan.",

        "rtspUrl" to "rtsp://127.0.0.1:8556/eyecam_h264",
      )
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

    val encodedUser = Uri.encode(username)
    val encodedPassword = Uri.encode(password)
    val credentials = if (username.isBlank() && password.isBlank()) {
      ""
    } else {
      "$encodedUser:$encodedPassword@"
    }
    
    val yaml = """
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
      "rtspUrl" to "rtsp://127.0.0.1:8556/eyecam",
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

  val streamInfo = try {
    val connection = java.net.URL(
      "http://127.0.0.1:1985/api/streams?src=eyecam"
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

      "HTTP $code\n$body"
    } finally {
      connection.disconnect()
    }
  } catch (e: Exception) {
    "Gagal membaca status stream eyecam: ${e.message}"
  }

  val localLog = try {
    logFile?.takeIf { it.exists() }
      ?.readText()
      ?.takeLast(7000)
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

  mapOf(
    "running" to running,
    "apiReady" to apiReady,
    "rtspReady" to rtspReady,
    "logPath" to (logFile?.absolutePath ?: ""),
    "apiLog" to streamInfo,
    "localLog" to (
      "=== STATUS STREAM EYECAM ===\n" +
      streamInfo +
      "\n\n=== KONFIGURASI ===\n" +
      configText +
      "\n\n=== LOG LOKAL ===\n" +
      localLog
    ),
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
