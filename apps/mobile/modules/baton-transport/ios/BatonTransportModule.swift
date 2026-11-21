import CryptoKit
import ExpoModulesCore
import Foundation

/// One HTTPS request issued by JavaScript. Exactly one body source may be set.
struct TransportRequest: Record {
  @Field var url: String = ""
  @Field var method: String = "GET"
  @Field var headers: [String: String] = [:]
  /// UTF-8 text body (JSON).
  @Field var body: String?
  /// Binary body encoded as base64.
  @Field var bodyBase64: String?
  /// file:// URI streamed from disk (attachments).
  @Field var bodyFile: String?
  /// Lower-case hex SHA-256 of the expected leaf certificate (self-signed local workspaces).
  @Field var pin: String?
  /// "text" (default), "base64" or "file".
  @Field var responseType: String = "text"
  /// Suggested file name for "file" responses.
  @Field var fileName: String?
  /// Immutable content key: a cached "file" response is returned without a request.
  @Field var cacheKey: String?
  @Field var timeout: Double = 60
}

/// Failures cross the bridge as "CODE: detail" so JavaScript can branch on the code.
final class TransportFailure: GenericException<String> {
  override var reason: String { param }
}

/// Key for certificate pins: "host:port" with the HTTPS default port.
func pinKey(host: String, port: Int?) -> String {
  "\(host.lowercased()):\(port ?? 443)"
}

/// Thread-safe pins registered by requests, plus the last mismatching fingerprint per host.
final class PinStore: @unchecked Sendable {
  static let shared = PinStore()
  private var pins: [String: String] = [:]
  private var mismatches: [String: String] = [:]
  private let lock = NSLock()

  func set(_ key: String, _ pin: String) {
    lock.lock(); defer { lock.unlock() }
    pins[key] = pin.lowercased()
  }
  func pin(for key: String) -> String? {
    lock.lock(); defer { lock.unlock() }
    return pins[key]
  }
  func recordMismatch(_ key: String, _ actual: String) {
    lock.lock(); defer { lock.unlock() }
    mismatches[key] = actual
  }
  func takeMismatch(_ key: String) -> String? {
    lock.lock(); defer { lock.unlock() }
    return mismatches.removeValue(forKey: key)
  }
}

/// Trusts a pinned host only when its leaf certificate matches the paired fingerprint;
/// hosts without a pin use the system trust store (cloud workspaces).
class PinningDelegate: NSObject, URLSessionDelegate {
  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let space = challenge.protectionSpace
    guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = space.serverTrust else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    let key = pinKey(host: space.host, port: space.port)
    guard let expected = PinStore.shared.pin(for: key) else {
      completionHandler(.performDefaultHandling, nil)
      return
    }
    guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    let actual = SHA256.hash(data: SecCertificateCopyData(leaf) as Data).map { String(format: "%02x", $0) }.joined()
    if actual == expected {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      PinStore.shared.recordMismatch(key, actual)
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }
}

/// Server-sent events: parses "event:" / "data:" blocks and reports each to JavaScript.
final class StreamDelegate: PinningDelegate, URLSessionDataDelegate, @unchecked Sendable {
  private struct StreamState {
    let id: String
    let key: String
    var status = 0
    var buffer = Data()
  }
  private var streams: [Int: StreamState] = [:]
  private let lock = NSLock()
  var onEvent: (String, String, String) -> Void = { _, _, _ in }
  var onEnd: (String, Int, String?) -> Void = { _, _, _ in }

