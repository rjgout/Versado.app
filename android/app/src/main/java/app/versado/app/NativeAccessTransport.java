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
    static final String TEST_ORIGIN = "https://api-test.versado.app";
    static boolean directAllowed(String appId, String profile, String channel, String origin, boolean distribution, boolean probe, boolean approved) {
        return "app.versado.app".equals(appId) && "local-store-test".equals(profile) && "play-test".equals(channel) && TEST_ORIGIN.equals(origin) && distribution && !probe && !approved;
    }
    static boolean requestRouteAllowed(String path, String method, boolean direct) {
        return routeAllowed(path, method) || direct && "POST".equals(method) && "realtime/session".equals(path);
    }
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
        if (path.startsWith("games/")) return NativeGamesPolicy.allows(path, method);
        if ("GET".equals(method)) return path.matches("courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/learning/sessions/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|capabilities|me|today|today-overview|profile|content-context|courses|courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/audio(?:/playback)?|courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/annotations(?:/[A-Za-z0-9_-]{1,128})?|courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/resume|courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}|courses/[A-Za-z0-9_-]{1,128}/path|courses/[A-Za-z0-9_-]{1,128}/(?:weeks|archive)|courses/[A-Za-z0-9_-]{1,128}/weeks/[A-Za-z0-9_-]{1,128}/steps|(chapters|study-media)/[A-Za-z0-9_-]{1,128}");
        if ("POST".equals(method)) return path.matches("courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/learning/(?:start|submit|read|check)|courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/annotations|courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/position|profile(?:/two-factor)?|today-actions/(hide|friend-response)|content-context|login|register|forgot-password|reset-password|verify-email|refresh|logout|security-setup/(complete|cancel)|apple/(challenge|complete)|account/password|chapters/[A-Za-z0-9_-]{1,128}/complete");
        return "DELETE".equals(method) && path.matches("apple|account");
    }
    static boolean containsCredential(Object object, Credentials credentials) throws Exception {
        if (credentials == null) return false;
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
        if (!requestRouteAllowed(path, method, credentials == null) || !("capacitor://localhost".equals(nativeOrigin) || "https://localhost".equals(nativeOrigin)) ||
            (authorization != null && !authorization.matches("Bearer [A-Za-z0-9._~-]{1,2040}")) ||
            (body != null && ("GET".equals(method) || body.getBytes(StandardCharsets.UTF_8).length > MAX_BODY))) throw new Failure("access_request_invalid");
        try {
            if (!current.valid()) throw new Failure("access_changed");
            Request.Builder builder = new Request.Builder().url((credentials == null ? TEST_ORIGIN : ORIGIN) + "/api/v1/native/" + path)
                .tag(AtomicBoolean.class, new AtomicBoolean())
                .header("Origin", nativeOrigin).header("X-Versado-Client", "native-v1").header("Accept", "application/json");
            if (credentials != null) builder.header("CF-Access-Client-Id", credentials.id).header("CF-Access-Client-Secret", credentials.secret);
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
                    throw new Failure(status == 401 || status == 403 ? "access_denied" : status >= 500 ? "access_network_unavailable" : "access_invalid_response");
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

// BEGIN NATIVE GAMES POLICY
// Gegenereerd uit de expliciete games-v1-grenzen; wijzigen via games-policy.mjs.
final class NativeGamesPolicy {
    private static final class Rule {
        final java.util.regex.Pattern pattern;
        final java.util.List<String> methods, query;
        final boolean word;
        Rule(String pattern, String methods, String query, boolean word) {
            this.pattern = java.util.regex.Pattern.compile("\\A" + pattern + "\\z");
            this.methods = java.util.Arrays.asList(methods.split(","));
            this.query = query.isEmpty() ? java.util.Collections.emptyList() : java.util.Arrays.asList(query.split(",")); this.word = word;
        }
        boolean matches(String input, String method, java.util.Set<String> keys) {
            if (!methods.contains(method) || !query.containsAll(keys)) return false;
            String value = input;
            if (word) {
                String[] parts = input.split("/", -1);
                if (parts.length != 2 || !parts[0].equals("dictionary")) return false;
                try { value = "dictionary/" + java.net.URLDecoder.decode(parts[1], "UTF-8"); } catch (Exception error) { return false; }
            }
            return pattern.matcher(value).matches();
        }
    }
    private static final Rule[] API = {
        new Rule("kompas/state", "GET,POST", "", false),
        new Rule("open-actions", "GET", "tab,offset,limit", false),
        new Rule("nudges", "POST", "", false),
        new Rule("group-invites/[A-Za-z0-9_-]{1,128}", "POST", "", false),
        new Rule("friends/[A-Za-z0-9_-]{1,128}/accept", "POST", "", false),
        new Rule("friends/[A-Za-z0-9_-]{1,128}/decline", "POST", "", false),
        new Rule("reading-sessions", "POST", "", false),
        new Rule("chapters/[A-Za-z0-9_-]{1,128}/read", "POST", "", false),
        new Rule("chapters/[A-Za-z0-9_-]{1,128}/submit", "POST", "", false),
        new Rule("exercises/[A-Za-z0-9_-]{1,128}/check", "POST", "", false),
        new Rule("study/[A-Za-z0-9_-]{1,128}/units", "GET", "", false),
        new Rule("activity-status", "GET", "", false),
        new Rule("alleskenner/seasons/[A-Za-z0-9_-]{1,128}/evenings", "POST", "", false),
        new Rule("alleskenner/seasons/[A-Za-z0-9_-]{1,128}/finale", "POST", "", false),
        new Rule("alleskenner/seasons/[A-Za-z0-9_-]{1,128}/members", "POST,DELETE", "", false),
        new Rule("alleskenner/seasons/[A-Za-z0-9_-]{1,128}", "GET,PATCH", "absent", false),
        new Rule("alleskenner/seasons", "GET,POST", "", false),
        new Rule("alleskenner/solo", "GET,POST", "", false),
        new Rule("challenges/[A-Za-z0-9_-]{1,128}/accept", "POST", "", false),
        new Rule("challenges/[A-Za-z0-9_-]{1,128}/cancel", "POST", "", false),
        new Rule("challenges/[A-Za-z0-9_-]{1,128}/decline", "POST", "", false),
        new Rule("challenges/[A-Za-z0-9_-]{1,128}/forfeit", "POST", "", false),
        new Rule("challenges", "GET,POST", "", false),
        new Rule("chapter-guess/[A-Za-z0-9_-]{1,128}/answer", "POST", "", false),
        new Rule("chapter-guess/[A-Za-z0-9_-]{1,128}/forfeit", "POST", "", false),
        new Rule("chapter-guess/[A-Za-z0-9_-]{1,128}/hint", "POST", "", false),
        new Rule("chapter-guess/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("chapter-guess/start", "POST", "", false),
        new Rule("chapters", "GET", "", false),
        new Rule("dictionary/[\\p{L}\\p{M}'’\\-]{1,64}", "GET", "", true),
        new Rule("exercises/[A-Za-z0-9_-]{1,128}/hint", "GET,POST", "", false),
        new Rule("feedback/exercise", "POST", "", false),
        new Rule("friends/recent", "GET", "", false),
        new Rule("friends", "GET", "", false),
        new Rule("hints", "GET", "", false),
        new Rule("jigsaw-v2", "POST", "", false),
        new Rule("jigsaw", "POST", "", false),
        new Rule("list-order", "GET,PUT", "listKey", false),
        new Rule("live/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("live/create-alleskenner", "POST", "", false),
        new Rule("live/create-chapter-guess", "POST", "", false),
        new Rule("live/create-family-game", "POST", "", false),
        new Rule("live/create", "POST", "", false),
        new Rule("mysteries/attempts", "GET,POST", "variant", false),
        new Rule("puzzle/coop", "POST", "", false),
        new Rule("puzzle/history", "GET", "limit,cursor", false),
        new Rule("puzzle/leaderboard", "GET", "variantId,imageId,pieceCount,difficulty,mode,hintCategory", false),
        new Rule("puzzle/match", "POST", "", false),
        new Rule("puzzle/overview", "GET", "", false),
        new Rule("puzzle/records", "GET", "mode,hintCategory,pieceCount,difficulty", false),
        new Rule("scrabble/[A-Za-z0-9_-]{1,128}/accept", "POST", "", false),
        new Rule("scrabble/[A-Za-z0-9_-]{1,128}/cancel", "POST", "", false),
        new Rule("scrabble/[A-Za-z0-9_-]{1,128}/decline", "POST", "", false),
        new Rule("scrabble/[A-Za-z0-9_-]{1,128}/exchange", "POST", "", false),
        new Rule("scrabble/[A-Za-z0-9_-]{1,128}/forfeit", "POST", "", false),
        new Rule("scrabble/[A-Za-z0-9_-]{1,128}/hint", "POST", "", false),
        new Rule("scrabble/[A-Za-z0-9_-]{1,128}/move", "POST", "", false),
        new Rule("scrabble/[A-Za-z0-9_-]{1,128}/pass", "POST", "", false),
        new Rule("scrabble/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("scrabble", "GET,POST", "", false),
        new Rule("shop/genees", "POST", "", false),
        new Rule("shop/hints", "POST", "", false),
        new Rule("shop", "GET", "", false),
        new Rule("snelle-zendeling/leaderboard", "GET", "type,board", false),
        new Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}/death", "POST", "", false),
        new Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}/finish", "POST", "", false),
        new Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}/genees", "POST", "", false),
        new Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}/resume", "POST", "", false),
        new Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}/revive/answer", "POST", "", false),
        new Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}/revive", "POST", "", false),
        new Rule("snelle-zendeling/runs/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("snelle-zendeling/runs", "POST", "", false),
        new Rule("snelle-zendeling/together", "POST", "", false),
        new Rule("streak/celebration", "POST,GET", "", false),
        new Rule("streak/continuation", "GET,POST", "", false),
        new Rule("users/avatars", "GET", "ids", false),
        new Rule("users/search", "GET", "q", false),
        new Rule("word-game/guess", "POST", "", false),
        new Rule("word-game/hint", "POST", "", false),
        new Rule("word-game/ranking", "GET", "", false),
        new Rule("word-game", "GET", "", false),
        new Rule("word-search/[A-Za-z0-9_-]{1,128}/find", "POST", "", false),
        new Rule("word-search/[A-Za-z0-9_-]{1,128}/give-up", "POST", "", false),
        new Rule("word-search/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("word-search", "GET,POST", "", false)
    };
    private static final Rule[] PAGES = {
        new Rule("/kompas/play", "GET", "", false),
        new Rule("/kompas/play\\.jigsaw", "GET", "", false),
        new Rule("/kompas/play\\.word-search", "GET", "", false),
        new Rule("/kompas/play\\.word-game", "GET", "", false),
        new Rule("/kompas/play\\.scrabble", "GET", "", false),
        new Rule("/kompas/play\\.alleskenner", "GET", "", false),
        new Rule("/kompas/play\\.gezinsavond", "GET", "", false),
        new Rule("/kompas/play\\.chapter-guess", "GET", "", false),
        new Rule("/kompas/play\\.challenges", "GET", "", false),
        new Rule("/kompas/play\\.quick-missionary", "GET", "", false),
        new Rule("/kompas/play\\.mystery", "GET", "", false),
        new Rule("/acties", "GET", "tab", false),
        new Rule("/lesson/[A-Za-z0-9_-]{1,128}", "GET", "challengeId,cursus,vers,returnTo", false),
        new Rule("/alleskenner/alleen/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("/alleskenner/alleen", "GET", "", false),
        new Rule("/alleskenner", "GET", "", false),
        new Rule("/alleskenner/seizoen/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("/alleskenner/seizoen", "GET", "", false),
        new Rule("/challenges", "GET", "", false),
        new Rule("/chapter-guess", "GET", "", false),
        new Rule("/chapter-guess/solo/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("/gezinsavond", "GET", "", false),
        new Rule("/jigsaw/afgerond", "GET", "", false),
        new Rule("/jigsaw", "GET", "", false),
        new Rule("/jigsaw/records/[A-Za-z0-9_-]{1,128}", "GET", "mode,cat", false),
        new Rule("/jigsaw/records", "GET", "", false),
        new Rule("/jigsaw/samen/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("/jigsaw/wedstrijd/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("/live/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("/live", "GET", "availability,kompas", false),
        new Rule("/mysteries/001", "GET", "", false),
        new Rule("/mysteries/001a", "GET", "", false),
        new Rule("/mysteries/001a/play", "GET", "resume", false),
        new Rule("/mysteries/001b", "GET", "", false),
        new Rule("/mysteries/001b/play", "GET", "resume", false),
        new Rule("/mysteries/001c", "GET", "", false),
        new Rule("/mysteries/001c/play", "GET", "resume", false),
        new Rule("/mysteries/002", "GET", "", false),
        new Rule("/mysteries/002a", "GET", "", false),
        new Rule("/mysteries/002a/play", "GET", "resume", false),
        new Rule("/mysteries/002b", "GET", "", false),
        new Rule("/mysteries/002b/play", "GET", "resume", false),
        new Rule("/mysteries/002c", "GET", "", false),
        new Rule("/mysteries/002c/play", "GET", "resume", false),
        new Rule("/mysteries/003", "GET", "", false),
        new Rule("/mysteries/003a", "GET", "", false),
        new Rule("/mysteries/003a/play", "GET", "resume", false),
        new Rule("/mysteries/003b", "GET", "", false),
        new Rule("/mysteries/003b/play", "GET", "resume", false),
        new Rule("/mysteries/003c", "GET", "", false),
        new Rule("/mysteries/003c/play", "GET", "resume", false),
        new Rule("/mysteries/004", "GET", "", false),
        new Rule("/mysteries/004a", "GET", "", false),
        new Rule("/mysteries/004a/play", "GET", "resume", false),
        new Rule("/mysteries/004b", "GET", "", false),
        new Rule("/mysteries/004b/play", "GET", "resume", false),
        new Rule("/mysteries/004c", "GET", "", false),
        new Rule("/mysteries/004c/play", "GET", "resume", false),
        new Rule("/mysteries/005", "GET", "", false),
        new Rule("/mysteries/005a", "GET", "", false),
        new Rule("/mysteries/005a/play", "GET", "resume", false),
        new Rule("/mysteries/005b", "GET", "", false),
        new Rule("/mysteries/005b/play", "GET", "resume", false),
        new Rule("/mysteries/005c", "GET", "", false),
        new Rule("/mysteries/005c/play", "GET", "resume", false),
        new Rule("/mysteries/006", "GET", "", false),
        new Rule("/mysteries/006a", "GET", "", false),
        new Rule("/mysteries/006a/play", "GET", "resume", false),
        new Rule("/mysteries/006b", "GET", "", false),
        new Rule("/mysteries/006b/play", "GET", "resume", false),
        new Rule("/mysteries/006c", "GET", "", false),
        new Rule("/mysteries/006c/play", "GET", "resume", false),
        new Rule("/mysteries", "GET", "", false),
        new Rule("/scrabble/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("/scrabble", "GET", "", false),
        new Rule("/snelle-zendeling", "GET", "view", false),
        new Rule("/snelle-zendeling/run/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("/snelle-zendeling/samen/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("/word-game", "GET", "", false),
        new Rule("/word-search/[A-Za-z0-9_-]{1,128}", "GET", "", false),
        new Rule("/word-search", "GET", "", false)
    };
    private static boolean clean(String input, int max) {
        if (input == null || input.length() > max) return false;
        for (int i = 0; i < input.length(); i++) { int ch = input.charAt(i); if (ch < 33 || ch > 126 || ch == 92 || ch == 35) return false; }
        return !java.util.regex.Pattern.compile("%(?![0-9A-Fa-f]{2})").matcher(input).find();
    }
    private static java.util.Map<String,String> query(String input) throws Exception {
        java.net.URI uri = new java.net.URI("https://policy.invalid/" + input);
        if (!"policy.invalid".equals(uri.getHost()) || uri.getFragment() != null) throw new Exception();
        java.util.Map<String,String> result = new java.util.HashMap<>();
        if (uri.getRawQuery() != null && !uri.getRawQuery().isEmpty()) for (String pair : uri.getRawQuery().split("&", -1)) {
            if (pair.isEmpty()) continue;
            String[] parts = pair.split("=", 2);
            String key = java.net.URLDecoder.decode(parts[0], "UTF-8"), value = parts.length > 1 ? java.net.URLDecoder.decode(parts[1], "UTF-8") : "";
            if (result.containsKey(key)) throw new Exception(); result.put(key, value);
        }
        return result;
    }
    static boolean audioAllowed(String path, boolean stream) {
        return clean(path, 512) && java.util.regex.Pattern.compile(stream ? "\\Agames/(?:reading/[A-Za-z0-9_-]{1,128}|intro-(?:solo|live)/[A-Za-z0-9_-]{1,128}/(?:0|[1-9][0-9]?|[1-4][0-9]{2}))/audio/[a-f0-9]{64}/stream\\z" : "\\Agames/(?:reading/[A-Za-z0-9_-]{1,128}|(?:intro|ak)-(?:solo|live)/[A-Za-z0-9_-]{1,128}/(?:0|[1-9][0-9]?|[1-4][0-9]{2}))/audio/playback\\z").matcher(path).matches();
    }
    static boolean allows(String path, String method) {
        if (!clean(path, 8192) || method == null || !path.startsWith("games/")) return false;
        try {
            if (method.equals("GET") && audioAllowed(path, false)) return true;
            java.util.Map<String,String> query = query(path);
            String raw = path.substring(6).split("\\?", 2)[0];
            if (raw.equals("page")) return method.equals("GET") && query.size() == 1 && query.containsKey("route") && page(query.get("route"));
            if (query.isEmpty() && (method.equals("GET") && raw.matches("reading/[A-Za-z0-9_-]{1,128}/annotations(?:/[A-Za-z0-9_-]{1,128})?") || method.equals("POST") && raw.matches("reading/[A-Za-z0-9_-]{1,128}/annotations"))) return true;
            if (raw.equals("list-order") && !(method.equals("GET") && query.size() == 1 && "games".equals(query.get("listKey")) || method.equals("PUT") && query.isEmpty())) return false;
            for (Rule rule : API) if (rule.matches(raw, method, query.keySet())) return true;
        } catch (Exception error) { return false; }
        return false;
    }
    private static boolean page(String href) {
        if (!clean(href, 4096) || !href.startsWith("/") || href.startsWith("//") || href.split("\\?", 2)[0].contains("%")) return false;
        try {
            String path = href.split("\\?", 2)[0];
            for (String part : path.split("/", -1)) if (part.equals(".") || part.equals("..")) return false;
            java.util.Map<String,String> query = query(href.substring(1));
            for (java.util.Map.Entry<String,String> item : query.entrySet()) {
                String key = item.getKey(), value = item.getValue();
                if (key.equals("kompas") && value.equals("play")) continue;
                if (key.equals("tab") && java.util.Arrays.asList("required","continue","waiting").contains(value)) continue;
                if ((key.equals("challengeId") || key.equals("cursus")) && value.matches("[A-Za-z0-9_-]{1,128}")) continue;
                if (key.equals("vers") && value.matches("(?:[1-9]|[1-9][0-9]|[1-4][0-9]{2}|500)")) continue;
                if (key.equals("returnTo") && value.startsWith("/mysteries/") && page(value)) continue;
                if (!(key.equals("view") && value.equals("leaderboard") || key.equals("availability") && value.equals("unavailable") || key.equals("resume") && value.equals("completed") || key.equals("mode") && (value.equals("SOLO") || value.equals("MATCH")) || key.equals("cat") && (value.equals("NO_HINTS") || value.equals("WITH_HINTS")))) return false;
            }
            for (Rule rule : PAGES) if (rule.matches(path, "GET", query.keySet())) return true;
        } catch (Exception error) { return false; }
        return false;
    }
}
// END NATIVE GAMES POLICY
