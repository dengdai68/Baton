package expo.modules.batontransport

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Principal
import java.security.PrivateKey
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import javax.net.ssl.*
import okhttp3.ConnectionPool
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol

/** Per-channel loopback CONNECT proxy. Both sides carry the inner TLS records unchanged.
 * Only the configured opaque route can be opened, never a client-supplied destination.
 */
internal class RelayTls(private val relay: HttpUrl, private val route: String, pin: String, handle: String, create: Boolean) {
  private val loopback = InetAddress.getByName("127.0.0.1")
  private val listener = ServerSocket(0, 8, loopback)
  private val workers = Executors.newCachedThreadPool()
  private val peers = ConcurrentHashMap.newKeySet<Socket>()
  private val pool = ConnectionPool()
  private val device = deviceKey(handle, create)
  private val trust = object : X509TrustManager {
    override fun checkClientTrusted(chain: Array<X509Certificate>, auth: String) = throw CertificateException()
    override fun checkServerTrusted(chain: Array<X509Certificate>, auth: String) {
      if (chain.isEmpty() || sha256Hex(chain[0].publicKey.encoded) != pin) throw CertificateException("PIN_MISMATCH")
    }
    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
  }
  private val context = SSLContext.getInstance("TLSv1.3").apply {
    init(arrayOf(object : X509ExtendedKeyManager() {
      override fun chooseClientAlias(types: Array<String>?, issuers: Array<Principal>?, socket: Socket?) = handle
      override fun getClientAliases(type: String?, issuers: Array<Principal>?) = arrayOf(handle)
      override fun getCertificateChain(alias: String?) = device.certificateChain.map { it as X509Certificate }.toTypedArray()
      override fun getPrivateKey(alias: String?): PrivateKey = device.privateKey
      override fun getServerAliases(type: String?, issuers: Array<Principal>?): Array<String>? = null
      override fun chooseServerAlias(type: String?, issuers: Array<Principal>?, socket: Socket?): String? = null
    }), arrayOf(trust), null)
  }
  init {
    workers.execute {
      try {
        while (!listener.isClosed) {
          val local = listener.accept()
          if (peers.size >= 48) local.close() else { peers.add(local); workers.execute { forward(local) } }
        }
      } catch (_: IOException) { close() }
    }
  }
  private fun header(socket: Socket): String {
    val bytes = java.io.ByteArrayOutputStream()
    val input = socket.getInputStream()
    var tail = 0
    while (bytes.size() < 8192) {
      val value = input.read()
      if (value < 0) throw IOException("Relay closed")
      bytes.write(value)
      tail = (tail shl 8) or value
      if (tail == 0x0d0a0d0a) return bytes.toString("US-ASCII").substringBefore("\r\n")
    }
    throw IOException("Relay header too large")
  }
  private fun forward(local: Socket) {
    val raw = Socket()
    peers.add(raw)
    try {
      local.soTimeout = 12000
      if (header(local) != "CONNECT $route:443 HTTP/1.1") return
      raw.connect(InetSocketAddress(relay.host,relay.port),12000)
      val tls = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(raw,relay.host,relay.port,true) as SSLSocket
      tls.use { outer ->
        outer.soTimeout = 12000
        outer.enabledProtocols = arrayOf("TLSv1.3")
        outer.sslParameters = outer.sslParameters.apply { endpointIdentificationAlgorithm = "HTTPS" }
        outer.startHandshake()
        outer.outputStream.write("CONNECT $route:443 HTTP/1.1\r\nHost: $route:443\r\n\r\n".toByteArray())
        val status = header(outer)
        if (!status.startsWith("HTTP/1.1 200 ")) {
          local.outputStream.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".toByteArray()); return
        }
        local.outputStream.write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
        local.soTimeout = 0; outer.soTimeout = 0
        workers.execute { try { local.inputStream.copyTo(outer.outputStream) } catch (_: IOException) {} finally { raw.close() } }
        outer.inputStream.copyTo(local.outputStream)
      }
    } catch (_: IOException) {} finally {
      local.close(); raw.close(); peers.remove(local); peers.remove(raw)
    }
  }
  fun configure(builder: OkHttpClient.Builder): OkHttpClient.Builder = builder
    .proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress(loopback,listener.localPort)))
    .sslSocketFactory(context.socketFactory,trust).hostnameVerifier { host, _ -> host == route }
    .protocols(listOf(Protocol.HTTP_1_1)).connectionPool(pool)
  fun close() {
    listener.close(); peers.forEach { it.close() }; pool.evictAll(); workers.shutdown()
  }
  companion object {
    private fun alias(handle: String): String {
      require(Regex("[0-9a-f]{32}").matches(handle))
      return "baton.relay.$handle"
    }
    private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    @Synchronized private fun deviceKey(handle: String, create: Boolean): KeyStore.PrivateKeyEntry {
      val key = alias(handle)
      val db = store()
      if (!db.containsAlias(key)) {
        require(create) { "无法读取设备密钥" }
        val generator = KeyPairGenerator.getInstance("EC","AndroidKeyStore")
        generator.initialize(KeyGenParameterSpec.Builder(key,KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
          .setDigests(KeyProperties.DIGEST_SHA256).build())
        generator.generateKeyPair()
      }
      return db.getEntry(key,null) as KeyStore.PrivateKeyEntry
    }
    fun remove(handle: String) = store().deleteEntry(alias(handle))
  }
}
