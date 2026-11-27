package expo.modules.batontransport

import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.Dispatcher
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Socket
import java.security.KeyStore
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

// Android counterpart of ios/BatonTransportModule.swift: the same JavaScript contract
// (modules/baton-transport/index.ts), certificate pins, error codes and cache layout.

private const val PROBE_TIMEOUT_MS = 15_000
private const val REQUESTS_PER_HOST = 6
private const val STREAMS_PER_HOST = 16
private const val STREAM_LIFETIME_HOURS = 24L
private const val STREAM_CHUNK_BYTES = 8192
private const val LOGIN_PATH = "/login"
private const val CACHE_DIRECTORY = "baton-transport"
private const val RESPONSE_BASE64 = "base64"
private const val RESPONSE_FILE = "file"
private val SUCCESS_STATUS = 200..299
private val BODY_REQUIRED_METHODS = setOf("POST", "PUT", "PATCH")

/** One HTTPS request issued by JavaScript. Exactly one body source may be set. */
class TransportRequest : Record {
  @Field var url: String = ""
  @Field var method: String = "GET"
  @Field var headers: Map<String, String> = emptyMap()

  /** UTF-8 text body (JSON). */
  @Field var body: String? = null

  /** Binary body encoded as base64. */
  @Field var bodyBase64: String? = null

  /** file:// URI streamed from disk (attachments). */
  @Field var bodyFile: String? = null

  /** Lower-case hex SHA-256 of the expected leaf certificate (self-signed local workspaces). */
  @Field var pin: String? = null
  @Field var relay: String? = null
  @Field var deviceKey: String? = null

  /** "text" (default), "base64" or "file". */
  @Field var responseType: String = "text"

  /** Suggested file name for "file" responses. */
  @Field var fileName: String? = null

  /** Immutable content key: a cached "file" response is returned without a request. */
  @Field var cacheKey: String? = null

  /** Seconds of silence before the request fails (connect, read and write). */
  @Field var timeout: Double = 60.0
}

/** Failures cross the bridge as "CODE: detail" so JavaScript can branch on the code. */
class TransportFailure(message: String, cause: Throwable? = null) : CodedException(message, cause)

/** Accepts a paired workspace only when its leaf certificate matches the pinned fingerprint. */
private class PinnedTrustManager(private val key: String, private val expected: String) : X509TrustManager {
  override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
    throw CertificateException("client certificates are not used")
  }

  override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
    val leaf = chain.firstOrNull() ?: throw CertificateException("empty certificate chain")
    val actual = sha256Hex(leaf.encoded)
    if (actual != expected) {
      PinStore.recordMismatch(key, actual)
      throw CertificateException("certificate does not match the paired fingerprint")
    }
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

/** The pin authenticates a paired server, so its name is not matched (as on iOS). */
private val PINNED_HOST_VERIFIER = HostnameVerifier { _, _ -> true }

/** TLS settings for one trust decision: the socket factory and the trust manager behind it. */
private class Tls(val factory: SSLSocketFactory, val trust: X509TrustManager)

/** The platform trust store (cloud workspaces with public certificates). */
private fun systemTrustManager(): X509TrustManager {
  val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
  factory.init(null as KeyStore?)
  return factory.trustManagers.filterIsInstance<X509TrustManager>().first()
}

/** A TLS context of its own (own session cache) around one trust manager. */
private fun tls(trust: X509TrustManager): Tls =
  Tls(SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), null) }.socketFactory, trust)

/** Probe an HTTPS origin with no credentials and stop after the TLS handshake. */
private object CertificateProbe {
  fun inspect(host: String, port: Int): Map<String, Any> {
    var presented: Array<X509Certificate>? = null
    var presentedAuthType = "GENERIC"
    val capture = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
        throw CertificateException("client certificates are not used")
      }

      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        presented = chain
        presentedAuthType = authType
      }

      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
    return Socket().use { raw ->
      raw.connect(InetSocketAddress(host, port), PROBE_TIMEOUT_MS)
      raw.soTimeout = PROBE_TIMEOUT_MS
      (tls(capture).factory.createSocket(raw, host, port, true) as SSLSocket).use { socket ->
        val handshake = runCatching { socket.startHandshake() }
        val chain = presented ?: throw (handshake.exceptionOrNull() ?: TransportFailure("无法读取服务器证书"))
        val leaf = chain.firstOrNull() ?: throw TransportFailure("无法读取服务器证书")
        val trusted = handshake.isSuccess &&
          runCatching { systemTrustManager().checkServerTrusted(chain, presentedAuthType) }.isSuccess &&
          HttpsURLConnection.getDefaultHostnameVerifier().verify(host, socket.session)
        mapOf("fingerprint" to sha256Hex(leaf.encoded), "trusted" to trusted)
      }
    }
  }
}

