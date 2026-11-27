import CryptoKit
import Foundation
import Network
import Security

enum RelayTLSFailure: LocalizedError {
  case invalid, key, unavailable
  var errorDescription: String? {
    switch self {
    case .invalid: return "无效的配对地址"
    case .key: return "无法读取设备密钥，请重新配对"
    case .unavailable: return "Relay 连接需要 iOS 17 或更高版本"
    }
  }
}

// A self-signed client certificate wraps the non-exported P-256 Keychain key.
// Security.framework signs the X.509 TBSCertificate and verifies possession in TLS.
enum RelayDeviceKey {
  private static func tag(_ number: UInt8, _ content: Data) -> Data {
    let n = content.count
    let length: [UInt8] = n < 128 ? [UInt8(n)] : n < 256 ? [0x81,UInt8(n)] : [0x82,UInt8(n >> 8),UInt8(n & 255)]
    return Data([number] + length) + content
  }
  private static func sequence(_ fields: Data...) -> Data { tag(0x30,fields.reduce(Data(),+)) }
  static func identity(_ handle: String, create: Bool) throws -> SecIdentity {
    guard handle.range(of:"^[a-f0-9]{32}$",options:.regularExpression) != nil else { throw RelayTLSFailure.invalid }
    let label = "baton.relay." + handle
    let query: [String:Any] = [kSecClass as String:kSecClassIdentity,kSecAttrLabel as String:label,kSecReturnRef as String:true]
    var item: CFTypeRef?
    if SecItemCopyMatching(query as CFDictionary,&item) == errSecSuccess { return item as! SecIdentity }
    guard create else { throw RelayTLSFailure.key }
    let attrs: [String:Any] = [kSecAttrKeyType as String:kSecAttrKeyTypeECSECPrimeRandom,kSecAttrKeySizeInBits as String:256,
      kSecPrivateKeyAttrs as String:[kSecAttrIsPermanent as String:true,kSecAttrLabel as String:label,kSecAttrApplicationTag as String:Data(label.utf8),
        kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly] as [String:Any]]
    var failure: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attrs as CFDictionary,&failure) else {
      if let failure { throw failure.takeRetainedValue() as Error }
      throw RelayTLSFailure.key
    }
    guard let pub = SecKeyCopyPublicKey(key),
          let raw = SecKeyCopyExternalRepresentation(pub,nil) as Data? else { throw RelayTLSFailure.key }
    do {
      let sigAlg = sequence(tag(6,Data([0x2a,0x86,0x48,0xce,0x3d,4,3,2])))
      let name = sequence(tag(0x31,sequence(tag(6,Data([0x55,4,3])),tag(0x0c,Data(label.utf8)))))
      let validity = sequence(tag(0x18,Data("20200101000000Z".utf8)),tag(0x18,Data("20991231235959Z".utf8)))
      let spki = spkiPrefix + raw
      let tbs = sequence(tag(0xa0,tag(2,Data([2]))),tag(2,Data([1])),sigAlg,name,validity,name,spki)
      guard let signature = SecKeyCreateSignature(key,.ecdsaSignatureMessageX962SHA256,tbs as CFData,nil) as Data?,
            let cert = SecCertificateCreateWithData(nil,sequence(tbs,sigAlg,tag(3,Data([0])+signature)) as CFData) else { throw RelayTLSFailure.key }
      let add: [String:Any] = [kSecClass as String:kSecClassCertificate,kSecValueRef as String:cert,kSecAttrLabel as String:label]
      let stored = SecItemAdd(add as CFDictionary,nil)
      guard stored == errSecSuccess else {throw NSError(domain:NSOSStatusErrorDomain,code:Int(stored))}
      let found = SecItemCopyMatching(query as CFDictionary,&item)
      guard found == errSecSuccess else {throw NSError(domain:NSOSStatusErrorDomain,code:Int(found))}
      return item as! SecIdentity
    } catch { remove(handle); throw error }
  }
  fileprivate static let spkiPrefix = Data([0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,
    0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00])
  static func remove(_ handle: String) {
    let label = "baton.relay." + handle
    SecItemDelete([kSecClass:kSecClassCertificate,kSecAttrLabel:label] as CFDictionary)
    SecItemDelete([kSecClass:kSecClassKey,kSecAttrApplicationTag:Data(label.utf8)] as CFDictionary)
  }
}

struct RelayTLS {
  let origin: URL
  let routeHost: String
  let pin: String
  let identity: SecIdentity
  init(origin: String, url: URL, pin: String, key: String, create: Bool) throws {
    guard let relay = URL(string:origin), relay.scheme == "https", relay.host != nil, relay.user == nil, relay.password == nil,
          let host = url.host, host.range(of:"^[a-f0-9]{32}\\.baton\\.invalid$",options:.regularExpression) != nil,
          url.scheme == "https", url.port == nil, pin.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else { throw RelayTLSFailure.invalid }
    self.origin = relay; self.routeHost = host; self.pin = pin
    self.identity = try RelayDeviceKey.identity(key,create:create)
  }
  func configuration() throws -> URLSessionConfiguration {
    guard #available(iOS 17.0, macOS 14.0, *) else { throw RelayTLSFailure.unavailable }
    let config = URLSessionConfiguration.ephemeral
    let outer = NWProtocolTLS.Options()
    sec_protocol_options_set_min_tls_protocol_version(outer.securityProtocolOptions,.TLSv13)
    let proxy = ProxyConfiguration(httpCONNECTProxy:.hostPort(host:.init(origin.host!),port:NWEndpoint.Port(rawValue:UInt16(origin.port ?? 443))!),tlsOptions:outer)
    config.proxyConfigurations = [proxy]
    config.tlsMinimumSupportedProtocolVersion = .TLSv13
    config.httpShouldSetCookies = false
    config.urlCredentialStorage = nil
    return config
  }

  func authenticate(_ challenge: URLAuthenticationChallenge, _ finish: (URLSession.AuthChallengeDisposition,URLCredential?) -> Void) {
    let space = challenge.protectionSpace
    guard space.host.lowercased() == routeHost && !space.isProxy() else { finish(.performDefaultHandling,nil); return }
    if space.authenticationMethod == NSURLAuthenticationMethodClientCertificate {
      finish(.useCredential,URLCredential(identity:identity,certificates:nil,persistence:.none)); return
    }
    guard space.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = space.serverTrust,
      let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let leaf = chain.first,
      let key = SecCertificateCopyKey(leaf), let raw = SecKeyCopyExternalRepresentation(key,nil) as Data?, raw.count == 65,
      SHA256.hash(data:RelayDeviceKey.spkiPrefix + raw).map({String(format:"%02x",$0)}).joined() == pin
    else { finish(.cancelAuthenticationChallenge,nil); return }
    finish(.useCredential,URLCredential(trust:trust))
  }
}
