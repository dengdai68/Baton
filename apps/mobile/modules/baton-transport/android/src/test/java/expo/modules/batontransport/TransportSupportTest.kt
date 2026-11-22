package expo.modules.batontransport

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

// JVM tests for the platform-independent transport rules (same behavior as the iOS module).
// Run: cd apps/mobile/android && ./gradlew :baton-transport:testDebugUnitTest -i
class TransportSupportTest {
  private fun log(message: String) = println("[TransportSupportTest] $message")

  private fun feedAll(parser: EventStreamParser, vararg chunks: String): List<ServerEvent> =
    chunks.flatMap { chunk ->
      val events = parser.feed(chunk.toByteArray(Charsets.UTF_8))
      log("fed ${chunk.replace("\r", "\\r").replace("\n", "\\n")} -> $events")
      events
    }

  @Test
  fun lfFramedEventsSkipCommentsAndJoinDataLines() {
    val events = feedAll(EventStreamParser(), ": heartbeat\n\nevent: workspace-change\ndata: {\"a\":1}\ndata:  two\n\n")
    assertEquals(listOf(ServerEvent("workspace-change", "{\"a\":1}\n two")), events)
  }

  @Test
  fun crlfFramingSplitAcrossChunksIsReassembled() {
    val events = feedAll(EventStreamParser(), "event: ready\r", "\ndata: x\r\n", "\r", "\ndata: y\r\n\r\n")
    assertEquals(listOf(ServerEvent("ready", "x"), ServerEvent("message", "y")), events)
  }

  @Test
  fun blocksWithoutDataOrNamedEventAreIgnored() {
    val events = feedAll(EventStreamParser(), "id: 7\n\nretry: 10\n\n")
    assertEquals(emptyList<ServerEvent>(), events)
  }

  @Test
  fun namedEventWithoutDataIsDelivered() {
    val events = feedAll(EventStreamParser(), "event:\tping \n\n")
    assertEquals(listOf(ServerEvent("ping", "")), events)
  }

  @Test
  fun invalidUtf8BlockIsDroppedAndTheNextOneDelivered() {
    val parser = EventStreamParser()
    val invalid = byteArrayOf('d'.code.toByte(), 'a'.code.toByte(), 't'.code.toByte(), 'a'.code.toByte(), ':'.code.toByte(), 0xC3.toByte(), '\n'.code.toByte(), '\n'.code.toByte())
    val dropped = parser.feed(invalid)
    log("invalid block -> $dropped")
    assertEquals(emptyList<ServerEvent>(), dropped)
    assertEquals(listOf(ServerEvent("message", "ok")), feedAll(parser, "data: ok\n\n"))
  }

  @Test
  fun multibyteTextSplitInsideACharacterSurvives() {
    val bytes = "data: 任务完成\n\n".toByteArray(Charsets.UTF_8)
    val parser = EventStreamParser()
    val first = parser.feed(bytes.copyOfRange(0, 8))
    val second = parser.feed(bytes.copyOfRange(8, bytes.size))
    log("split multibyte -> $first + $second")
    assertEquals(emptyList<ServerEvent>(), first)
    assertEquals(listOf(ServerEvent("message", "任务完成")), second)
  }

  @Test
  fun largeEventsGrowTheBuffer() {
    val payload = "x".repeat(50_000)
    val parser = EventStreamParser()
    val partial = parser.feed("data: ".toByteArray()) + payload.chunked(4096).flatMap { parser.feed(it.toByteArray()) }
    assertEquals(emptyList<ServerEvent>(), partial)
    val done = parser.feed("\n\n".toByteArray())
    log("large event length=${done.firstOrNull()?.data?.length}")
    assertEquals(listOf(ServerEvent("message", payload)), done)
  }

  @Test
  fun pinKeysLowercaseHostsAndDefaultToHttpsPort() {
    assertEquals("baton.local:443", pinKey("Baton.LOCAL", null))
    assertEquals("192.168.1.8:9443", pinKey("192.168.1.8", 9443))
  }

  @Test
  fun pinStoreRemembersPinsAndConsumesMismatches() {
    PinStore.set("host:1", "ABCDEF")
    assertEquals("abcdef", PinStore.pin("host:1"))
    PinStore.recordMismatch("host:1", "ff")
    assertEquals("ff", PinStore.takeMismatch("host:1"))
    assertNull(PinStore.takeMismatch("host:1"))
  }

  @Test
  fun fingerprintsAreLowercaseHexSha256() {
    assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", sha256Hex("abc".toByteArray()))
    assertEquals(true, PIN_PATTERN.matches(sha256Hex(ByteArray(0))))
    assertEquals(false, PIN_PATTERN.matches("abc"))
  }

  @Test
  fun safeNamesReplaceSeparatorsAndControlCharacters() {
    assertEquals("a_b_c_d.txt", safeFileName("a/b\\c:d.txt"))
    assertEquals("line_break", safeFileName("line\nbreak"))
    assertEquals("download", safeFileName(null))
    assertEquals("download", safeFileName(""))
    assertEquals(120, safeFileName("n".repeat(300)).length)
  }

  @Test
  fun extensionsFollowPathExtensionRules() {
    assertEquals("gz", fileExtension("archive.tar.gz"))
    assertEquals("", fileExtension(".hidden"))
    assertEquals("", fileExtension("file."))
    assertEquals("", fileExtension("file"))
  }

  @Test
  fun cacheNamesHashTheKeyAndKeepTheExtension() {
    val digest = sha256Hex("https://ws|att_1".toByteArray())
    assertEquals("$digest.png", cacheFileName("https://ws|att_1", "横图.png"))
    assertEquals(digest, cacheFileName("https://ws|att_1", null))
    log("cache name -> ${cacheFileName("https://ws|att_1", "横图.png")}")
  }

  @Test
  fun networkMessagesNameTheFailureType() {
    assertEquals("NETWORK: timeout (SocketTimeoutException)", networkMessage(java.net.SocketTimeoutException("timeout")))
    assertEquals("NETWORK: IOException (IOException)", networkMessage(java.io.IOException()))
  }
}
