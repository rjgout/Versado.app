package app.versado.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.FutureTask;
import android.os.Looper;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "VersadoNative")
public class VersadoNativePlugin extends Plugin {
    private static final String ALIAS = "versado-native-session-v1";
    private static final String ACCESS_ALIAS = "versado-native-cloudflare-v1";
    private final Object accessLock = new Object();
    private long accessEpoch = 0;
    private boolean accessDialogBusy = false;
    private final ThreadPoolExecutor accessWorkers = new ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(8));
    private SharedPreferences accessPreferences() { return getContext().getSharedPreferences(ACCESS_ALIAS, Context.MODE_PRIVATE); }
    private JSONObject accessAsset(String name) throws Exception {
        try (InputStream input = getContext().getAssets().open("public/" + name); ByteArrayOutputStream data = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024]; int count;
            while ((count = input.read(buffer)) != -1) { if (data.size() + count > 65536) throw new Exception(); data.write(buffer, 0, count); }
            return new JSONObject(new String(data.toByteArray(), StandardCharsets.UTF_8));
        }
    }
    private boolean accessEnabled() {
        try {
            JSONObject metadata = accessAsset("build.json");
            return accessAsset("internal-access.json").getBoolean("enabled") && NativeAccessTransport.profileAllowed(
                getConfig().getBoolean("internalAccessEnabled", false), metadata.getString("profile"), metadata.getString("channel"), metadata.getString("apiOrigin"), metadata.getBoolean("compileProbe"), metadata.getBoolean("releaseApproved"));
        } catch (Exception ignored) { return false; }
    }
    @Override public void load() {
        if (!accessEnabled()) { accessPreferences().edit().clear().commit(); }
    }
    @Override protected void handleOnDestroy() { accessWorkers.shutdownNow(); synchronized (accessLock) { accessEpoch++; } }
    private boolean accessOnly(PluginCall call) {
        if (!localOnly(call)) return false;
        if (!accessEnabled()) { call.reject("access_disabled"); return false; }
        return true;
    }
    private SecretKey accessKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ACCESS_ALIAS)) return (SecretKey) store.getKey(ACCESS_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ACCESS_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    private NativeAccessTransport.Credentials readAccess() throws Exception {
        String stored = accessPreferences().getString("ciphertext", null);
        if (stored == null) throw new NativeAccessTransport.Failure("access_missing");
        if (stored.length() > 4096) throw new NativeAccessTransport.Failure("access_storage_unavailable");
        String nonce = accessPreferences().getString("iv", "");
        if (nonce.length() > 32) throw new NativeAccessTransport.Failure("access_storage_unavailable");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, accessKey(), new GCMParameterSpec(128, Base64.decode(nonce, Base64.NO_WRAP)));
        JSONObject pair = new JSONObject(new String(cipher.doFinal(Base64.decode(stored, Base64.NO_WRAP)), StandardCharsets.UTF_8));
        return new NativeAccessTransport.Credentials(pair.getString("id"), pair.getString("secret"));
    }
    @PluginMethod public void accessStatus(PluginCall call) {
        if (!localOnly(call)) return;
        boolean enabled = accessEnabled();
        synchronized (accessLock) {
            JSObject result = new JSObject(); result.put("enabled", enabled); result.put("configured", enabled && accessPreferences().contains("ciphertext")); call.resolve(result);
        }
    }
    private String[] accessLabels(String language) {
        if ("nl".equals(language)) return new String[]{"Interne toegang – dev.versado.app", "Client-ID", "Client Secret", "Opslaan", "Annuleren"};
        if ("de".equals(language)) return new String[]{"Interner Zugang – dev.versado.app", "Client-ID", "Client Secret", "Speichern", "Abbrechen"};
        if ("fr".equals(language)) return new String[]{"Accès interne – dev.versado.app", "ID client", "Secret client", "Enregistrer", "Annuler"};
        if ("es".equals(language)) return new String[]{"Acceso interno – dev.versado.app", "ID de cliente", "Secreto de cliente", "Guardar", "Cancelar"};
        return new String[]{"Internal access – dev.versado.app", "Client ID", "Client Secret", "Save", "Cancel"};
    }
    @PluginMethod public void enrollAccess(PluginCall call) {
        if (!accessOnly(call)) return;
        synchronized (accessLock) { if (accessDialogBusy) { call.reject("access_busy"); return; } accessDialogBusy = true; }
        String[] labels = accessLabels(call.getString("language", "en"));
        getActivity().runOnUiThread(() -> {
            if (getActivity().isFinishing()) { synchronized (accessLock) { accessDialogBusy = false; } call.reject("access_busy"); return; }
            LinearLayout fields = new LinearLayout(getContext()); fields.setOrientation(LinearLayout.VERTICAL);
            int inset = (int) (24 * getContext().getResources().getDisplayMetrics().density); fields.setPadding(inset, 0, inset, 0);
            EditText id = new EditText(getContext()), secret = new EditText(getContext());
            EditText[] inputs = new EditText[]{id, secret};
            for (int index = 0; index < inputs.length; index++) {
                EditText input = inputs[index]; input.setHint(labels[index + 1]); input.setSingleLine(true);
                input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
                input.setSaveEnabled(false);
                if (android.os.Build.VERSION.SDK_INT >= 26) input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
                fields.addView(input);
            }
            AlertDialog dialog = new AlertDialog.Builder(getActivity()).setTitle(labels[0]).setView(fields)
                .setNegativeButton(labels[4], (value, which) -> { JSObject result = new JSObject(); result.put("changed", false); call.resolve(result); })
                .setPositiveButton(labels[3], (value, which) -> {
                    if (!accessOnly(call)) return;
                    try {
                        NativeAccessTransport.Credentials pair = new NativeAccessTransport.Credentials(id.getText().toString(), secret.getText().toString());
                        JSONObject data = new JSONObject(); data.put("id", pair.id); data.put("secret", pair.secret);
                        synchronized (accessLock) {
                            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, accessKey());
                            String encrypted = Base64.encodeToString(cipher.doFinal(data.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
                            if (!accessPreferences().edit().putString("ciphertext", encrypted).putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit()) throw new Exception();
                            accessEpoch++;
                        }
                        JSObject result = new JSObject(); result.put("changed", true); call.resolve(result);
                    } catch (NativeAccessTransport.Failure error) { call.reject(error.code); }
                    catch (Exception ignored) { call.reject("access_storage_unavailable"); }
                }).create();
            dialog.setCanceledOnTouchOutside(false);
            dialog.setOnCancelListener(value -> { JSObject result = new JSObject(); result.put("changed", false); call.resolve(result); });
            dialog.setOnDismissListener(value -> { id.setText(""); secret.setText(""); synchronized (accessLock) { accessDialogBusy = false; } });
            if (dialog.getWindow() != null) dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            dialog.show();
        });
    }
    @PluginMethod public void clearAccess(PluginCall call) {
        if (!accessOnly(call)) return;
        synchronized (accessLock) {
            if (accessDialogBusy) { call.reject("access_busy"); return; }
            if (!accessPreferences().edit().clear().commit()) { call.reject("access_storage_unavailable"); return; }
            accessEpoch++; JSObject result = new JSObject(); result.put("changed", true); call.resolve(result);
        }
    }
    @PluginMethod public void accessRequest(PluginCall call) {
        if (!accessOnly(call)) return;
        String path = call.getString("path"), method = call.getString("method"), authorization = call.getString("authorization"), body = call.getString("body");
        if (!NativeAccessTransport.routeAllowed(path, method)) { call.reject("access_request_invalid"); return; }
        final long requestedEpoch;
        synchronized (accessLock) { requestedEpoch = accessEpoch; }
        try {
            accessWorkers.execute(() -> {
                final NativeAccessTransport.Credentials pair; final long epoch;
                try { synchronized (accessLock) {
                    if (requestedEpoch != accessEpoch) { call.reject("access_changed"); return; }
                    pair = readAccess(); epoch = accessEpoch;
                } }
                catch (NativeAccessTransport.Failure error) { call.reject(error.code); return; }
                catch (Exception ignored) { call.reject("access_storage_unavailable"); return; }
                try {
                    NativeAccessTransport.Reply reply = NativeAccessTransport.request(path, method, authorization, body, pair, "https://localhost", NativeAccessTransport.client()::newCall, () -> {
                        synchronized (accessLock) { return epoch == accessEpoch; }
                    });
                    getActivity().runOnUiThread(() -> {
                        if (!accessOnly(call)) return;
                        synchronized (accessLock) {
                            if (epoch != accessEpoch) { call.reject("access_changed"); return; }
                            JSObject result = new JSObject(); result.put("status", reply.status); result.put("body", reply.body); call.resolve(result);
                        }
                    });
                } catch (NativeAccessTransport.Failure error) { call.reject(error.code); }
            });
        } catch (java.util.concurrent.RejectedExecutionException ignored) { call.reject("access_busy"); }
    }
    private boolean localOnly(PluginCall call) {
        try {
            // Capacitor voert pluginmethoden op zijn bridge-thread uit; WebView.getUrl hoort op de UI-thread.
            URI url;
            if (Looper.myLooper() == Looper.getMainLooper()) url = new URI(getBridge().getWebView().getUrl());
            else {
                FutureTask<URI> read = new FutureTask<>(() -> new URI(getBridge().getWebView().getUrl()));
                getActivity().runOnUiThread(read); url = read.get(2, TimeUnit.SECONDS);
            }
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
