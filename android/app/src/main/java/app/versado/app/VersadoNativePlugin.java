package app.versado.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "VersadoNative")
public class VersadoNativePlugin extends Plugin {
    private static final String ALIAS = "versado-native-session-v1";
    private boolean localOnly(PluginCall call) {
        try {
            URI url = new URI(getBridge().getWebView().getUrl());
            if ("https".equals(url.getScheme()) && "localhost".equals(url.getHost()) && url.getPort() == -1) return true;
        } catch (Exception ignored) { }
        call.reject("local_client_required"); return false;
    }
    private SharedPreferences preferences() { return getContext().getSharedPreferences(ALIAS, Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    @PluginMethod public synchronized void readSession(PluginCall call) {
        if (!localOnly(call)) return;
        try {
            String encrypted = preferences().getString("ciphertext", null);
            if (encrypted == null) { call.resolve(new JSObject()); return; }
            byte[] iv = Base64.decode(preferences().getString("iv", ""), Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            JSObject result = new JSObject(); result.put("value", new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8)); call.resolve(result);
        } catch (Exception ignored) { call.reject("secure_storage_unavailable"); }
    }
    @PluginMethod public synchronized void writeSession(PluginCall call) {
        if (!localOnly(call)) return;
        String value = call.getString("value");
        if (value == null || value.getBytes(StandardCharsets.UTF_8).length > 4096) { call.reject("invalid_session"); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
            String encrypted = Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!preferences().edit().putString("ciphertext", encrypted).putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit()) throw new Exception();
            call.resolve();
        } catch (Exception ignored) { call.reject("secure_storage_unavailable"); }
    }
    @PluginMethod public synchronized void clearSession(PluginCall call) {
        if (!localOnly(call)) return;
        if (preferences().edit().clear().commit()) call.resolve(); else call.reject("secure_storage_unavailable");
    }
    @PluginMethod public synchronized void signInWithApple(PluginCall call) { call.reject("apple_web_oauth_not_configured"); }
}