  func register(_ task: URLSessionTask, id: String, key: String) {
    lock.lock(); defer { lock.unlock() }
    streams[task.taskIdentifier] = StreamState(id: id, key: key)
  }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    lock.lock()
    streams[dataTask.taskIdentifier]?.status = (response as? HTTPURLResponse)?.statusCode ?? 0
    lock.unlock()
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    var blocks: [(String, Data)] = []
    lock.lock()
    if var state = streams[dataTask.taskIdentifier] {
      state.buffer.append(data)
      // Events end with a blank line; tolerate CRLF framing.
      while let range = Self.eventBoundary(in: state.buffer) {
        blocks.append((state.id, state.buffer.subdata(in: state.buffer.startIndex..<range.lowerBound)))
        state.buffer.removeSubrange(state.buffer.startIndex..<range.upperBound)
      }
      streams[dataTask.taskIdentifier] = state
    }
    lock.unlock()
    for (id, block) in blocks {
      guard let text = String(data: block, encoding: .utf8) else { continue }
      var event = "message"
      var lines: [String] = []
      for line in text.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false) {
        if line.hasPrefix(":") { continue }
        if line.hasPrefix("event:") { event = line.dropFirst(6).trimmingCharacters(in: .whitespaces) }
        else if line.hasPrefix("data:") {
          var value = line.dropFirst(5)
          if value.hasPrefix(" ") { value = value.dropFirst() }
          lines.append(String(value))
        }
      }
      if !lines.isEmpty || event != "message" { onEvent(id, event, lines.joined(separator: "\n")) }
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    lock.lock()
    let state = streams.removeValue(forKey: task.taskIdentifier)
    lock.unlock()
    guard let state else { return }
    var message: String?
    if let mismatch = PinStore.shared.takeMismatch(state.key) {
      message = "PIN_MISMATCH: \(mismatch)"
    } else if let error = error as NSError?, error.code != NSURLErrorCancelled {
      message = "NETWORK: \(error.localizedDescription) (\(error.code))"
    }
    onEnd(state.id, state.status, message)
  }

  private static func eventBoundary(in data: Data) -> Range<Data.Index>? {
    let lf = data.range(of: Data([0x0A, 0x0A]))
    let crlf = data.range(of: Data([0x0D, 0x0A, 0x0D, 0x0A]))
    switch (lf, crlf) {
    case let (a?, b?): return a.lowerBound <= b.lowerBound ? a : b
    case let (a?, nil): return a
    case let (nil, b?): return b
    default: return nil
    }
  }
}

