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
    @Test public void directTestModeHasNoServiceCredentialsAndKeepsStrictRoutes() throws Exception {
        assertTrue(NativeAccessTransport.directAllowed("app.versado.app","local-store-test","play-test",NativeAccessTransport.TEST_ORIGIN,true,false,false));
        assertFalse(NativeAccessTransport.directAllowed("app.versado.app","local-store-test","play-test","https://versado.app",true,false,false));
        assertFalse(NativeAccessTransport.directAllowed("app.versado.app","local-store-test","play-test",NativeAccessTransport.TEST_ORIGIN,true,true,false));
        assertFalse(NativeAccessTransport.routeAllowed("realtime/session","POST"));
        Edge edge = new Edge();
        NativeAccessTransport.request("realtime/session","POST","Bearer synthetic.native","{}",null,"https://localhost",edge.client::newCall,()->true);
        assertEquals("api-test.versado.app",edge.captured.url().host());
        assertNull(edge.captured.header("CF-Access-Client-Secret")); assertNull(edge.captured.header("CF-Access-Client-Id"));
        assertNull(edge.captured.header("Cookie")); assertNull(edge.captured.url().query());
        assertEquals("Bearer synthetic.native",edge.captured.header("Authorization"));
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
    @Test public void readerIsExactlyReadOnly() {
        for(String path : new String[]{"courses/c/read/steps/s", "courses/c/read/chapters/ch"}) {
            assertTrue(NativeAccessTransport.routeAllowed(path,"GET"));
            for(String method : new String[]{"POST","PUT","PATCH","DELETE","HEAD"}) assertFalse(NativeAccessTransport.routeAllowed(path,method));
            for(String suffix : new String[]{"/","?x=1","/complete","%2f","/../me"}) assertFalse(NativeAccessTransport.routeAllowed(path+suffix,"GET"));
        }
    }
    @Test public void playbackMetadataIsExactlyReadOnlyAndNeverAStreamProxy() {
        for(String kind:new String[]{"steps","chapters"}) {
            String path="courses/c/read/"+kind+"/t/audio/playback";
            assertTrue(NativeAccessTransport.routeAllowed(path,"GET"));
            for(String method:new String[]{"POST","PUT","PATCH","DELETE","HEAD"})assertFalse(NativeAccessTransport.routeAllowed(path,method));
            for(String suffix:new String[]{"/","?url=other","/stream","/../me","\n"})assertFalse(NativeAccessTransport.routeAllowed(path+suffix,"GET"));
            assertFalse(NativeAccessTransport.routeAllowed("courses/c/read/"+kind+"/t/audio/"+String.join("",java.util.Collections.nCopies(64,"a"))+"/stream","GET"));
        }
    }
    @Test public void readerPositionIsExactAndSeparate() {
        for(String path : new String[]{"courses/c/read/steps/s", "courses/c/read/chapters/ch"}) {
            assertTrue(NativeAccessTransport.routeAllowed(path+"/resume","GET"));
            assertTrue(NativeAccessTransport.routeAllowed(path+"/position","POST"));
            assertFalse(NativeAccessTransport.routeAllowed(path+"/resume","POST"));
            assertFalse(NativeAccessTransport.routeAllowed(path+"/position","GET"));
            for(String suffix : new String[]{"/","?x=1","\n","/complete"}) {
                assertFalse(NativeAccessTransport.routeAllowed(path+"/resume"+suffix,"GET"));
                assertFalse(NativeAccessTransport.routeAllowed(path+"/position"+suffix,"POST"));
            }
        }
    }
    @Test public void learningIsExplicitAndExactlyScoped() {
        for(String kind:new String[]{"steps","chapters"}) {
            String prefix="courses/c/read/"+kind+"/t/learning/";
            String status=prefix+"sessions/00112233-4455-4677-8899-aabbccddeeff";
            assertTrue(NativeAccessTransport.routeAllowed(status,"GET"));
            assertFalse(NativeAccessTransport.routeAllowed(status,"POST"));
            for(String action:new String[]{"start","submit","read","check"}) {
                assertTrue(NativeAccessTransport.routeAllowed(prefix+action,"POST"));
                assertFalse(NativeAccessTransport.routeAllowed(prefix+action,"GET"));
                for(String suffix:new String[]{"/x","?a=1","#x","\n","%2f"}) assertFalse(NativeAccessTransport.routeAllowed(prefix+action+suffix,"POST"));
            }
        }
    }

    @Test public void annotationsAreExactlyScopedToExistingReaderTargets() {
        for(String path:new String[]{"courses/c/read/steps/s/annotations","courses/c/read/chapters/ch/annotations"}) {
            assertTrue(NativeAccessTransport.routeAllowed(path,"GET"));
            assertTrue(NativeAccessTransport.routeAllowed(path+"/v","GET"));
            assertTrue(NativeAccessTransport.routeAllowed(path,"POST"));
            assertFalse(NativeAccessTransport.routeAllowed(path+"/v","POST"));
            for(String method:new String[]{"PUT","PATCH","DELETE","HEAD"})assertFalse(NativeAccessTransport.routeAllowed(path,method));
            for(String suffix:new String[]{"/","?user=B","/v/extra","/../v","/%2f","\n"})assertFalse(NativeAccessTransport.routeAllowed(path+suffix,"GET"));
        }
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
    @Test public void html5xxDiscardsBodyButValidBackendErrorsStayIntact() throws Exception {
        for (int status : new int[]{500,502,503}) {
            Edge edge=new Edge(); edge.status=status; edge.type="text/html"; edge.origin=null; edge.response=credentials.secret;
            assertEquals("access_network_unavailable",assertThrows(NativeAccessTransport.Failure.class,()->request(edge)).code);
            assertEquals(1,edge.calls);
        }
        Edge backend=new Edge(); backend.status=503; backend.response="{\"error\":\"synthetic_backend_unavailable\"}";
        NativeAccessTransport.Reply reply=request(backend);
        assertEquals(503,reply.status); assertEquals(backend.response,reply.body);
        Edge echo=new Edge(); echo.status=503; echo.response="{\"error\":\""+credentials.secret+"\"}";
        assertEquals("access_invalid_response",assertThrows(NativeAccessTransport.Failure.class,()->request(echo)).code);
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
    // BEGIN GAME REQUEST CASES
    @Test public void explicitGamesPolicyMatchesTheSharedBoundary() {
        assertEquals(false, NativeAccessTransport.routeAllowed("games/list-order", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/list-order?listKey=courses", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/list-order?listKey=today-continue", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/list-order?listKey=games", "PUT"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/reading/chapter/annotations", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/reading/chapter/annotations/verse", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/reading/chapter/annotations", "POST"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/annotations?view=reader&chapterId=chapter", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/reading/chapter/annotations?user=B", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/reading/chapter/annotations/verse/extra", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/reading/chapter/annotations/verse", "POST"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/reading/chapter/annotations", "PUT"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/ak-solo/run/1/audio/playback", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/ak-live/ABCDE/12/audio/playback", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/reading/chapter/audio/playback", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/intro-solo/run/0/audio/playback", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/intro-live/ABCDE/14/audio/playback", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/ak-solo/run/1/audio/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/stream", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/reading/chapter/audio/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/stream", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/intro-solo/run/01/audio/playback", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/intro-live/ABCDE/500/audio/playback", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/reading/chapter/audio/playback?token=x", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/reading/chapter/audio/../../playback", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/reading/chapter/audio/playback", "POST"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/reading/chapter/audio/playback", "HEAD"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/kompas/state", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/kompas/state", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/open-actions", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/nudges", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/group-invites/synthetic", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/friends/synthetic/accept", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/friends/synthetic/decline", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/reading-sessions", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/chapters/synthetic/read", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/chapters/synthetic/submit", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/exercises/synthetic/check", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/study/synthetic/units", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/activity-status", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/alleskenner/seasons/synthetic/evenings", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/alleskenner/seasons/synthetic/finale", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/alleskenner/seasons/synthetic/members", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/alleskenner/seasons/synthetic/members", "DELETE"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/alleskenner/seasons/synthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/alleskenner/seasons/synthetic", "PATCH"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/alleskenner/seasons", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/alleskenner/seasons", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/alleskenner/solo", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/alleskenner/solo", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/challenges/synthetic/accept", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/challenges/synthetic/cancel", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/challenges/synthetic/decline", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/challenges/synthetic/forfeit", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/challenges", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/challenges", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/chapter-guess/synthetic/answer", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/chapter-guess/synthetic/forfeit", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/chapter-guess/synthetic/hint", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/chapter-guess/synthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/chapter-guess/start", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/chapters", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/dictionary/synthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/exercises/synthetic/hint", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/exercises/synthetic/hint", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/feedback/exercise", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/friends/recent", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/friends/request", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/friends/profiles/synthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/friends/synthetic", "DELETE"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/friend-streaks/synthetic", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/friend-streaks", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/friend-streaks", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/freezes/gift", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/friends", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/hints", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/jigsaw-v2", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/jigsaw", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/list-order?listKey=games", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/list-order", "PUT"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/live/synthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/live/create-alleskenner", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/live/create-chapter-guess", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/live/create-family-game", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/live/create", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/mysteries/attempts", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/mysteries/attempts", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/puzzle/coop", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/puzzle/history", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/puzzle/leaderboard", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/puzzle/match", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/puzzle/overview", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/puzzle/records", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/scrabble/synthetic/accept", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/scrabble/synthetic/cancel", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/scrabble/synthetic/decline", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/scrabble/synthetic/exchange", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/scrabble/synthetic/forfeit", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/scrabble/synthetic/hint", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/scrabble/synthetic/move", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/scrabble/synthetic/pass", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/scrabble/synthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/scrabble", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/scrabble", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/shop/freezes", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/shop/genees", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/shop/hints", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/shop", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/snelle-zendeling/leaderboard", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/snelle-zendeling/runs/synthetic/death", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/snelle-zendeling/runs/synthetic/finish", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/snelle-zendeling/runs/synthetic/genees", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/snelle-zendeling/runs/synthetic/resume", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/snelle-zendeling/runs/synthetic/revive/answer", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/snelle-zendeling/runs/synthetic/revive", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/snelle-zendeling/runs/synthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/snelle-zendeling/runs", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/snelle-zendeling/together", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/streak/celebration", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/streak/celebration", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/streak/continuation", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/streak/continuation", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/users/avatars", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/users/search", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/word-game/guess", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/word-game/hint", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/word-game/ranking", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/word-game", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/word-search/synthetic/find", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/word-search/synthetic/give-up", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/word-search/synthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/word-search", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/word-search", "POST"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fshop", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fkompas%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fkompas%2Fplay.jigsaw", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fkompas%2Fplay.word-search", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fkompas%2Fplay.word-game", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fkompas%2Fplay.scrabble", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fkompas%2Fplay.alleskenner", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fkompas%2Fplay.gezinsavond", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fkompas%2Fplay.chapter-guess", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fkompas%2Fplay.challenges", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fkompas%2Fplay.quick-missionary", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fkompas%2Fplay.mystery", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Facties", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Flesson%2Fsynthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Falleskenner%2Falleen%2Fsynthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Falleskenner%2Falleen", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Falleskenner", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Falleskenner%2Fseizoen%2Fsynthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Falleskenner%2Fseizoen", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fchallenges", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fchapter-guess", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fchapter-guess%2Fsolo%2Fsynthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fgezinsavond", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fjigsaw%2Fafgerond", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fjigsaw", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fjigsaw%2Frecords%2Fsynthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fjigsaw%2Frecords", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fjigsaw%2Fsamen%2Fsynthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fjigsaw%2Fwedstrijd%2Fsynthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Flive%2Fsynthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Flive", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F001", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F001a", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F001a%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F001b", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F001b%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F001c", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F001c%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F002", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F002a", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F002a%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F002b", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F002b%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F002c", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F002c%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F003", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F003a", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F003a%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F003b", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F003b%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F003c", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F003c%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F004", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F004a", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F004a%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F004b", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F004b%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F004c", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F004c%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F005", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F005a", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F005a%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F005b", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F005b%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F005c", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F005c%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F006", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F006a", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F006a%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F006b", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F006b%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F006c", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F006c%2Fplay", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fscrabble%2Fsynthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fscrabble", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fsnelle-zendeling", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fsnelle-zendeling%2Frun%2Fsynthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fsnelle-zendeling%2Fsamen%2Fsynthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fword-game", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fword-search%2Fsynthetic", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fword-search", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Flive%3Fkompas%3Dplay", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/page?route=%2Flive%3Fkompas%3Dadmin", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Facties%3Ftab%3Dcontinue", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/page?route=%2Facties%3Ftab%3Dforeign", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fsnelle-zendeling%3Fview%3Dleaderboard", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Flive%3Favailability%3Dunavailable", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/page?route=%2Fmysteries%2F001a%2Fplay%3Fresume%3Dcompleted", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/dictionary/%C3%89CRIT", "GET"));
        assertEquals(true, NativeAccessTransport.routeAllowed("games/users/search?q=Jan%2342", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/page", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/page?route=%2Fadminbackend", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/page?route=%2Flive&route=%2Fword-game", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/page?route=https%3A%2F%2Fevil.invalid", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/page?route=%2Flive%3Ftoken%3Dx", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/admin/users", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/auth/login", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/../profile", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/%2e%2e/profile", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/word-game?token=synthetic", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/word-game?url=https://evil.invalid", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/users/search?q=a&q=b", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/dictionary/%2Fadmin", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/dictionary/%252Fadmin", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/word-game#x", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/word-game\n", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/users/search?q=%ZZ", "GET"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/word-game", "DELETE"));
        assertEquals(false, NativeAccessTransport.routeAllowed("games/page?route=%2Flive", "POST"));
    }
    // END GAME REQUEST CASES
}
