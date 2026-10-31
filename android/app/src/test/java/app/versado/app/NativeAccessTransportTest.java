package app.versado.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.*;

public class NativeAccessTransportTest {
    private final NativeAccessTransport.Credentials credentials;
    public NativeAccessTransportTest() throws Exception { credentials = new NativeAccessTransport.Credentials("synthetic-device.access", "synthetic-secret-for-native-tests"); }
    private static final class Edge implements Interceptor {
        int status = 200; String type = "application/json", origin = "https://localhost", response = "{\"ok\":true}";
        boolean offline = false; Request captured; int calls = 0;
        final OkHttpClient client = NativeAccessTransport.client().newBuilder().addInterceptor(this).build();
        @Override public Response intercept(Chain chain) throws IOException {
            captured = chain.request(); calls++;
            if (offline) throw new IOException("synthetic transport failure");
            Response.Builder reply = new Response.Builder().request(captured).protocol(Protocol.HTTP_1_1).code(status).message("Synthetic")
                .body(ResponseBody.create(MediaType.get("application/json"), response));
            if (type != null) reply.header("Content-Type", type);
            if (origin != null) reply.header("Access-Control-Allow-Origin", origin);
            return reply.build();
        }
    }
    private NativeAccessTransport.Reply request(Edge edge) throws Exception {
        return NativeAccessTransport.request("login", "POST", "Bearer synthetic.native", "{}", credentials, "https://localhost", edge.client::newCall, () -> true);
    }
    @Test public void profileAndRoutesStayStrict() {
        assertTrue(NativeAccessTransport.profileAllowed(true, "local-internal", "internal", NativeAccessTransport.ORIGIN, false, false));
        assertFalse(NativeAccessTransport.profileAllowed(false, "local-internal", "internal", NativeAccessTransport.ORIGIN, false, false));
        for (String profile : new String[]{"local-development", "local-store-test", "release", "remote-preview"}) assertFalse(NativeAccessTransport.profileAllowed(true, profile, "internal", NativeAccessTransport.ORIGIN, false, false));
        assertFalse(NativeAccessTransport.profileAllowed(true, "local-internal", "internal", "https://versado.app", false, false));
        assertFalse(NativeAccessTransport.profileAllowed(true, "local-internal", "internal", NativeAccessTransport.ORIGIN, true, false));
        assertFalse(NativeAccessTransport.profileAllowed(true, "local-internal", "internal", NativeAccessTransport.ORIGIN, false, true));
        for (String path : new String[]{"../admin", "me?url=https://evil.invalid", "https://evil.invalid", "me#x", "chapters/%2e%2e", "realtime/session", "capabilities\n"}) assertFalse(NativeAccessTransport.routeAllowed(path, "GET"));
        assertTrue(NativeAccessTransport.routeAllowed("chapters/synthetic-1/complete", "POST"));
        assertFalse(NativeAccessTransport.routeAllowed("me", "DELETE"));
    }
    @Test public void contentContextIsExactAndBounded() {
        assertTrue(NativeAccessTransport.routeAllowed("today-overview", "GET"));
        for (String method : new String[]{"POST", "PUT", "DELETE", "HEAD"}) assertFalse(NativeAccessTransport.routeAllowed("today-overview", method));
        for (String path : new String[]{"today-overview/", "today-overview?user=A", "today-overview/complete"}) assertFalse(NativeAccessTransport.routeAllowed(path, "GET"));
        for (String method : new String[]{"GET", "POST"}) assertTrue(NativeAccessTransport.routeAllowed("content-context", method));
        for (String method : new String[]{"PUT", "PATCH", "DELETE", "HEAD"}) assertFalse(NativeAccessTransport.routeAllowed("content-context", method));
        for (String path : new String[]{"content-context/", "content-context/preview", "content-context?preview=1", "../content-context", "content-context%2f"}) {
            for (String method : new String[]{"GET", "POST"}) assertFalse(NativeAccessTransport.routeAllowed(path, method));
        }
    }
    @Test public void headersAreAddedNativeAndNeverReturned() throws Exception {
        Edge edge = new Edge(); NativeAccessTransport.Reply reply = request(edge);
        assertEquals("https://dev.versado.app/api/v1/native/login", edge.captured.url().toString());
        assertEquals(credentials.id, edge.captured.header("CF-Access-Client-Id"));
        assertEquals(credentials.secret, edge.captured.header("CF-Access-Client-Secret"));
        assertEquals("Bearer synthetic.native", edge.captured.header("Authorization"));
        assertEquals("https://localhost", edge.captured.header("Origin")); assertNull(edge.captured.header("Cookie"));
        OkHttpClient client = NativeAccessTransport.client();
        assertSame(CookieJar.NO_COOKIES, client.cookieJar()); assertNull(client.cache());
        assertFalse(client.followRedirects()); assertFalse(client.followSslRedirects()); assertFalse(client.retryOnConnectionFailure());
        assertSame(Authenticator.NONE, client.authenticator()); assertSame(Authenticator.NONE, client.proxyAuthenticator());
        assertEquals(15000, client.callTimeoutMillis());
        assertEquals(200, reply.status); assertEquals("{\"ok\":true}", reply.body); assertEquals(1, edge.calls);
        assertFalse(reply.body.contains(credentials.secret));
    }
    @Test public void bodiesAndNetworkAttemptCannotBeReplayed() throws Exception {
        Edge edge = new Edge(); request(edge);
        assertTrue(edge.captured.body().isOneShot());
        NativeAccessTransport.claimAttempt(edge.captured);
        assertThrows(IOException.class, () -> NativeAccessTransport.claimAttempt(edge.captured));
    }
    @Test public void missingAndMalformedCredentialsFailClosed() {
        assertEquals("access_missing", assertThrows(NativeAccessTransport.Failure.class, () -> new NativeAccessTransport.Credentials(null, null)).code);
        assertThrows(NativeAccessTransport.Failure.class, () -> new NativeAccessTransport.Credentials("bad\r\nheader", "synthetic-secret-for-native-tests"));
        assertThrows(NativeAccessTransport.Failure.class, () -> new NativeAccessTransport.Credentials("synthetic-device.access", "bad\r\nheader"));
    }
    @Test public void accessDenialAndBackend401StayDistinct() throws Exception {
        for (int status : new int[]{401, 403}) {
            Edge edge = new Edge(); edge.status = status; edge.type = "text/html"; edge.origin = null;
            assertEquals("access_denied", assertThrows(NativeAccessTransport.Failure.class, () -> request(edge)).code);
        }
        Edge backend = new Edge(); backend.status = 401; backend.response = "{\"error\":\"session_expired\"}";
        assertEquals(401, request(backend).status);
    }
    @Test public void redirectsAndSecretEchoAreRejected() throws Exception {
        Edge redirect = new Edge(); redirect.status = 302;
        assertEquals("access_redirect_blocked", assertThrows(NativeAccessTransport.Failure.class, () -> request(redirect)).code);
        assertEquals(1, redirect.calls);
        for (String body : new String[]{"{\"nested\":[\"synthetic-secret-for-native-tests\"]}", "{\"nested\":\"\\u0073ynthetic-secret-for-native-tests\"}", "{\"synthetic-device.access\":true}"}) {
            Edge edge = new Edge(); edge.response = body;
            assertEquals("access_invalid_response", assertThrows(NativeAccessTransport.Failure.class, () -> request(edge)).code);
        }
    }
    @Test public void responseAndRequestBoundsAndNetworkFailureAreEnforced() throws Exception {
        Edge huge = new Edge(); huge.response = new String(new char[NativeAccessTransport.MAX_RESPONSE + 1]).replace('\0', 'x');
        assertEquals("access_invalid_response", assertThrows(NativeAccessTransport.Failure.class, () -> request(huge)).code);
        Edge malformed = new Edge(); malformed.response = "not json";
        assertEquals("access_invalid_response", assertThrows(NativeAccessTransport.Failure.class, () -> request(malformed)).code);
        Edge offline = new Edge(); offline.offline = true;
        assertEquals("access_network_unavailable", assertThrows(NativeAccessTransport.Failure.class, () -> request(offline)).code);
        assertThrows(NativeAccessTransport.Failure.class, () -> NativeAccessTransport.request("me", "GET", null, "{}", credentials, "https://localhost", value -> { fail("network must not start"); return null; }, () -> true));
    }
    @Test public void credentialChangeBeforeOrDuringRequestRejectsTheOldAction() throws Exception {
        assertEquals("access_changed", assertThrows(NativeAccessTransport.Failure.class, () -> NativeAccessTransport.request("me", "GET", null, null, credentials, "https://localhost", value -> { fail("network must not start"); return null; }, () -> false)).code);
        AtomicBoolean current = new AtomicBoolean(true); Edge edge = new Edge();
        assertEquals("access_changed", assertThrows(NativeAccessTransport.Failure.class, () -> NativeAccessTransport.request("me", "GET", null, null, credentials, "https://localhost", value -> { current.set(false); return edge.client.newCall(value); }, current::get)).code);
    }
}
