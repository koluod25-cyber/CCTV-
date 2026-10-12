package expo.modules.cctvtalkback

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Initial DVRIP talkback implementation for iCSee/Xiongmai-compatible cameras.
 * Firmware variants may use different login/password formats; test against the
 * target Aztech camera before treating this as production-ready.
 */
class CctvTalkbackModule : Module() {
  private val lock = Any()
  @Volatile private var talkSocket: Socket? = null
  @Volatile private var talkInput: BufferedInputStream? = null
  @Volatile private var talkOutput: BufferedOutputStream? = null
  @Volatile private var audioRecord: AudioRecord? = null
  @Volatile private var audioThread: Thread? = null
  private val running = AtomicBoolean(false)
  @Volatile private var sessionId: Long = 0
  @Volatile private var sequence: Long = 1

  override fun definition() = ModuleDefinition {
    Name("CctvTalkback")

    AsyncFunction("checkSupport") { url: String ->
      checkRtsp(url)
    }

    AsyncFunction("startTalkback") { host: String, port: Int, username: String, password: String ->
      start(host, port, username, password)
    }

    AsyncFunction("stopTalkback") {
      stop()
    }
  }

  private fun checkRtsp(url: String): Map<String, Any?> {
    var socket: Socket? = null
    return try {
      val uri = URI(url.trim())
      if (uri.scheme?.lowercase(Locale.ROOT) != "rtsp" || uri.host.isNullOrBlank()) {
        return mapOf("reachable" to false, "supported" to false, "message" to "Gunakan alamat RTSP kamera yang valid.")
      }
      val port = if (uri.port > 0) uri.port else 554
      socket = Socket()
      socket.connect(InetSocketAddress(uri.host, port), 3000)
      socket.soTimeout = 3000
      val output = socket.getOutputStream()
      val request = "OPTIONS rtsp://${uri.host}:$port/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: CCTV-Universal-Monitor\r\n\r\n"
      output.write(request.toByteArray(Charsets.UTF_8)); output.flush()
      val buffer = ByteArray(1024)
      val count = socket.getInputStream().read(buffer)
      val response = if (count > 0) String(buffer, 0, count, Charsets.UTF_8) else ""
      val status = Regex("RTSP/\\d+\\.\\d+\\s+(\\d+)").find(response)?.groupValues?.get(1)?.toIntOrNull()
      mapOf("reachable" to true, "statusCode" to status, "supported" to false, "message" to "RTSP terhubung; ini belum membuktikan dukungan audio talkback.")
    } catch (e: Exception) {
      mapOf("reachable" to false, "supported" to false, "message" to (e.message ?: "Kamera tidak dapat diperiksa."))
    } finally { try { socket?.close() } catch (_: Exception) {} }
  }

  
private fun start(host: String, port: Int, username: String, password: String): Map<String, Any> {
    return synchronized(lock) {

      if (running.get()) return mapOf("success" to true, "message" to "Talkback sudah aktif.")
      require(host.isNotBlank()) { "Alamat IP kamera belum diisi." }
      require(port in 1..65535) { "Port DVRIP tidak valid." }
      require(username.isNotBlank()) { "Username kamera belum diisi." }
      val context = appContext.reactContext ?: error("Konteks Android tidak tersedia.")
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        error("Izin mikrofon belum diberikan. Aktifkan izin Mikrofon untuk CCTV Universal Monitor di Pengaturan Android.")
      }

      val socket = Socket()
      socket.connect(InetSocketAddress(host, port), 5000)
      socket.soTimeout = 5000
      val input = BufferedInputStream(socket.getInputStream())
      val output = BufferedOutputStream(socket.getOutputStream())
      try {
        // Common DVRIP login shape used by a number of XM/iCSee firmwares.
        val login = JSONObject()
          .put("EncryptType", "MD5")
          .put("LoginType", "DVRIP-Web")
          .put("PassWord", sofiaHash(password))
          .put("UserName", username)
        writeFrame(output, LOGIN_REQUEST, 0, nextSequence(), (login.toString() + "\n\u0000").toByteArray(Charsets.UTF_8))
        val loginFrame = readFrame(input)
        if (loginFrame.messageId != LOGIN_RESPONSE) error("Respons login DVRIP tidak sesuai (ID ${loginFrame.messageId}).")
        val loginJson = parseJsonObject(loginFrame.payload,"Respons login DVRIP",)
        val ret = loginJson.optInt("Ret", -1)
        if (ret != 100) error("Login DVRIP ditolak kamera (Ret=$ret). Periksa username/password atau format autentikasi firmware.")
        val sidText = loginJson.optString("SessionID", "0")
        sessionId = parseSessionId(sidText)

        val claim = JSONObject()
          .put("Name", "OPTalk")
          .put("OPTalk", JSONObject()
            .put("Action", "Claim")
            .put("AudioFormat", JSONObject()
              .put("BitRate", 0)
              .put("EncodeType", "G711_ALAW")
              .put("SampleBit", 8)
              .put("SampleRate", 8)))
          .put("SessionID", String.format(Locale.ROOT, "0x%08x", sessionId))
        writeJson(output, TALK_CLAIM, sessionId, nextSequence(), claim)
        val claimFrame = readFrame(input)
        if (claimFrame.messageId != TALK_CLAIM_RESPONSE) error("Respons Claim Talkback tidak sesuai (ID ${claimFrame.messageId}).")
        val claimJson = parseJsonObject(claimFrame.payload,"Respons Claim Talkback",)
        if (claimJson.optInt("Ret", -1) != 100) error("Kamera menolak Claim Talkback (Ret=${claimJson.optInt("Ret", -1)}).")
        val startJson = JSONObject()
          .put("Name", "OPTalk")
          .put("OPTalk", JSONObject().put("Action", "Start"))
          .put("SessionID", String.format(Locale.ROOT, "0x%08x", sessionId))
        writeJson(output, TALK_START, sessionId, nextSequence(), startJson)
        val startFrame = readFrame(input)
        val startJsonResponse = parseJsonObject(  startFrame.payload, "Respons Start Talkback",)
        if (startJsonResponse.optInt("Ret", -1) != 100) error("Kamera menolak Start Talkback (Ret=${startJsonResponse.optInt("Ret", -1)}).")

        val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (minBuffer <= 0) error("Perangkat Android tidak mendukung perekaman audio 8 kHz.")
        val recorder = AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuffer, 4096))
        if (recorder.state != AudioRecord.STATE_INITIALIZED) { recorder.release(); error("Mikrofon tidak dapat diinisialisasi.") }