class BatonTransportModule : Module() {
  private val requestClient = httpClient(REQUESTS_PER_HOST).build()

  // The server sends a heartbeat every 15 seconds; the read timeout catches a dead link.
  private val streamClient = httpClient(STREAMS_PER_HOST).callTimeout(STREAM_LIFETIME_HOURS, TimeUnit.HOURS).build()
  private val pinnedTls = ConcurrentHashMap<String, Tls>()
  private val routes = mutableMapOf<Pair<String,String>, RelayTls>()
  private val streamCalls = ConcurrentHashMap<String, Call>()
  private val probes: ExecutorService = Executors.newCachedThreadPool()

  override fun definition() = ModuleDefinition {
    Name("BatonTransport")
    Events("onStreamEvent", "onStreamEnd")

    AsyncFunction("newDeviceKey") { UUID.randomUUID().toString().replace("-","") }
    AsyncFunction("removeDeviceKey") { key: String ->
      synchronized(routes) {
        routes.keys.filter { it.first == key }.forEach { routes.remove(it)?.close() }
        RelayTls.remove(key)
      }
    }
    AsyncFunction("inspectCertificate") { origin: String, promise: Promise ->
      val url = origin.toHttpUrlOrNull()
      if (url == null || !url.isHttps || url.host.isEmpty()) throw TransportFailure("INVALID_URL")
      probes.execute {
        try {
          promise.resolve(CertificateProbe.inspect(url.host, url.port))
        } catch (failure: TransportFailure) {
          promise.reject(failure)
        } catch (error: Exception) {
          promise.reject(TransportFailure(networkMessage(error), error))
        }
      }
    }

    AsyncFunction("request") { options: TransportRequest, promise: Promise ->
      perform(options, promise)
    }

    Function("openStream") { id: String, options: TransportRequest ->
      openStream(id, options)
    }

    Function("closeStream") { id: String ->
      streamCalls.remove(id)?.cancel()
      Unit
    }

    AsyncFunction<Unit>("clearCache") {
      val directory = cacheRoot()
      if (directory.exists() && !directory.deleteRecursively()) {
        throw TransportFailure("CACHE: unable to clear ${directory.name}")
      }
    }

    OnDestroy {
      synchronized(routes) { routes.values.forEach { it.close() }; routes.clear() }
      streamCalls.values.forEach(Call::cancel)
      streamCalls.clear()
      requestClient.dispatcher.cancelAll()
      streamClient.dispatcher.cancelAll()
      probes.shutdownNow()
    }
  }

  /** Shared settings: no cookies, no cache and no redirects (a 3xx is returned as is, like iOS). */
  private fun httpClient(perHost: Int): OkHttpClient.Builder = OkHttpClient.Builder()
    .dispatcher(Dispatcher().apply { maxRequestsPerHost = perHost })
    .followRedirects(false)
    .followSslRedirects(false)

  /** Validate the URL, register its pin and build the request (without body). */
  private fun prepare(options: TransportRequest): Request.Builder {
    val url = options.url.toHttpUrlOrNull()
    if (url == null || url.host.isEmpty() || !(url.isHttps || options.pin == null)) {
      throw TransportFailure("INVALID_URL: ${options.url.take(80)}")
    }
    options.pin?.let { pin ->
      if (!PIN_PATTERN.matches(pin)) throw TransportFailure("INVALID_PIN: certificate fingerprint must be 64 hex characters")
      if (options.relay == null) PinStore.set(pinKey(url.host, url.port), pin)
    }
    val builder = Request.Builder().url(url)
    for ((name, value) in options.headers) {
      try {
        builder.header(name, value)
      } catch (error: IllegalArgumentException) {
        throw TransportFailure("INVALID_HEADER: $name", error)
      }
    }
    return builder
  }

