
package expo.modules.cctvtalkback

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI

class CctvTalkbackModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("CctvTalkback")

    AsyncFunction("checkSupport") { url: String ->
      var socket: Socket? = null

      try {
        val uri = URI(url.trim())

        if (
          uri.scheme?.lowercase() != "rtsp" ||
          uri.host.isNullOrBlank()
        ) {
          return@AsyncFunction mapOf(
            "reachable" to false,
            "supported" to false,
            "message" to "Gunakan alamat RTSP kamera yang valid."
          )
        }

        val port = if (uri.port > 0) uri.port else 554

        socket = Socket()
        socket.connect(
          InetSocketAddress(uri.host, port),
          3000
        )
        socket.soTimeout = 3000

        val output = socket.getOutputStream()
        val request =
          "OPTIONS ${uri.scheme}://${uri.host}:$port/ RTSP/1.0\r\n" +
          "CSeq: 1\r\n" +
          "User-Agent: CCTV-Universal-Monitor\r\n\r\n"

        output.write(request.toByteArray(Charsets.UTF_8))
        output.flush()

        val input = socket.getInputStream()
        val response = StringBuilder()
        val buffer = ByteArray(1024)

        val count = input.read(buffer)
        if (count > 0) {
          response.append(
            String(buffer, 0, count, Charsets.UTF_8)
          )
        }

        val responseText = response.toString()
        val statusMatch = Regex(
          """RTSP/\d+\.\d+\s+(\d+)"""
        ).find(responseText)

        val statusCode =
          statusMatch?.groupValues?.get(1)?.toIntOrNull()

        mapOf(
          "reachable" to true,
          "statusCode" to statusCode,
          "supported" to false,
          "message" to if (statusCode == 200) {
            "RTSP merespons. Dukungan audio talkback belum terverifikasi."
          } else {
            "RTSP terhubung, tetapi respons kamera perlu diperiksa."
          }
        )
      } catch (error: Exception) {
        mapOf(
          "reachable" to false,
          "supported" to false,
          "message" to (
            error.message
              ?: "Kamera tidak dapat diperiksa."
          )
        )
      } finally {
        try {
          socket?.close()
        } catch (_: Exception) {
        }
      }
    }
  }
}