        talkSocket = socket; talkInput = input; talkOutput = output; audioRecord = recorder
        running.set(true)
        recorder.startRecording()
        audioThread = Thread({ streamMicrophone(recorder, output, socket) }, "CctvTalkbackAudio").apply { isDaemon = true; start() }
        mapOf("success" to true, "message" to "Talkback dimulai. Jika speaker kamera diam, firmware mungkin memakai format DVRIP berbeda.")
      } catch (e: Exception) {
        try { socket.close() } catch (_: Exception) {}
        running.set(false)
        throw e
      }
    }
  }

  private fun streamMicrophone(recorder: AudioRecord, output: BufferedOutputStream, socket: Socket) {
    val pcmBytes = ByteArray(FRAME_SAMPLES * 2)
    val alaw = ByteArray(FRAME_SAMPLES)
    try {
      while (running.get() && !socket.isClosed) {
        var filled = 0
        while (filled < pcmBytes.size && running.get()) {
          val n = recorder.read(pcmBytes, filled, pcmBytes.size - filled)
          if (n <= 0) throw IllegalStateException("Pembacaan mikrofon gagal ($n).")
          filled += n
        }
        if (!running.get()) break
        for (i in 0 until FRAME_SAMPLES) {
          val sample = ((pcmBytes[i * 2 + 1].toInt() shl 8) or (pcmBytes[i * 2].toInt() and 0xff)).toShort().toInt()
          alaw[i] = encodeALaw(sample).toByte()
        }
        val payload = ByteArray(8 + alaw.size)
        byteArrayOf(0x00, 0x00, 0x01, 0xfa.toByte(), 0x0e, 0x02, 0x40, 0x01).copyInto(payload)
        alaw.copyInto(payload, 8)
        synchronized(lock) { writeFrame(output, TALK_AUDIO_TO_CAMERA, sessionId, nextSequence(), payload) }
      }
    } catch (_: Exception) {
      // Stream errors are reflected when the user next attempts to start.
      running.set(false)
    }
  }

  private fun stop(): Map<String, Any> {
    synchronized(lock) {
      val wasRunning = running.getAndSet(false)
      try { audioRecord?.stop() } catch (_: Exception) {}
      try { audioThread?.join(700) } catch (_: Exception) {}
      try {
        val output = talkOutput
        if (output != null && talkSocket?.isClosed == false) {
          val body = JSONObject().put("Name", "OPTalk").put("OPTalk", JSONObject().put("Action", "Stop"))
            .put("SessionID", String.format(Locale.ROOT, "0x%08x", sessionId))
          writeJson(output, TALK_STOP, sessionId, nextSequence(), body)
        }
      } catch (_: Exception) {}
      try { audioRecord?.release() } catch (_: Exception) {}
      try { talkSocket?.close() } catch (_: Exception) {}
      audioRecord = null; audioThread = null; talkInput = null; talkOutput = null; talkSocket = null
      return mapOf("success" to true, "message" to if (wasRunning) "Talkback dihentikan." else "Talkback sudah berhenti.")
    }
  }

  // Hash password DVRIP Xiongmai/Sofia: MD5 diubah menjadi 8 karakter.
  
