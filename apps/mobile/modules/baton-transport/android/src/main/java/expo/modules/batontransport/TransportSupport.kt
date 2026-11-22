package expo.modules.batontransport

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

// Pure transport rules shared by the Android module and its JVM unit tests. Each one
// mirrors ios/BatonTransportModule.swift so both platforms behave the same.

internal const val DEFAULT_HTTPS_PORT = 443
private const val FALLBACK_FILE_NAME = "download"
private const val MAX_FILE_NAME_LENGTH = 120
private const val DEFAULT_EVENT = "message"
private const val INITIAL_EVENT_BUFFER_BYTES = 8192
private const val LF: Byte = 0x0A
private const val CR: Byte = 0x0D
private val UNSAFE_FILE_NAME_CHARACTERS = Regex("[/\\\\:\\u0000-\\u001f]")
internal val PIN_PATTERN = Regex("^[a-fA-F0-9]{64}$")

/** Key for certificate pins: "host:port" with the HTTPS default port. */
internal fun pinKey(host: String, port: Int?): String = "${host.lowercase()}:${port ?: DEFAULT_HTTPS_PORT}"

/** Lower-case hex SHA-256, the fingerprint format paired workspaces use. */
internal fun sha256Hex(bytes: ByteArray): String =
  MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** "NETWORK: detail (ExceptionType)", the counterpart of iOS "NETWORK: description (code)". */
internal fun networkMessage(error: Throwable): String {
  val type = error.javaClass.simpleName.ifEmpty { "IOException" }
  val detail = error.message?.takeIf { it.isNotBlank() } ?: type
  return "NETWORK: $detail ($type)"
}

/** Thread-safe pins registered by requests, plus the last mismatching fingerprint per host. */
internal object PinStore {
  private val pins = ConcurrentHashMap<String, String>()
  private val mismatches = ConcurrentHashMap<String, String>()

  /** Remember the paired fingerprint for a host; later requests to it are pinned too. */
  fun set(key: String, pin: String) {
    pins[key] = pin.lowercase()
  }

  /** The fingerprint registered for a host, if any. */
  fun pin(key: String): String? = pins[key]

  /** Keep the fingerprint a host actually presented so the failure can name it. */
  fun recordMismatch(key: String, actual: String) {
    mismatches[key] = actual
  }

  /** Read and clear the last mismatch for a host. */
  fun takeMismatch(key: String): String? = mismatches.remove(key)
}

/** A file-system-safe name (share sheet, previews): no separators or control characters. */
internal fun safeFileName(name: String?): String {
  val cleaned = (name ?: FALLBACK_FILE_NAME).replace(UNSAFE_FILE_NAME_CHARACTERS, "_")
  return if (cleaned.isEmpty()) FALLBACK_FILE_NAME else cleaned.take(MAX_FILE_NAME_LENGTH)
}

/** Extension like NSString.pathExtension: none for "file", "file." or ".hidden". */
internal fun fileExtension(name: String): String {
  val dot = name.lastIndexOf('.')
  return if (dot > 0 && dot < name.length - 1) name.substring(dot + 1) else ""
}

/** Cached immutable content keeps the original extension so previews pick the right viewer. */
internal fun cacheFileName(key: String, fileName: String?): String {
  val digest = sha256Hex(key.toByteArray(Charsets.UTF_8))
  val extension = fileExtension(safeFileName(fileName))
  return if (extension.isEmpty()) digest else "$digest.$extension"
}

/** One server-sent event delivered to JavaScript. */
internal data class ServerEvent(val event: String, val data: String)

/**
 * Server-sent events framing: blocks end with a blank line (LF or CRLF framing),
 * "event:" names the event, "data:" lines join with "\n" and ":" lines are comments.
 * A block that is not valid UTF-8 is dropped, as on iOS.
 */
internal class EventStreamParser {
  private var buffer = ByteArray(INITIAL_EVENT_BUFFER_BYTES)
  private var size = 0

  /** Append received bytes and return every event they complete, in order. */
  fun feed(chunk: ByteArray, length: Int = chunk.size): List<ServerEvent> {
    require(length in 0..chunk.size) { "length $length outside chunk of ${chunk.size} bytes" }
    // Earlier bytes held no complete boundary; one may start up to 3 bytes before the old end.
    var searchFrom = maxOf(0, size - 3)
    append(chunk, length)
    val events = ArrayList<ServerEvent>()
    var blockStart = 0
    while (true) {
      val (index, boundaryLength) = earliestBoundary(searchFrom) ?: break
      parseBlock(blockStart, index)?.let(events::add)
      blockStart = index + boundaryLength
      searchFrom = blockStart
    }
    if (blockStart > 0) discard(blockStart)
    return events
  }

  private fun append(chunk: ByteArray, length: Int) {
    if (size + length > buffer.size) buffer = buffer.copyOf(maxOf(buffer.size * 2, size + length))
    System.arraycopy(chunk, 0, buffer, size, length)
    size += length
  }

  private fun discard(count: Int) {
    System.arraycopy(buffer, count, buffer, 0, size - count)
    size -= count
  }

  /** Index and length of the first "\n\n" or "\r\n\r\n" at or after [from]. */
  private fun earliestBoundary(from: Int): Pair<Int, Int>? {
    for (index in from until size - 1) {
      if (buffer[index] == LF && buffer[index + 1] == LF) return index to 2
      if (index + 3 < size && buffer[index] == CR && buffer[index + 1] == LF && buffer[index + 2] == CR && buffer[index + 3] == LF) {
        return index to 4
      }
    }
    return null
  }

  private fun parseBlock(start: Int, end: Int): ServerEvent? {
    val text = decodeUtf8(start, end - start) ?: return null
    var event = DEFAULT_EVENT
    val lines = ArrayList<String>()
    for (line in text.replace("\r\n", "\n").split('\n')) {
      if (line.startsWith(":")) continue
      if (line.startsWith("event:")) {
        event = line.substring(6).trim { it == '\t' || it.category == CharCategory.SPACE_SEPARATOR }
      } else if (line.startsWith("data:")) {
        lines.add(line.substring(5).removePrefix(" "))
      }
    }
    return if (lines.isNotEmpty() || event != DEFAULT_EVENT) ServerEvent(event, lines.joinToString("\n")) else null
  }

  private fun decodeUtf8(offset: Int, length: Int): String? = try {
    Charsets.UTF_8.newDecoder()
      .onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT)
      .decode(ByteBuffer.wrap(buffer, offset, length))
      .toString()
  } catch (_: CharacterCodingException) {
    null
  }
}
