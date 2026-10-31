import Foundation
import UIKit
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
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "accessStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enrollAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "accessRequest", returnType: CAPPluginReturnPromise)
    ]
    private var authorization: CAPPluginCall?
    private var controller: ASAuthorizationController?
    private let service = "app.versado.native.session.v1"
    private let accessService = "app.versado.native.cloudflare.v1"
    private let accessLock = NSLock()
    private var accessEpoch = 0, accessDialogBusy = false
    private var accessRequests: [UUID: NativeAccessRequest] = [:]
    private var accessQuery: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: accessService, kSecAttrAccount as String: "service-auth"] }
    private func accessEnabled() -> Bool {
        guard getConfig().getBoolean("internalAccessEnabled", false),
              let url = Bundle.main.url(forResource: "build", withExtension: "json", subdirectory: "public"),
              let data = try? Data(contentsOf: url), let metadata = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let flagURL = Bundle.main.url(forResource: "internal-access", withExtension: "json", subdirectory: "public"),
              (try? String(contentsOf: flagURL, encoding: .utf8)) == "{\"enabled\":true}\n" else { return false }
        return NativeAccessPolicy.profileAllowed(enabled: true, metadata: metadata)
    }
    public override func load() {
        // Een andere build mag eerder opgeslagen interne credentials niet gebruiken.
        if !accessEnabled() { SecItemDelete(accessQuery as CFDictionary) }
    }
    private func accessOnly(_ call: CAPPluginCall) -> Bool {
        guard localOnly(call) else { return false }
        guard accessEnabled() else { call.reject("access_disabled"); return false }
        return true
    }
    private func readAccess() throws -> NativeAccessCredentials {
        var request = accessQuery; request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { throw NativeAccessFailure("access_missing") }
        guard status == errSecSuccess, let data = result as? Data, data.count <= 2048,
              let pair = (try? JSONSerialization.jsonObject(with: data)) as? [String: String], let id = pair["id"], let secret = pair["secret"] else { throw NativeAccessFailure("access_storage_unavailable") }
        return try NativeAccessCredentials(id: id, secret: secret)
    }
    @objc func accessStatus(_ call: CAPPluginCall) {
        guard localOnly(call) else { return }
        guard accessEnabled() else { call.resolve(["enabled": false, "configured": false]); return }
        accessLock.lock(); defer { accessLock.unlock() }
        let status = SecItemCopyMatching(accessQuery as CFDictionary, nil)
        guard status == errSecSuccess || status == errSecItemNotFound else { call.reject("access_storage_unavailable"); return }
        call.resolve(["enabled": true, "configured": status == errSecSuccess])
    }
    private func accessLabels(_ language: String) -> [String] {
        let labels: [String: [String]] = [
            "nl": ["Interne toegang – dev.versado.app", "Client-ID", "Client Secret", "Opslaan", "Annuleren", "Controleer beide gegevens; spaties zijn niet toegestaan."],
            "en": ["Internal access – dev.versado.app", "Client ID", "Client Secret", "Save", "Cancel", "Check both values; spaces are not allowed."],
            "de": ["Interner Zugang – dev.versado.app", "Client-ID", "Client Secret", "Speichern", "Abbrechen", "Beide Angaben prüfen; Leerzeichen sind nicht erlaubt."],
            "fr": ["Accès interne – dev.versado.app", "ID client", "Secret client", "Enregistrer", "Annuler", "Vérifiez les deux valeurs ; les espaces sont interdits."],
            "es": ["Acceso interno – dev.versado.app", "ID de cliente", "Secreto de cliente", "Guardar", "Cancelar", "Comprueba ambos valores; no se permiten espacios."]
        ]; return labels[language] ?? labels["en"]!
    }
    @objc func enrollAccess(_ call: CAPPluginCall) {
        guard accessOnly(call) else { return }
        accessLock.lock()
        guard !accessDialogBusy else { accessLock.unlock(); call.reject("access_busy"); return }
        accessDialogBusy = true; accessLock.unlock()
        let labels = accessLabels(call.getString("language") ?? "en")
        DispatchQueue.main.async {
            guard let view = self.bridge?.viewController, view.view.window != nil, view.presentedViewController == nil, !UIScreen.main.isCaptured else {
                self.accessLock.lock(); self.accessDialogBusy = false; self.accessLock.unlock(); call.reject("access_busy"); return
            }
            let dialog = UIAlertController(title: labels[0], message: nil, preferredStyle: .alert)
            for label in [labels[1], labels[2]] {
                dialog.addTextField { field in
                    field.placeholder = label; field.isSecureTextEntry = true; field.textContentType = nil
                    field.keyboardType = .asciiCapable; field.autocorrectionType = .no; field.autocapitalizationType = .none; field.spellCheckingType = .no
                }
            }
            dialog.addAction(UIAlertAction(title: labels[4], style: .cancel) { _ in
                dialog.textFields?.forEach { $0.text = nil }; self.accessLock.lock(); self.accessDialogBusy = false; self.accessLock.unlock(); call.resolve(["changed": false])
            })
            dialog.addAction(UIAlertAction(title: labels[3], style: .default) { _ in
                defer { dialog.textFields?.forEach { $0.text = nil }; self.accessLock.lock(); self.accessDialogBusy = false; self.accessLock.unlock() }
                guard self.accessOnly(call) else { return }
                do {
                    let pair = try NativeAccessCredentials(id: dialog.textFields?[0].text ?? "", secret: dialog.textFields?[1].text ?? "")
                    let data = try JSONSerialization.data(withJSONObject: ["id": pair.id, "secret": pair.secret])
                    let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
                    self.accessLock.lock()
                    var status = SecItemUpdate(self.accessQuery as CFDictionary, attributes as CFDictionary)
                    if status == errSecItemNotFound {
                        var item = self.accessQuery; attributes.forEach { item[$0.key] = $0.value }; status = SecItemAdd(item as CFDictionary, nil)
                    }
                    if status == errSecSuccess { self.accessEpoch += 1 }; self.accessLock.unlock()
                    guard status == errSecSuccess else { call.reject("access_storage_unavailable"); return }
                    call.resolve(["changed": true]) // Geen getter, identifier of secret naar JavaScript.
                } catch { call.reject("access_request_invalid") }
            })
            view.present(dialog, animated: true)
        }
    }
    @objc func clearAccess(_ call: CAPPluginCall) {
        guard accessOnly(call) else { return }
        accessLock.lock(); defer { accessLock.unlock() }
        guard !accessDialogBusy else { call.reject("access_busy"); return }
        let status = SecItemDelete(accessQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { call.reject("access_storage_unavailable"); return }
        accessEpoch += 1; call.resolve(["changed": true])
    }
    @objc func accessRequest(_ call: CAPPluginCall) {
        guard accessOnly(call) else { return }
        guard let path = call.getString("path"), let method = call.getString("method"), NativeAccessPolicy.routeAllowed(path, method) else { call.reject("access_request_invalid"); return }
        accessLock.lock()
        guard accessRequests.count < 4 else { accessLock.unlock(); call.reject("access_busy"); return }
        let credentials: NativeAccessCredentials
        do { credentials = try readAccess() } catch { accessLock.unlock(); call.reject((error as? NativeAccessFailure)?.code ?? "access_storage_unavailable"); return }
        let epoch = accessEpoch, id = UUID()
        let request = NativeAccessRequest(credentials: credentials, isCurrent: { [weak self] in
            guard let self = self else { return false }; self.accessLock.lock(); defer { self.accessLock.unlock() }; return epoch == self.accessEpoch
        }) { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self else { call.reject("access_changed"); return }
                self.accessLock.lock(); self.accessRequests.removeValue(forKey: id); let current = epoch == self.accessEpoch; self.accessLock.unlock()
                guard current else { call.reject("access_changed"); return }
                guard self.accessOnly(call) else { return }
                switch result {
                case .success(let value): call.resolve(["status": value.0, "body": value.1])
                case .failure(let error): call.reject(error.code)
                }
            }
        }
        accessRequests[id] = request; accessLock.unlock()
        request.start(path: path, method: method, authorization: call.getString("authorization"), body: call.getString("body"))
    }
    // Een remote-preview mag nooit opgeslagen native sessies lezen.
    private func localOnly(_ call: CAPPluginCall) -> Bool {
        // WKWebView wordt uitsluitend op de main queue gelezen, ook bij de Capacitor bridge-queue.
        let currentURL: URL?
        if Thread.isMainThread { currentURL = bridge?.webView?.url }
        else { currentURL = DispatchQueue.main.sync { self.bridge?.webView?.url } }
        guard let url = currentURL, url.scheme == "capacitor", url.host == "localhost", url.port == nil else {
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