private fun sofiaHash(value: String): String {
    val chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    val digest = MessageDigest.getInstance("MD5")
        .digest(value.toByteArray(Charsets.UTF_8))

        return (0 until digest.size step 2).joinToString("") { index ->
        val a = digest[index].toInt() and 0xff
        val b = digest[index + 1].toInt() and 0xff
        chars[(a + b) % chars.length].toString()
    }
}

private fun parseJsonObject(
  payload: ByteArray,
  label: String,
): JSONObject {
  val raw = String(
    payload,
    Charsets.UTF_8,
  ).trim('\u0000', '\n', '\r', ' ')

  if (raw.isBlank()) {
    error("$label: respons kamera kosong.")
  }

  return try {
    JSONObject(raw)
  } catch (e: Exception) {
    error(
      "$label: respons bukan JSON valid. " +
        "Data awal: ${raw.take(120)}"
    )
  }
}

  private fun parseSessionId(value: String): Long {
    val clean = value.trim()
    return if (clean.startsWith("0x", true)) clean.substring(2).toLong(16) and 0xffffffffL else clean.toLongOrNull() ?: 0L
  }

  private fun nextSequence(): Long = synchronized(lock) { sequence = (sequence + 1) and 0xffffffffL; sequence }

  private fun writeJson(output: BufferedOutputStream, messageId: Int, sid: Long, seq: Long, json: JSONObject) {
    writeFrame(output, messageId, sid, seq, (json.toString() + "\n\u0000").toByteArray(Charsets.UTF_8))
  }

  private fun writeFrame(output: BufferedOutputStream, messageId: Int, sid: Long, seq: Long, payload: ByteArray) {
    val header = ByteArray(HEADER_SIZE)
    header[0] = 0xff.toByte(); header[1] = 0x01
    putU32LE(header, 4, sid); putU32LE(header, 8, seq)
    header[14] = (messageId and 0xff).toByte(); header[15] = ((messageId shr 8) and 0xff).toByte()
    putU32LE(header, 16, payload.size.toLong())
    output.write(header); output.write(payload); output.flush()
  }

  private fun readFrame(input: InputStream): DvripFrame {
    val header = readExact(input, HEADER_SIZE)
    if ((header[0].toInt() and 0xff) != 0xff) error("Header DVRIP tidak valid.")
    val id = (header[14].toInt() and 0xff) or ((header[15].toInt() and 0xff) shl 8)
    val length = readU32LE(header, 16)
    if (length < 0 || length > MAX_PAYLOAD) error("Payload DVRIP tidak aman.")
    return DvripFrame(id, readExact(input, length.toInt()))
  }

  private fun readExact(input: InputStream, size: Int): ByteArray {
    val bytes = ByteArray(size); var offset = 0
    while (offset < size) { val n = input.read(bytes, offset, size - offset); if (n < 0) error("Koneksi kamera terputus saat membaca DVRIP."); offset += n }
    return bytes
  }

  private fun putU32LE(target: ByteArray, offset: Int, value: Long) {
    for (i in 0..3) target[offset + i] = ((value ushr (8 * i)) and 0xff).toByte()
  }
  private fun readU32LE(source: ByteArray, offset: Int): Long {
    var value = 0L; for (i in 0..3) value = value or ((source[offset + i].toLong() and 0xff) shl (8 * i)); return value
  }
  private fun encodeALaw(sampleValue: Int): Int {
    val segmentEnds = intArrayOf(0x00ff, 0x01ff, 0x03ff, 0x07ff, 0x0fff, 0x1fff, 0x3fff, 0x7fff)
    var sample = sampleValue.coerceIn(-32768, 32767); val mask: Int
    if (sample >= 0) mask = 0xd5 else { mask = 0x55; sample = -sample - 1 }
    sample = sample shr 3
    var segment = 0; while (segment < 8 && sample > segmentEnds[segment]) segment++
    if (segment >= 8) return 0x7f xor mask
    var encoded = segment shl 4
    encoded = encoded or if (segment < 2) ((sample shr 1) and 0x0f) else ((sample shr segment) and 0x0f)
    return (encoded xor mask) and 0xff
  }

  private data class DvripFrame(val messageId: Int, val payload: ByteArray)

  companion object {
    private const val HEADER_SIZE = 20
    private const val MAX_PAYLOAD = 16 * 1024 * 1024
    private const val LOGIN_REQUEST = 1000
    private const val LOGIN_RESPONSE = 1001
    private const val TALK_START = 1430
    private const val TALK_STOP = 1431
    private const val TALK_AUDIO_TO_CAMERA = 1432
    private const val TALK_CLAIM = 1434
    private const val TALK_CLAIM_RESPONSE = 1435
    private const val SAMPLE_RATE = 8000
    private const val FRAME_SAMPLES = 320
  }
}
