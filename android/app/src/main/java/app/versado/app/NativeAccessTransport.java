package app.versado.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.*;
import okio.BufferedSink;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native-only transport; geen globale CookieHandler, redirects, cache of automatische actie-replays. */
final class NativeAccessTransport {
    static final String ORIGIN = "https://dev.versado.app";
    static final int MAX_BODY = 16384, MAX_RESPONSE = 1048576;
    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
        .cookieJar(CookieJar.NO_COOKIES).cache(null)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).callTimeout(15, TimeUnit.SECONDS)
        .addNetworkInterceptor(chain -> { claimAttempt(chain.request()); return chain.proceed(chain.request()); }).build();
    static OkHttpClient client() { return CLIENT; }
    static void claimAttempt(Request request) throws IOException {
        AtomicBoolean attempted = request.tag(AtomicBoolean.class);
        if (attempted == null || !attempted.compareAndSet(false, true)) throw new IOException("access_retry_blocked");
    }
    static final class Failure extends Exception {
        final String code;
        Failure(String code) { super(code); this.code = code; }
    }
    static final class Credentials {
        final String id, secret;
        Credentials(String id, String secret) throws Failure {
            if (id == null || secret == null) throw new Failure("access_missing");
            if (!id.matches("[A-Za-z0-9._-]{10,256}") || !secret.matches("[A-Za-z0-9_+\\/=-]{16,512}")) throw new Failure("access_request_invalid");
            this.id = id; this.secret = secret;
        }
    }
    static final class Reply {
        final int status; final String body;
        Reply(int status, String body) { this.status = status; this.body = body; }
    }
    interface Calls { Call create(Request request); }
    interface Current { boolean valid(); }
    static boolean profileAllowed(boolean enabled, String profile, String channel, String origin, boolean probe, boolean releaseApproved) {
        return enabled && "local-internal".equals(profile) && "internal".equals(channel) && ORIGIN.equals(origin) && !probe && !releaseApproved;
    }
    static boolean routeAllowed(String path, String method) {
        if (path == null || method == null) return false;
        if ("GET".equals(method)) return path.matches("capabilities|me|today|today-overview|content-context|(chapters|study-media)/[A-Za-z0-9_-]{1,128}");
        if ("POST".equals(method)) return path.matches("today-actions/(hide|friend-response)|content-context|login|register|forgot-password|reset-password|verify-email|refresh|logout|security-setup/(complete|cancel)|apple/(challenge|complete)|account/password|chapters/[A-Za-z0-9_-]{1,128}/complete");
        return "DELETE".equals(method) && path.matches("apple|account");
    }
    static boolean containsCredential(Object object, Credentials credentials) throws Exception {
        if (object instanceof String) return ((String) object).contains(credentials.secret) || ((String) object).contains(credentials.id);
        if (object instanceof JSONObject) {
            JSONObject value = (JSONObject) object; Iterator<String> keys = value.keys();
            while (keys.hasNext()) { String key = keys.next(); if (containsCredential(key, credentials) || containsCredential(value.get(key), credentials)) return true; }
        } else if (object instanceof JSONArray) {
            JSONArray value = (JSONArray) object;
            for (int index = 0; index < value.length(); index++) if (containsCredential(value.get(index), credentials)) return true;
        }
        return false;
    }
    private static boolean boundedDepth(String text) {
        int depth = 0; boolean quoted = false, escaped = false;
        for (int index = 0; index < text.length(); index++) {
            char value = text.charAt(index);
            if (quoted) { if (escaped) escaped = false; else if (value == '\\') escaped = true; else if (value == '"') quoted = false; }
            else if (value == '"') quoted = true;
            else if (value == '{' || value == '[') { if (++depth > 64) return false; }
            else if (value == '}' || value == ']') depth--;
        }
        return true;
    }
    static Reply request(String path, String method, String authorization, String body, Credentials credentials, String nativeOrigin, Calls calls, Current current) throws Failure {
        if (!routeAllowed(path, method) || credentials == null || !("capacitor://localhost".equals(nativeOrigin) || "https://localhost".equals(nativeOrigin)) ||
            (authorization != null && !authorization.matches("Bearer [A-Za-z0-9._~-]{1,2040}")) ||
            (body != null && ("GET".equals(method) || body.getBytes(StandardCharsets.UTF_8).length > MAX_BODY))) throw new Failure("access_request_invalid");
        try {
            if (!current.valid()) throw new Failure("access_changed");
            Request.Builder builder = new Request.Builder().url(ORIGIN + "/api/v1/native/" + path)
                .tag(AtomicBoolean.class, new AtomicBoolean())
                .header("Origin", nativeOrigin).header("X-Versado-Client", "native-v1").header("Accept", "application/json")
                .header("CF-Access-Client-Id", credentials.id).header("CF-Access-Client-Secret", credentials.secret);
            if (authorization != null) builder.header("Authorization", authorization);
            RequestBody payload = null;
            if (!"GET".equals(method)) {
                final byte[] bytes = (body == null ? "" : body).getBytes(StandardCharsets.UTF_8);
                payload = new RequestBody() {
                    @Override public MediaType contentType() { return MediaType.get("application/json"); }
                    @Override public long contentLength() { return bytes.length; }
                    @Override public boolean isOneShot() { return true; }
                    @Override public void writeTo(BufferedSink sink) throws IOException { sink.write(bytes); }
                };
            }
            try (Response response = calls.create(builder.method(method, payload).build()).execute()) {
                int status = response.code();
                if (status < 200 || status > 599) throw new Failure("access_invalid_response");
                if (status >= 300 && status < 400) throw new Failure("access_redirect_blocked");
                String type = response.header("Content-Type");
                if (!nativeOrigin.equals(response.header("Access-Control-Allow-Origin")) || type == null || !"application/json".equalsIgnoreCase(type.split(";", 2)[0].trim())) {
                    throw new Failure(status == 401 || status == 403 ? "access_denied" : "access_invalid_response");
                }
                if (response.body() == null) throw new Failure("access_invalid_response");
                try (InputStream input = response.body().byteStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (bytes.size() + count > MAX_RESPONSE) throw new Failure("access_invalid_response");
                        bytes.write(buffer, 0, count);
                    }
                    String text = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
                    if (!boundedDepth(text)) throw new Failure("access_invalid_response");
                    final JSONObject json;
                    try { json = new JSONObject(text); } catch (Exception ignored) { throw new Failure("access_invalid_response"); }
                    if (containsCredential(json, credentials)) throw new Failure("access_invalid_response");
                    if (!current.valid()) throw new Failure("access_changed");
                    return new Reply(status, text); // Nooit responseheaders of servicecredentials teruggeven.
                }
            }
        } catch (Failure failure) { throw failure; }
        catch (Exception ignored) { throw new Failure("access_network_unavailable"); }
    }
}
