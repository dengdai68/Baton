package expo.modules.batontransport

import android.util.Log
import okhttp3.Call
import okhttp3.Connection
import okhttp3.EventListener
import okhttp3.Handshake
import okhttp3.Protocol
import okhttp3.Response
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy

// Opt-in request timing for diagnosing slow links (public relay, tunnel, Wi-Fi power save).
// Off by default; enable on a device with:
//   adb shell setprop log.tag.BatonTransport DEBUG
// then read: adb logcat -s BatonTransport
// One line per call: method, path (no query, no headers, no body), status, total time,
// time to first byte, and whether the call opened a new connection (with TCP and TLS cost).

internal const val DIAGNOSTICS_TAG = "BatonTransport"
private const val NANOS_PER_MILLI = 1_000_000L

/** True while the diagnostics log tag is enabled (checked per call, so setprop applies at once). */
internal fun diagnosticsEnabled(): Boolean = Log.isLoggable(DIAGNOSTICS_TAG, Log.DEBUG)

/** Collects the phases of one call and logs a single summary line when it ends. */
internal class TimingListener(private val clock: () -> Long = System::nanoTime) : EventListener() {
  private val callStart = clock()
  private var dnsStart = 0L
  private var dnsMillis = -1L
  private var connecting = false
  private var connectStart = 0L
  private var connectMillis = -1L
  private var tlsStart = 0L
  private var tlsMillis = -1L
  private var requestStart = 0L
  private var firstByteMillis = -1L
  private var bodyBytes = -1L
  private var status = 0
  private var protocol = ""

  private fun since(start: Long): Long = (clock() - start) / NANOS_PER_MILLI

  override fun dnsStart(call: Call, domainName: String) {
    dnsStart = clock()
  }

  override fun dnsEnd(call: Call, domainName: String, inetAddressList: List<InetAddress>) {
    dnsMillis = since(dnsStart)
  }

  override fun connectStart(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy) {
    connecting = true
    connectStart = clock()
  }

  override fun secureConnectStart(call: Call) {
    tlsStart = clock()
  }

  override fun secureConnectEnd(call: Call, handshake: Handshake?) {
    tlsMillis = since(tlsStart)
  }

  override fun connectEnd(call: Call, inetSocketAddress: InetSocketAddress, proxy: Proxy, protocol: Protocol?) {
    connectMillis = since(connectStart)
  }

  override fun connectionAcquired(call: Call, connection: Connection) {
    protocol = connection.protocol().toString()
  }

  override fun requestHeadersStart(call: Call) {
    requestStart = clock()
  }

  override fun responseHeadersEnd(call: Call, response: Response) {
    firstByteMillis = since(requestStart)
    status = response.code
  }

  override fun responseBodyEnd(call: Call, byteCount: Long) {
    bodyBytes = byteCount
  }

  override fun callEnd(call: Call) = report(call, null)

  override fun callFailed(call: Call, ioe: IOException) = report(call, ioe)

  private fun report(call: Call, error: IOException?) {
    Log.d(DIAGNOSTICS_TAG, summary(call.request().method, call.request().url.encodedPath, error))
  }

  /** "GET /api/tasks 200 total=812ms ttfb=640ms new(tcp=35ms tls=120ms) dns=2ms 18432B http/1.1". */
  internal fun summary(method: String, path: String, error: Throwable?): String {
    val connection = when {
      !connecting -> "reused"
      connectMillis < 0 -> "new(incomplete ${since(connectStart)}ms)"
      else -> {
        val tcp = if (tlsMillis >= 0) connectMillis - tlsMillis else connectMillis
        "new(tcp=${tcp}ms" + (if (tlsMillis >= 0) " tls=${tlsMillis}ms" else "") + ")"
      }
    }
    val parts = mutableListOf(method, path, if (error != null) "FAILED(${error.javaClass.simpleName})" else status.toString())
    parts += "total=${since(callStart)}ms"
    if (firstByteMillis >= 0) parts += "ttfb=${firstByteMillis}ms"
    parts += connection
    if (dnsMillis >= 0) parts += "dns=${dnsMillis}ms"
    if (bodyBytes >= 0) parts += "${bodyBytes}B"
    if (protocol.isNotEmpty()) parts += protocol
    return parts.joinToString(" ")
  }
}