  /**
   * The client for one request: per-request timeouts, and the pinned TLS context when the
   * host has a registered pin. A fresh client (login) never reuses a connection or TLS session.
   */
  private fun clientFor(base: OkHttpClient, url: HttpUrl, options: TransportRequest, fresh: Boolean): OkHttpClient {
    val millis = (options.timeout * 1000).toLong().coerceAtLeast(1)
    val builder = base.newBuilder()
      .connectTimeout(millis, TimeUnit.MILLISECONDS)
      .readTimeout(millis, TimeUnit.MILLISECONDS)
      .writeTimeout(millis, TimeUnit.MILLISECONDS)
    options.relay?.let { value ->
      val relay = value.toHttpUrlOrNull() ?: throw TransportFailure("INVALID_URL")
      require(relay.isHttps && relay.username.isEmpty() && relay.password.isEmpty() && relay.encodedPath == "/" && relay.query == null)
      require(url.isHttps && Regex("[0-9a-f]{32}\\.baton\\.invalid").matches(url.host) && url.port == 443)
      val handle = requireNotNull(options.deviceKey)
      val pin = requireNotNull(options.pin)
      val route = synchronized(routes) {
        routes.getOrPut(handle to "$value|$pin|${url.host}") { RelayTls(relay,url.host,pin,handle,url.encodedPath == "/relay/redeem") }
      }
      return route.configure(builder).build()
    }
    if (url.isHttps) {
      val key = pinKey(url.host, url.port)
      val pin = PinStore.pin(key)
      if (pin != null) {
        val pinned = if (fresh) tls(PinnedTrustManager(key, pin)) else pinnedTls.getOrPut("$key|$pin") { tls(PinnedTrustManager(key, pin)) }
        builder.sslSocketFactory(pinned.factory, pinned.trust).hostnameVerifier(PINNED_HOST_VERIFIER)
      } else if (fresh) {
        val system = tls(systemTrustManager())
        builder.sslSocketFactory(system.factory, system.trust)
      }
    }
    if (fresh) builder.connectionPool(ConnectionPool())
    return builder.build()
  }

  private fun perform(options: TransportRequest, promise: Promise) {
    val builder = prepare(options)
    val method = options.method.uppercase()
    val cached = options.cacheKey?.let { cacheFile(it, options.fileName) }
    if (options.responseType == RESPONSE_FILE && cached != null && cached.exists()) {
      promise.resolve(result(200, emptyMap(), fileUri = Uri.fromFile(cached).toString()) + ("cached" to true))
      return
    }
    val request = try {
      builder.method(method, requestBody(options, method)).build()
    } catch (error: IllegalArgumentException) {
      throw TransportFailure("INVALID_BODY: ${error.message}", error)
    }
    val url = request.url
    val key = pinKey(url.host, url.port)
    // Credentials always use a fresh TLS connection with the leaf observed at login.
    val login = url.encodedPath == LOGIN_PATH
    val client = clientFor(requestClient, url, options, fresh = login)
    client.newCall(request).enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        if (login) client.connectionPool.evictAll()
        promise.reject(failureFor(key, e))
      }

