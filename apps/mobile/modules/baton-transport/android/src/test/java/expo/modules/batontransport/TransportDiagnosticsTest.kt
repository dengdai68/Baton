package expo.modules.batontransport

import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy

// JVM tests for the opt-in timing line (log.tag.BatonTransport DEBUG). A fake clock drives
// the phases, so the expected numbers are exact.
// Run: cd apps/mobile/android && ./gradlew :baton-transport:testDebugUnitTest -i
class TransportDiagnosticsTest {
  private fun log(message: String) = println("[TransportDiagnosticsTest] $message")

  private var nowMillis = 0L
  private val clock = { nowMillis * 1_000_000L }
  private val request = Request.Builder().url("https://workspace.example/api/tasks?page=1&search=secret").build()
  private val call = OkHttpClient().newCall(request)
  private val address = InetSocketAddress.createUnresolved("workspace.example", 443)

  private fun at(millis: Long, event: () -> Unit) {
    nowMillis = millis
    event()
  }

  private fun ok(): Response = Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").build()

  @Test
  fun newConnectionSplitsTcpAndTlsAndKeepsTheQueryOut() {
    val listener = TimingListener(clock)
    at(0) { listener.dnsStart(call, "workspace.example") }
    at(2) { listener.dnsEnd(call, "workspace.example", emptyList()) }
    at(2) { listener.connectStart(call, address, Proxy.NO_PROXY) }
    at(37) { listener.secureConnectStart(call) }
    at(157) { listener.secureConnectEnd(call, null) }
    at(157) { listener.connectEnd(call, address, Proxy.NO_PROXY, Protocol.HTTP_1_1) }
    at(160) { listener.requestHeadersStart(call) }
    at(800) { listener.responseHeadersEnd(call, ok()) }
    at(810) { listener.responseBodyEnd(call, 18432) }
    nowMillis = 812
    val line = listener.summary("GET", request.url.encodedPath, null)
    log("new connection -> $line")
    assertEquals("GET /api/tasks 200 total=812ms ttfb=640ms new(tcp=35ms tls=120ms) dns=2ms 18432B", line)
  }

  @Test
  fun pooledConnectionIsReportedAsReused() {
    val listener = TimingListener(clock)
    at(1) { listener.requestHeadersStart(call) }
    at(31) { listener.responseHeadersEnd(call, ok()) }
    at(33) { listener.responseBodyEnd(call, 512) }
    nowMillis = 34
    val line = listener.summary("GET", "/api/communications", null)
    log("reused connection -> $line")
    assertEquals("GET /api/communications 200 total=34ms ttfb=30ms reused 512B", line)
  }

  @Test
  fun failedCallNamesTheErrorType() {
    val listener = TimingListener(clock)
    at(0) { listener.connectStart(call, address, Proxy.NO_PROXY) }
    nowMillis = 15_000
    val line = listener.summary("GET", "/api/tasks", IOException("timeout"))
    log("failed call -> $line")
    assertEquals("GET /api/tasks FAILED(IOException) total=15000ms new(incomplete 15000ms)", line)
  }
}
