import SwiftUI
import WebKit
import CryptoKit
import VisionKit

struct Workspace: Codable, Identifiable, Equatable {
    var id = UUID()
    let origin: URL
    let pin: String?
    static func read(_ input: String) throws -> (Workspace, String?) {
        guard var parts = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)) else { throw ConnectionError.invalid }
        let pairing = parts.scheme == "baton" && parts.host == "pair"
        var pin: String?, code: String?
        if pairing {
            let fields = URLComponents(string: "?" + (parts.fragment ?? ""))?.queryItems ?? []
            guard let address = fields.first(where: {$0.name == "origin"})?.value,
                  let parsed = URLComponents(string: address),
                  let fingerprint = fields.first(where: {$0.name == "pin"})?.value,
                  fingerprint.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  let invitation = fields.first(where: {$0.name == "code"})?.value,
                  invitation.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw ConnectionError.invalid }
            parts = parsed; pin = fingerprint; code = invitation
        }
        guard parts.scheme == "https", parts.host?.isEmpty == false, parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil, ["","/"].contains(parts.path), let url = parts.url else { throw ConnectionError.invalid }
        return (Workspace(origin:url,pin:pin),code)
    }
}
enum ConnectionError: Error { case invalid }

@main struct BatonMobile: App {
    var body: some Scene { WindowGroup { Home() } }
}
struct Home: View {
    @AppStorage("workspaces") private var saved = Data()
    @State private var selected: Workspace?
    @State private var connectionID = UUID()
    @State private var code: String?
    @State private var address = ""
    @State private var failure = ""
    @State private var scanning = false
    var spaces: [Workspace] { (try? JSONDecoder().decode([Workspace].self,from:saved)) ?? [] }
    func open(_ input: String) {
        do {
            let (next, invitation) = try Workspace.read(input)
            let found = spaces.first { $0.origin == next.origin && $0.pin == next.pin } ?? next
            if !spaces.contains(found) { saved = try JSONEncoder().encode(spaces + [found]) }
            address=""; failure=""; connectionID=UUID(); code=invitation; selected=found
        } catch { failure="请输入有效的 HTTPS 地址或 Baton 配对链接。" }
    }
    var body: some View {
        NavigationStack {
            if let workspace=selected {
                Browser(workspace:workspace,code:code).id(connectionID)
                    .toolbar { ToolbarItem(placement:.topBarLeading) { Button("工作空间") { selected=nil; code=nil } } }
                    .navigationBarTitleDisplayMode(.inline)
            } else {
                List {
                    if !spaces.isEmpty {
                        Section("最近使用") {
                            ForEach(spaces) { w in Button(w.origin.absoluteString) { selected=w; code=nil } }
                            .onDelete { offsets in var rows=spaces; let removed=offsets.map { rows[$0].id }; rows.remove(atOffsets:offsets); saved=(try? JSONEncoder().encode(rows)) ?? Data()
                                for id in removed { WKWebsiteDataStore.remove(forIdentifier:id) { _ in } }
                            }
                        }
                    }
                    Section("连接工作空间") {
                        TextField("HTTPS 地址或配对链接",text:$address).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        Button("连接") { open(address) }.disabled(address.isEmpty)
                        if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                            Button("扫描本地配对码",systemImage:"qrcode.viewfinder") { scanning=true }
                        }
                        if !failure.isEmpty { Text(failure).foregroundStyle(.red) }
                    }
                }.navigationTitle("Baton")
            }
        }.onOpenURL { open($0.absoluteString) }.sheet(isPresented:$scanning) { Scanner { value in scanning=false;open(value) } }
    }
}
struct Scanner: UIViewControllerRepresentable {
    var accept:(String)->Void
    class Delegate:NSObject,DataScannerViewControllerDelegate {
        let accept:(String)->Void
        var done=false
        init(_ accept:@escaping(String)->Void){self.accept=accept}
        func dataScanner(_ controller:DataScannerViewController,didAdd items:[RecognizedItem],allItems:[RecognizedItem]) {
            for item in items { if case .barcode(let barcode)=item,let s=barcode.payloadStringValue,s.hasPrefix("baton://pair#"),!done {
                done=true;controller.stopScanning();accept(s);return
            }}
        }
    }
    func makeCoordinator()->Delegate{Delegate(accept)}
    func makeUIViewController(context:Context)->DataScannerViewController {
        let c=DataScannerViewController(recognizedDataTypes:[.barcode(symbologies:[.qr])]);c.delegate=context.coordinator
        try? c.startScanning();return c
    }
    func updateUIViewController(_ uiViewController:DataScannerViewController,context:Context){}
}
struct Browser: UIViewRepresentable {
    let workspace:Workspace
    let code:String?
    class Delegate:NSObject,WKNavigationDelegate {
        let workspace:Workspace
        init(_ w:Workspace){workspace=w}
        func allowed(_ url:URL?) -> Bool {url?.scheme=="https" && url?.host==workspace.origin.host && (url?.port ?? 443)==(workspace.origin.port ?? 443)}
        func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
            decisionHandler(allowed(action.request.url) ? .allow : .cancel)
        }
        func webView(_ webView:WKWebView,didReceive challenge:URLAuthenticationChallenge,completionHandler:@escaping(URLSession.AuthChallengeDisposition,URLCredential?)->Void) {
            guard let expected=workspace.pin else {completionHandler(.performDefaultHandling,nil);return}
            let space=challenge.protectionSpace
            guard space.authenticationMethod==NSURLAuthenticationMethodServerTrust,space.host==workspace.origin.host,space.port==(workspace.origin.port ?? 443),let trust=space.serverTrust,
                  let chain=SecTrustCopyCertificateChain(trust) as? [SecCertificate],let leaf=chain.first else {completionHandler(.cancelAuthenticationChallenge,nil);return}
            let fingerprint=SHA256.hash(data:SecCertificateCopyData(leaf) as Data).map{String(format:"%02x",$0)}.joined()
            if fingerprint==expected {completionHandler(.useCredential,URLCredential(trust:trust))} else {completionHandler(.cancelAuthenticationChallenge,nil)}
        }
        private var failureView: UIView?
        var retryURL: URL?
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            failureView?.removeFromSuperview()
            failureView = nil
            retryURL = workspace.origin
        }
        func webView(_ view: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let failure = error as NSError
            guard failure.code != NSURLErrorCancelled else { return }
            failureView?.removeFromSuperview()
            let message = UILabel()
            message.text = failure.localizedDescription + "（" + String(failure.code) + "）"
            message.numberOfLines = 0
            message.textAlignment = .center
            let retry = UIButton(type: .system)
            retry.setTitle("重新连接", for: .normal)
            retry.addAction(UIAction { [weak self, weak view] _ in
                guard let self, let view, let url = self.retryURL else { return }
                self.failureView?.removeFromSuperview()
                self.failureView = nil
                view.load(URLRequest(url: url))
            }, for: .touchUpInside)
            let panel = UIStackView(arrangedSubviews: [message, retry])
            panel.axis = .vertical
            panel.spacing = 16
            panel.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(panel)
            NSLayoutConstraint.activate([
                panel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                panel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
                panel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)
            ])
            failureView = panel
        }
    }
    func makeCoordinator()->Delegate{Delegate(workspace)}
    func makeUIView(context:Context)->WKWebView{
        let config=WKWebViewConfiguration();config.websiteDataStore=WKWebsiteDataStore(forIdentifier:workspace.id)
        let view=WKWebView(frame:.zero,configuration:config);view.navigationDelegate=context.coordinator
        var parts=URLComponents(url:workspace.origin,resolvingAgainstBaseURL:false)!
        if let code {parts.fragment="pair="+code}
        context.coordinator.retryURL = parts.url
        view.load(URLRequest(url:parts.url!));return view
    }
    func updateUIView(_ view:WKWebView,context:Context){}
}