      override fun onResponse(call: Call, response: Response) {
        try {
          promise.resolve(response.use { deliver(it, options, cached) })
        } catch (failure: TransportFailure) {
          promise.reject(failure)
        } catch (error: IOException) {
          promise.reject(failureFor(key, error))
        } finally {
          if (login) client.connectionPool.evictAll()
        }
      }
    })
  }

  /** A pin mismatch wins over the generic network error it caused. */
  private fun failureFor(key: String, error: Throwable): TransportFailure =
    PinStore.takeMismatch(key)?.let { TransportFailure("PIN_MISMATCH: $it", error) }
      ?: TransportFailure(networkMessage(error), error)

  private fun requestBody(options: TransportRequest, method: String): RequestBody? {
    val type = options.headers.entries
      .firstOrNull { it.key.equals("Content-Type", ignoreCase = true) }
      ?.value?.toMediaTypeOrNull()
    options.bodyFile?.let { file ->
      val uri = Uri.parse(file)
      val path = uri.path
      if (uri.scheme != "file" || path.isNullOrEmpty()) throw TransportFailure("INVALID_BODY: bodyFile must be a file:// URI")
      return File(path).asRequestBody(type)
    }
    options.bodyBase64?.let { encoded ->
      val bytes = try {
        Base64.decode(encoded, Base64.DEFAULT)
      } catch (error: IllegalArgumentException) {
        throw TransportFailure("INVALID_BODY: bodyBase64 is not valid base64", error)
      }
      return bytes.toRequestBody(type)
    }
    options.body?.let { return it.toByteArray(Charsets.UTF_8).toRequestBody(type) }
    return if (method in BODY_REQUIRED_METHODS) ByteArray(0).toRequestBody(type) else null
  }

  private fun deliver(response: Response, options: TransportRequest, cached: File?): Map<String, Any?> {
    val status = response.code
    val headers = LinkedHashMap<String, String>()
    for (name in response.headers.names()) headers[name.lowercase()] = response.headers.values(name).joinToString(", ")
    val bytes = { response.body?.bytes() ?: ByteArray(0) }
    return when (options.responseType) {
      RESPONSE_BASE64 -> result(status, headers, body = Base64.encodeToString(bytes(), Base64.NO_WRAP))
      RESPONSE_FILE -> if (status !in SUCCESS_STATUS) {
        result(status, headers, body = String(bytes(), Charsets.UTF_8))
      } else {
        val target = cached ?: downloadFile(options.fileName)
        save(response, target)
        result(status, headers, fileUri = Uri.fromFile(target).toString())
      }
      else -> result(status, headers, body = String(bytes(), Charsets.UTF_8))
    }
  }

  private fun result(status: Int, headers: Map<String, String>, body: String? = null, fileUri: String? = null): Map<String, Any?> =
    mapOf("status" to status, "headers" to headers, "body" to body, "fileUri" to fileUri)

  /** Stream the body to a temporary sibling, then rename it into place (atomic, like iOS). */
  private fun save(response: Response, target: File) {
    val directory = target.parentFile ?: throw TransportFailure("FILE: invalid target ${target.name}")
    if (!directory.isDirectory && !directory.mkdirs()) throw TransportFailure("FILE: unable to create ${directory.name}")
    val partial = File(directory, ".${target.name}.${UUID.randomUUID()}.part")
    try {
      val body = response.body ?: throw TransportFailure("FILE: empty response")
      body.byteStream().use { input -> FileOutputStream(partial).use { output -> input.copyTo(output) } }
      if (!partial.renameTo(target)) throw TransportFailure("FILE: unable to save ${target.name}")
    } finally {
      if (partial.exists()) partial.delete()
    }
  }

  private fun openStream(id: String, options: TransportRequest) {
    val request = prepare(options).build()
    val url = request.url
    val key = pinKey(url.host, url.port)
    val call = clientFor(streamClient, url, options, fresh = false).newCall(request)
    streamCalls.put(id, call)?.cancel()
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) = finishStream(id, call, key, 0, e)

      override fun onResponse(call: Call, response: Response) {
        var failure: IOException? = null
        response.use {
          try {
            relayEvents(id, it)
          } catch (error: IOException) {
            failure = error
          }
        }
        finishStream(id, call, key, response.code, failure)
      }
    })
  }

  /** Read the event stream until it ends, forwarding each event in order. */
  private fun relayEvents(id: String, response: Response) {
    val input = response.body?.byteStream() ?: return
    val parser = EventStreamParser()
    val chunk = ByteArray(STREAM_CHUNK_BYTES)
    while (true) {
      val read = input.read(chunk)
      if (read < 0) return
      for (event in parser.feed(chunk, read)) {
        sendEvent("onStreamEvent", mapOf("id" to id, "event" to event.event, "data" to event.data))
      }
    }
  }

  /** Report the end once; a cancelled stream (closeStream) ends without an error. */
  private fun finishStream(id: String, call: Call, key: String, status: Int, error: IOException?) {
    streamCalls.remove(id, call)
    val message = PinStore.takeMismatch(key)?.let { "PIN_MISMATCH: $it" }
      ?: error?.takeUnless { call.isCanceled() }?.let(::networkMessage)
    sendEvent("onStreamEnd", mapOf("id" to id, "status" to status, "error" to message))
  }

  private fun cacheRoot(): File = File(appContext.cacheDirectory, CACHE_DIRECTORY)

  private fun cacheFile(key: String, fileName: String?): File = File(File(cacheRoot(), "cache"), cacheFileName(key, fileName))

  /** Downloads keep their real name (for the share sheet) inside a unique directory. */
  private fun downloadFile(name: String?): File =
    File(File(File(cacheRoot(), "downloads"), UUID.randomUUID().toString()), safeFileName(name))
}
