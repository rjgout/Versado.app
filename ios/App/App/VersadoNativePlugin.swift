import Foundation
import Capacitor
import Security
import AuthenticationServices

@objc(VersadoNativePlugin)
public class VersadoNativePlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "VersadoNativePlugin"
    public let jsName = "VersadoNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "readSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise)
    ]
    private var authorization: CAPPluginCall?
    private var controller: ASAuthorizationController?
    private let service = "app.versado.native.session.v1"
    // Een remote-preview mag nooit opgeslagen native sessies lezen.
    private func localOnly(_ call: CAPPluginCall) -> Bool {
        guard let url = bridge?.webView?.url, url.scheme == "capacitor", url.host == "localhost" else {
            call.reject("local_client_required"); return false
        }
        return true
    }
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "refresh"] }
    @objc func readSession(_ call: CAPPluginCall) {
        guard localOnly(call) else { return }
        var request = query; request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { call.resolve([:]); return }
        guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else { call.reject("secure_storage_unavailable"); return }
        call.resolve(["value": value])
    }
    @objc func writeSession(_ call: CAPPluginCall) {
        guard localOnly(call) else { return }
        guard let value = call.getString("value"), value.utf8.count <= 4096 else { call.reject("invalid_session"); return }
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query; attributes.forEach { item[$0.key] = $0.value }
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { call.reject("secure_storage_unavailable"); return }
        } else if status != errSecSuccess { call.reject("secure_storage_unavailable"); return }
        call.resolve()
    }
    @objc func clearSession(_ call: CAPPluginCall) {
        guard localOnly(call) else { return }
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { call.reject("secure_storage_unavailable"); return }
        call.resolve()
    }
    @objc func signInWithApple(_ call: CAPPluginCall) {
        guard localOnly(call) else { return }
        guard authorization == nil,
              let nonce = call.getString("nonce"), nonce.count == 64,
              let state = call.getString("state"), state.count >= 32, state.count <= 128 else { call.reject("apple_request_invalid"); return }
        DispatchQueue.main.async {
            guard self.authorization == nil, self.bridge?.viewController?.view.window != nil else { call.reject("apple_window_unavailable_or_busy"); return }
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.email, .fullName]; request.nonce = nonce; request.state = state
            self.authorization = call
            let controller = ASAuthorizationController(authorizationRequests: [request]); self.controller = controller
            controller.delegate = self; controller.presentationContextProvider = self; controller.performRequests()
        }
    }
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization result: ASAuthorization) {
        defer { authorization = nil; self.controller = nil }
        guard let credential = result.credential as? ASAuthorizationAppleIDCredential,
              let token = credential.identityToken, let jwt = String(data: token, encoding: .utf8), let state = credential.state else { authorization?.reject("apple_response_invalid"); return }
        var response: [String: Any] = ["identityToken": jwt, "state": state]
        if let name = credential.fullName { response["displayName"] = String(PersonNameComponentsFormatter().string(from: name).prefix(100)) }
        authorization?.resolve(response)
    }
    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        authorization?.reject("apple_authorization_cancelled_or_failed"); authorization = nil; self.controller = nil
    }
}