public class BatonTransportModule: Module {
  private let requestDelegate = PinningDelegate()
  private let streamDelegate = StreamDelegate()
  private lazy var requestSession: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = false
    configuration.httpCookieAcceptPolicy = .never
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.waitsForConnectivity = false
    return URLSession(configuration: configuration, delegate: requestDelegate, delegateQueue: nil)
  }()
  private lazy var streamSession: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpShouldSetCookies = false
    configuration.httpCookieAcceptPolicy = .never
    // The server sends a heartbeat every 15 seconds; longer silence means a dead link.
    configuration.timeoutIntervalForRequest = 60
    configuration.timeoutIntervalForResource = 60 * 60 * 24
    return URLSession(configuration: configuration, delegate: streamDelegate, delegateQueue: nil)
  }()
  private var streamTasks: [String: URLSessionDataTask] = [:]
  private let streamLock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("BatonTransport")
    Events("onStreamEvent", "onStreamEnd")

    OnCreate {
      self.streamDelegate.onEvent = { [weak self] id, event, data in
        self?.sendEvent("onStreamEvent", ["id": id, "event": event, "data": data])
      }
      self.streamDelegate.onEnd = { [weak self] id, status, error in
        guard let self else { return }
        self.streamLock.lock()
        self.streamTasks.removeValue(forKey: id)
        self.streamLock.unlock()
        self.sendEvent("onStreamEnd", ["id": id, "status": status, "error": error])
      }
    }

    AsyncFunction("request") { (options: TransportRequest) async throws -> [String: Any?] in
      try await self.perform(options)
    }

    Function("openStream") { (id: String, options: TransportRequest) throws in
      let request = try self.prepare(options)
      let task = self.streamSession.dataTask(with: request)
      self.streamDelegate.register(task, id: id, key: pinKey(host: request.url?.host ?? "", port: request.url?.port))
      self.streamLock.lock()
      self.streamTasks[id]?.cancel()
      self.streamTasks[id] = task
      self.streamLock.unlock()
      task.resume()
    }

    Function("closeStream") { (id: String) in
      self.streamLock.lock()
      let task = self.streamTasks.removeValue(forKey: id)
      self.streamLock.unlock()
      task?.cancel()
    }

    AsyncFunction("clearCache") { () throws in
      let directory = Self.cacheDirectory()
      if FileManager.default.fileExists(atPath: directory.path) {
        try FileManager.default.removeItem(at: directory)
      }
    }

    OnDestroy {
      self.requestSession.invalidateAndCancel()
      self.streamSession.invalidateAndCancel()
    }
  }

  /// Validate the URL, register its pin and build the URLRequest (without body).
  private func prepare(_ options: TransportRequest) throws -> URLRequest {
    guard let url = URL(string: options.url), url.scheme == "https", let host = url.host, !host.isEmpty else {
      throw TransportFailure("INVALID_URL: \(options.url.prefix(80))")
    }
    if let pin = options.pin {
      guard pin.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil else {
        throw TransportFailure("INVALID_PIN: certificate fingerprint must be 64 hex characters")
      }
      PinStore.shared.set(pinKey(host: host, port: url.port), pin)
    }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: options.timeout)
    request.httpMethod = options.method.uppercased()
    for (name, value) in options.headers { request.setValue(value, forHTTPHeaderField: name) }
    return request
  }

  private func perform(_ options: TransportRequest) async throws -> [String: Any?] {
    var request = try prepare(options)
    let key = pinKey(host: request.url?.host ?? "", port: request.url?.port)
    let cachedFile = options.cacheKey.map { Self.cacheFile(for: $0, fileName: options.fileName) }
    if options.responseType == "file", let cachedFile, FileManager.default.fileExists(atPath: cachedFile.path) {
      return ["status": 200, "headers": [String: String](), "body": nil, "fileUri": cachedFile.absoluteString, "cached": true]
    }
    let data: Data
    let response: URLResponse
    do {
      if let file = options.bodyFile {
        guard let fileURL = URL(string: file), fileURL.isFileURL else { throw TransportFailure("INVALID_BODY: bodyFile must be a file:// URI") }
        (data, response) = try await requestSession.upload(for: request, fromFile: fileURL)
      } else {
        if let base64 = options.bodyBase64 {
          guard let body = Data(base64Encoded: base64) else { throw TransportFailure("INVALID_BODY: bodyBase64 is not valid base64") }
          request.httpBody = body
        } else if let text = options.body {
          request.httpBody = Data(text.utf8)
        }
        (data, response) = try await requestSession.data(for: request)
      }
    } catch let failure as TransportFailure {
      throw failure
    } catch {
      if let actual = PinStore.shared.takeMismatch(key) { throw TransportFailure("PIN_MISMATCH: \(actual)") }
      let nsError = error as NSError
      throw TransportFailure("NETWORK: \(nsError.localizedDescription) (\(nsError.code))")
    }
    let http = response as? HTTPURLResponse
    var headers: [String: String] = [:]
    for (name, value) in http?.allHeaderFields ?? [:] {
      headers[String(describing: name).lowercased()] = String(describing: value)
    }
    let status = http?.statusCode ?? 0
    switch options.responseType {
    case "base64":
      return ["status": status, "headers": headers, "body": data.base64EncodedString(), "fileUri": nil]
    case "file":
      guard (200..<300).contains(status) else {
        return ["status": status, "headers": headers, "body": String(decoding: data, as: UTF8.self), "fileUri": nil]
      }
      let target = cachedFile ?? Self.downloadFile(named: options.fileName)
      try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
      try data.write(to: target, options: .atomic)
      return ["status": status, "headers": headers, "body": nil, "fileUri": target.absoluteString]
    default:
      return ["status": status, "headers": headers, "body": String(decoding: data, as: UTF8.self), "fileUri": nil]
    }
  }

  private static func cacheDirectory() -> URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("baton-transport", isDirectory: true)
  }

  private static func safeName(_ name: String?) -> String {
    let cleaned = (name ?? "download").replacingOccurrences(of: "[/\\\\:\\u0000-\\u001f]", with: "_", options: .regularExpression)
    return cleaned.isEmpty ? "download" : String(cleaned.prefix(120))
  }

  /// Cached immutable content keeps the original extension so previews pick the right viewer.
  private static func cacheFile(for key: String, fileName: String?) -> URL {
    let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    let ext = (safeName(fileName) as NSString).pathExtension
    return cacheDirectory().appendingPathComponent("cache", isDirectory: true)
      .appendingPathComponent(ext.isEmpty ? digest : digest + "." + ext)
  }

  /// Downloads keep their real name (for the share sheet) inside a unique directory.
  private static func downloadFile(named name: String?) -> URL {
    cacheDirectory().appendingPathComponent("downloads", isDirectory: true)
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
      .appendingPathComponent(safeName(name))
  }
}
