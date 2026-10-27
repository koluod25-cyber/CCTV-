package expo.modules.cctvtalkback

import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
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
    password: String
  ): Map<String, Any> = synchronized(lock) {

    val context = appContext.reactContext
      ?: error("Konteks Android tidak tersedia.")

    val binary = File(
      context.applicationInfo.nativeLibraryDir,
      "libgo2rtc.so"
    )

    val ffmpeg = File(
      context.applicationInfo.nativeLibraryDir,
      "libffmpeg.so"
    )

    val config = File(context.filesDir, "go2rtc.yaml")
    val log = File(context.filesDir, "go2rtc.log")

    // Simpan lokasi file sebelum pemeriksaan apa pun.
    binaryFile = binary
    configFile = config
    logFile = log

    config.parentFile?.mkdirs()
    log.parentFile?.mkdirs()

    if (!log.exists()) {
      log.createNewFile()
    }

    fun failStartup(message: String): Nothing {
      try {
        log.appendText(
          "\n[STARTUP ERROR] $message\n"
        )
      } catch (_: Exception) {
        // Pertahankan pesan kegagalan utama.
      }
      throw IllegalStateException(message)
    }

    // Hentikan proses sebelumnya jika masih berjalan.
    val previous = process

    if (previous != null && isAlive(previous)) {
      previous.destroy()

      if (!previous.waitFor(2, TimeUnit.SECONDS)) {
        previous.destroyForcibly()
        previous.waitFor(2, TimeUnit.SECONDS)
      }
    }

    process = null

    // Buat log baru untuk percobaan startup ini.
    log.writeText(
      "=== GO2RTC STARTUP ===\n" +
      "Binary: ${binary.absolutePath}\n" +
      "Config: ${config.absolutePath}\n" +
      "FFmpeg: ${ffmpeg.absolutePath}\n"
    )

    if (!binary.exists() || binary.length() <= 0L) {
      failStartup(
        "Binary go2rtc tidak ditemukan atau kosong: " +
        binary.absolutePath
      )
    }

    if (!binary.canExecute()) {
      failStartup(
        "Binary go2rtc tidak dapat dieksekusi: " +
        binary.absolutePath
      )
    }

    if (!ffmpeg.exists() || ffmpeg.length() <= 0L) {
      failStartup(
        "Binary FFmpeg tidak ditemukan atau kosong: " +
        ffmpeg.absolutePath
      )
    }

    if (!ffmpeg.canExecute()) {
      failStartup(
        "Binary FFmpeg tidak dapat dieksekusi: " +
        ffmpeg.absolutePath
      )
    }

    if (!host.matches(Regex("[0-9a-zA-Z.:-]+"))) {
      failStartup("Alamat kamera tidak valid.")
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
      api:
        listen: "127.0.0.1:1985"
      rtsp:
        listen: "127.0.0.1:8556"
      streams:
        eyecam:
          - "eseecloud://${credentials}${host}:80/livestream/12"
    """.trimIndent() + "\n"

    try {
      config.writeText(yaml)
    } catch (e: Exception) {
      failStartup(
        "Gagal menulis konfigurasi: ${e.message}"
      )
    }

    val builder = ProcessBuilder(
      binary.absolutePath,
      "-config",
      config.absolutePath
    )

    builder.redirectErrorStream(true)
    builder.redirectOutput(log)

    val started = try {
      builder.start()
    } catch (e: Exception) {
      log.appendText(
        "\n[GAGAL MEMULAI PROSES]\n" +
        "${e.javaClass.simpleName}: ${e.message}\n"
      )
      throw IllegalStateException(
        "Tidak dapat menjalankan go2rtc: ${e.message}",
        e
      )
    }

    // Simpan referensi segera agar diagnosis bisa melihatnya.
    process = started

    var ready = false

    for (attempt in 0 until 40) {
      if (!isAlive(started)) {
        val exitCode = try {
          started.exitValue()
        } catch (_: Exception) {
          -1
        }

        val details = try {
          log.readText().takeLast(5000)
        } catch (_: Exception) {
          "Log tidak dapat dibaca."
        }

        process = null

        throw IllegalStateException(
          "go2rtc berhenti saat startup. " +
          "Kode keluar: $exitCode\n$details"
        )
      }

      if (canConnect("127.0.0.1", 1985)) {
        ready = true
        break
      }

      Thread.sleep(250)
    }

    val rtspReady =
      isAlive(started) &&
      canConnect("127.0.0.1", 8556)

    mapOf(
      "success" to true,
      "running" to isAlive(started),
      "apiReady" to ready,
      "rtspReady" to rtspReady,
      "message" to when {
        !isAlive(started) ->
          "Proses go2rtc berhenti."
        !ready ->
          "Proses berjalan, tetapi API belum merespons. Periksa log."
        !rtspReady ->
          "API siap, tetapi port RTSP belum siap."
        else ->
          "Go2rtc dan port API/RTSP siap."
      },
      "rtspUrl" to
        "rtsp://127.0.0.1:8556/eyecam",
      "logPath" to log.absolutePath
    )
  }

  private fun status(): Map<String, Any> =
    synchronized(lock) {

      val current = process
      val running = current != null && isAlive(current)

      val apiReady =
        running && canConnect("127.0.0.1", 1985)

      val rtspReady =
        running && canConnect("127.0.0.1", 8556)

      mapOf(
        "running" to running,
        "apiReady" to apiReady,
        "rtspReady" to rtspReady,
        "message" to when {
          !running ->
            "go2rtc belum berjalan atau sudah berhenti."
          !apiReady ->
            "Proses berjalan, tetapi API belum siap."
          !rtspReady ->
            "API siap, tetapi port RTSP belum siap."
          else ->
            "API dan port RTSP siap."
        },
        "logPath" to (
          logFile?.absolutePath ?: ""
        )
      )
    }

  private fun diagnostics(): Map<String, Any> =
    synchronized(lock) {

      val context = appContext.reactContext

      val config = configFile
        ?: context?.let {
          File(it.filesDir, "go2rtc.yaml")
        }

      val log = logFile
        ?: context?.let {
          File(it.filesDir, "go2rtc.log")
        }

      val binary = binaryFile
        ?: context?.let {
          File(
            it.applicationInfo.nativeLibraryDir,
            "libgo2rtc.so"
          )
        }

      val current = process
      val running = current != null && isAlive(current)

      val apiReady =
        running && canConnect("127.0.0.1", 1985)

      val rtspReady =
        running && canConnect("127.0.0.1", 8556)

     
      fun readEndpoint(path: String): String {
        var connection: HttpURLConnection? = null

        return try {
          connection = URL(
            "http://127.0.0.1:1985$path"
          ).openConnection() as HttpURLConnection

          connection.connectTimeout = 3000
          connection.readTimeout = 8000
          connection.requestMethod = "GET"
          connection.setRequestProperty("Accept", "*/*")

          val code = connection.responseCode
          val contentType =
            connection.contentType ?: "(Content-Type tidak ada)"

          val stream = if (code in 200..299) {
            connection.inputStream
          } else {
            connection.errorStream
          }

          if (path.startsWith("/api/frame.jpeg")) {
            val bytes = stream?.use { input ->
              val output = java.io.ByteArrayOutputStream()
              val buffer = ByteArray(4096)
              var total = 0

              while (total < 2_000_000) {
                val count = input.read(
                  buffer,
                  0,
                  minOf(buffer.size, 2_000_000 - total)
                )

                if (count <= 0) break

                output.write(buffer, 0, count)
                total += count
              }

              output.toByteArray()
            } ?: ByteArray(0)

            val firstBytes = bytes.take(8)
              .joinToString(" ") {
                "%02X".format(it.toInt() and 0xFF)
              }

            val isJpeg = bytes.size >= 3 &&
              bytes[0] == 0xFF.toByte() &&
              bytes[1] == 0xD8.toByte() &&
              bytes[2] == 0xFF.toByte()

            "HTTP $code\n" +
              "Content-Type: $contentType\n" +
              "Ukuran data gambar: ${bytes.size} byte\n" +
              "Header awal: $firstBytes\n" +
              "JPEG valid dari header: $isJpeg"
          } else {
            val body = stream?.bufferedReader()
              ?.use { it.readText() }
              ?: "(Respons kosong)"

            "HTTP $code\nContent-Type: $contentType\n$body"
          }
        } catch (e: Exception) {
          "Gagal: ${e.javaClass.simpleName}: ${e.message}"
        } finally {
          connection?.disconnect()
        }
      }
 
      val sourceStatus = readEndpoint(
        "/api/streams?src=eyecam"
      )

      val convertedStatus = readEndpoint(
  "/api/streams?src=eyecam"
)

val frameStatus = readEndpoint(
  "/api/frame.jpeg?src=eyecam"
)

      val localLog = try {
        if (log?.exists() == true) {
          log.readText().takeLast(12000)
        } else {
          "File log belum dibuat: ${log?.absolutePath ?: "(lokasi tidak diketahui)"}"
        }
      } catch (e: Exception) {
        "Gagal membaca log: ${e.message}"
      }

      val configText = try {
        if (config?.exists() == true) {
          config.readText().replace(
            Regex("""(eseecloud://)[^@"]+@""")
          ) {
            "${it.groupValues[1]}[REDACTED]@"
          }
        } else {
          "File konfigurasi belum dibuat: ${config?.absolutePath ?: "(lokasi tidak diketahui)"}"
        }
      } catch (e: Exception) {
        "Gagal membaca konfigurasi: ${e.message}"
      }

      
      val ffmpeg = context?.let {
        File(it.applicationInfo.nativeLibraryDir, "libffmpeg.so")
      }

      val ffmpegProbe = try {
        if (ffmpeg == null ||
            !ffmpeg.exists() ||
            !ffmpeg.canExecute()) {
          "FFmpeg tidak ditemukan atau tidak executable."
        } else {
          val probeLog = File(
            context.cacheDir,
            "ffmpeg-probe.log"
          )
          val frameFile = File(
            context.cacheDir,
            "go2rtc-test.jpg"
          )

          frameFile.delete()

          val command = listOf(
            ffmpeg.absolutePath,
            "-hide_banner",
            "-loglevel", "info",
            "-rtsp_transport", "tcp",
            "-i", "rtsp://127.0.0.1:8556/eyecam",
            "-frames:v", "1",
            "-y",
            frameFile.absolutePath
          )

          val probe = ProcessBuilder(command)
            .redirectErrorStream(true)
            .redirectOutput(probeLog)
            .start()

          val finished = probe.waitFor(
            12,
            TimeUnit.SECONDS
          )

          if (!finished) {
            probe.destroyForcibly()
            probe.waitFor(2, TimeUnit.SECONDS)
            "UJI TIMEOUT: FFmpeg tidak selesai dalam 12 detik."
          } else {
            val output = if (probeLog.exists()) {
              probeLog.readText().takeLast(5000)
            } else {
              "(output FFmpeg kosong)"
            }

            val frameResult = if (frameFile.exists()) {
              "File frame: ${frameFile.length()} byte"
            } else {
              "File frame tidak terbentuk."
            }

            "Exit code: ${probe.exitValue()}\n" +
              "$frameResult\n$output"
          }
        }
      } catch (e: Exception) {
        "Gagal menjalankan FFmpeg: " +
          "${e.javaClass.simpleName}: ${e.message}"
      }

      val binaryStatus = buildString {
        appendLine("Path go2rtc: ${binary?.absolutePath}")
        appendLine("go2rtc ada: ${binary?.exists() == true}")
        appendLine("Ukuran go2rtc: ${binary?.length() ?: 0} byte")
        appendLine("go2rtc executable: ${binary?.canExecute() == true}")
        appendLine("Path FFmpeg: ${ffmpeg?.absolutePath}")
        appendLine("FFmpeg ada: ${ffmpeg?.exists() == true}")
        appendLine("Ukuran FFmpeg: ${ffmpeg?.length() ?: 0} byte")
        appendLine("FFmpeg executable: ${ffmpeg?.canExecute() == true}")
        appendLine("=== UJI FFmpeg MEMBACA RTSP ===")
        appendLine(ffmpegProbe)
      }
      
      val diagnosticText =
        "=== STATUS PROSES ===\n" +
        "Berjalan: $running\n" +
        "API siap: $apiReady\n" +
        "RTSP siap: $rtspReady\n\n" +
        "=== BINARY GO2RTC ===\n" +
        "$binaryStatus\n" +
        "=== STREAM eyecam ===\n" +
        "$sourceStatus\n\n" +
        "=== STREAM eyecam_h264 ===\n" +
        "$convertedStatus\n\n" +
        "=== UJI FRAME H264 ===\n" +
        "$frameStatus\n\n" +
        "=== KONFIGURASI ===\n" +
        "$configText\n\n" +
        "=== LOG LOKAL ===\n" +
        localLog

      mapOf(
        "running" to running,
        "apiReady" to apiReady,
        "rtspReady" to rtspReady,
        "logPath" to (log?.absolutePath ?: ""),
        "apiLog" to (
          "=== STREAM eyecam ===\n$sourceStatus\n\n" +
          "=== STREAM eyecam_h264 ===\n$convertedStatus"
        ),
        "localLog" to diagnosticText
      )
    }

  private fun stop(): Map<String, Any> =
    synchronized(lock) {

      val current = process
      process = null

      if (current != null && isAlive(current)) {
        current.destroy()

        if (!current.waitFor(2, TimeUnit.SECONDS)) {
          current.destroyForcibly()
          current.waitFor(2, TimeUnit.SECONDS)
        }
      }

      mapOf(
        "success" to true,
        "running" to false,
        "message" to "go2rtc dihentikan."
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

  private fun canConnect(
    host: String,
    port: Int
  ): Boolean {
    return try {
      Socket().use { socket ->
        socket.connect(
          InetSocketAddress(host, port),
          500
        )
      }
      true
    } catch (_: Exception) {
      false
    }
  }
}
