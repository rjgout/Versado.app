package app.versado.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.concurrent.*;
import okhttp3.*;
import okio.Buffer;
import okio.BufferedSource;

public class NativeAudioTransportTest {
    private final String path = "courses/course/read/chapters/chapter/audio/" + new String(new char[64]).replace('\0', 'a') + "/stream";
    private final NativeAccessTransport.Credentials credentials;
    public NativeAudioTransportTest() throws Exception { credentials = new NativeAccessTransport.Credentials("synthetic-client-id", "synthetic-native-audio-secret-123456"); }
    static byte[] fixture() throws IOException {
        File folder = new File(System.getProperty("user.dir"));
        for (int i = 0; folder != null && i < 6; i++, folder = folder.getParentFile()) {
            File file = new File(folder, "tests/fixtures/native-audio/synthetic.mp3");
            if (file.isFile()) return Files.readAllBytes(file.toPath());
        }
        throw new IOException("Synthetische MP3 ontbreekt");
    }
    static final class Edge implements Interceptor {
        final byte[] bytes;
        int status = 206, count;
        String type = "audio/mpeg", origin = "https://localhost", encoding;
        boolean wrongRange, shortBody, oversizedBody;
        Runnable beforeReply;
        Request captured;
        final OkHttpClient client = NativeAccessTransport.client().newBuilder().addInterceptor(this).build();
        Edge() throws IOException { bytes = fixture(); }
        @Override public Response intercept(Chain chain) {
            captured = chain.request(); count++;
            if (beforeReply != null) beforeReply.run();
            String[] range = captured.header("Range").substring(6).split("-");
            int start = Integer.parseInt(range[0]), end = Integer.parseInt(range[1]), length = end - start + 1;
            byte[] payload = Arrays.copyOfRange(bytes, start, end + 1 + (oversizedBody ? 1 : shortBody ? -1 : 0));
            ResponseBody body = new ResponseBody() {
                final Buffer data = new Buffer().write(payload);
                @Override public MediaType contentType() { return MediaType.get(type); }
                @Override public long contentLength() { return length; }
                @Override public BufferedSource source() { return data; }
            };
            Response.Builder response = new Response.Builder().request(captured).protocol(Protocol.HTTP_1_1).code(status).message("Synthetic")
                .body(body).header("Content-Type", type).header("Access-Control-Allow-Origin", origin)
                .header("Content-Range", "bytes " + start + "-" + end + "/" + (bytes.length + (wrongRange ? 1 : 0)));
            if (encoding != null) response.header("Content-Encoding", encoding);
            return response.build();
        }
    }
    static NativeAudioTransport.Lifetime life(long millis) { return new NativeAudioTransport.Lifetime(millis, System::nanoTime); }
    @Test public void expiryIncludesSimulatedDeviceSleepAndHasHardLifetimeBound() throws Exception {
        java.util.concurrent.atomic.AtomicLong now = new java.util.concurrent.atomic.AtomicLong();
        NativeAudioTransport.Lifetime life = new NativeAudioTransport.Lifetime(600000, now::get);
        assertTrue(life.current()); now.set(300001L * 1000000); assertFalse(life.current());
        assertThrows(IOException.class, () -> life.deliver(() -> true));
    }
    @Test public void invalidationIsOrderedWithTheFinalDeliveryGate() throws Exception {
        NativeAudioTransport.Lifetime life = life(120000);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), invalidationStarted = new CountDownLatch(1);
        ExecutorService workers = Executors.newFixedThreadPool(2);
        try {
            Future<?> delivery = workers.submit(() -> { try { life.deliver(() -> { entered.countDown(); try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); } return true; }); } catch (IOException e) { throw new AssertionError(e); } });
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            Future<?> invalidate = workers.submit(() -> { invalidationStarted.countDown(); life.invalidate(); });
            assertTrue(invalidationStarted.await(5, TimeUnit.SECONDS));
            assertThrows(TimeoutException.class, () -> invalidate.get(50, TimeUnit.MILLISECONDS));
            release.countDown(); delivery.get(5, TimeUnit.SECONDS); invalidate.get(5, TimeUnit.SECONDS);
            assertThrows(IOException.class, () -> life.deliver(() -> true));
        } finally { release.countDown(); workers.shutdownNow(); }
    }
    NativeAudioTransport transport(Edge edge, NativeAudioTransport.Lifetime lifetime) throws IOException {
        return new NativeAudioTransport(path, edge.bytes.length, "Bearer synthetic.native.token", credentials, "https://localhost", lifetime, edge.client::newCall);
    }
    @Test public void boundedReadSeekEofAndActualAdapterDelegation() throws Exception {
        Edge edge = new Edge(); NativeAudioTransport.Lifetime life = life(120000);
        NativeAudioTransport transport = transport(edge, life);
        // Alleen threadidentificatie is geïnjecteerd; eigen readAt/getSize/close
        // worden uitgevoerd. Dit is geen MediaPlayer-decoder/toesteltest.
        NativeAudioDataSource source = new NativeAudioDataSource(transport, () -> false);
        assertEquals(edge.bytes.length, source.getSize());
        byte[] target = new byte[NativeAudioTransport.MAX_CHUNK + 50];
        assertEquals(NativeAudioTransport.MAX_CHUNK, source.readAt(0, target, 0, target.length));
        assertArrayEquals(Arrays.copyOf(edge.bytes, NativeAudioTransport.MAX_CHUNK), Arrays.copyOf(target, NativeAudioTransport.MAX_CHUNK));
        assertEquals(4, source.readAt(edge.bytes.length - 4, target, 3, 10));
        assertArrayEquals(Arrays.copyOfRange(edge.bytes, edge.bytes.length - 4, edge.bytes.length), Arrays.copyOfRange(target, 3, 7));
        int before = edge.count; assertEquals(-1, source.readAt(edge.bytes.length, target, 0, 10)); assertEquals(before, edge.count);
        assertEquals("identity", edge.captured.header("Accept-Encoding")); assertNull(edge.captured.header("Cookie"));
        assertEquals(credentials.secret, edge.captured.header("CF-Access-Client-Secret"));
        assertEquals("dev.versado.app", edge.captured.url().host()); assertNull(edge.captured.url().query());
        assertFalse(edge.captured.url().toString().contains(credentials.secret));
        source.close(); assertThrows(IOException.class, source::getSize);
    }
    @Test public void tinyExtractorReadsUseBoundedReadAheadAndKeepRevocationGate() throws Exception {
        Edge edge=new Edge();NativeAudioTransport.Lifetime lifetime=life(120000);NativeAudioTransport transport=transport(edge,lifetime);
        NativeAudioDataSource source=new NativeAudioDataSource(transport,()->false);byte[] target=new byte[4];
        for(int position=0;position<4096;position+=4){assertEquals(4,source.readAt(position,target,0,4));assertArrayEquals(Arrays.copyOfRange(edge.bytes,position,position+4),target);}
        assertEquals("Geen HTTP per MP3-header",1,edge.count);assertEquals("bytes=0-65535",edge.captured.header("Range"));
        lifetime.invalidate();assertThrows(IOException.class,()->source.readAt(4,target,0,4));source.close();
    }
    @Test public void closingTransportAlsoRejectsAlreadyBufferedBytes() throws Exception {
        Edge edge=new Edge();NativeAudioTransport.Lifetime lifetime=life(120000);NativeAudioTransport transport=transport(edge,lifetime);NativeAudioDataSource source=new NativeAudioDataSource(transport,()->false);byte[] target=new byte[4];
        assertEquals(4,source.readAt(0,target,0,4));transport.close();assertThrows(IOException.class,()->source.readAt(4,target,0,4));source.close();
    }
    @Test public void hostileResponsesNeverReturnBytes() throws Exception {
        for (int scenario = 0; scenario < 10; scenario++) {
            Edge edge = new Edge();
            switch (scenario) {
                case 0: edge.status = 200; break;
                case 1: edge.status = 302; break;
                case 2: edge.status = 401; break;
                case 3: edge.status = 416; break;
                case 4: edge.type = "text/html"; break;
                case 5: edge.encoding = "gzip"; break;
                case 6: edge.origin = "https://evil.invalid"; break;
                case 7: edge.wrongRange = true; break;
                case 8: edge.shortBody = true; break;
                default: edge.oversizedBody = true;
            }
            try (NativeAudioTransport transport = transport(edge, life(120000))) {
                byte[] target = new byte[100]; assertThrows(IOException.class, () -> transport.read(0, target, 0, 100));
                assertArrayEquals(new byte[100], target); assertEquals(1, edge.count);
            }
        }
    }
    @Test public void lateResponseAfterNativeInvalidationIsDiscarded() throws Exception {
        Edge edge = new Edge(); NativeAudioTransport.Lifetime life = life(120000);
        edge.beforeReply = life::invalidate;
        try (NativeAudioTransport transport = transport(edge, life)) {
            byte[] target = new byte[100]; assertThrows(IOException.class, () -> transport.read(0, target, 0, 100));
            assertArrayEquals(new byte[100], target);
        }
        Edge retired = new Edge();
        try (NativeAudioTransport transport = transport(retired, life(0))) {
            assertThrows(IOException.class, () -> transport.read(0, new byte[100], 0, 100)); assertEquals(0, retired.count);
        }
    }
    @Test public void concurrentCloseCancelsInFlightReadWithoutLateCopy() throws Exception {
        Edge edge = new Edge(); CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        edge.beforeReply = () -> { entered.countDown(); try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); } };
        NativeAudioTransport transport = transport(edge, life(120000)); byte[] target = new byte[100];
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try {
            Future<?> task = worker.submit(() -> { assertThrows(IOException.class, () -> transport.read(0, target, 0, 100)); });
            assertTrue(entered.await(5, TimeUnit.SECONDS)); transport.close(); release.countDown(); task.get(5, TimeUnit.SECONDS);
            assertArrayEquals(new byte[100], target);
        } finally { transport.close(); release.countDown(); worker.shutdownNow(); }
    }
    @Test public void requestPolicyRejectsArbitraryUrlsQueriesAndBadBounds() throws Exception {
        Edge edge = new Edge(); NativeAudioTransport.Lifetime life = life(120000);
        for (String p : new String[]{"https://evil.invalid/audio", "../admin", path + "?url=x", path + "\n", path.replace("chapters", "cfm"), path.replace("/stream", "/annotations")})
            assertThrows(IOException.class, () -> new NativeAudioTransport(p, edge.bytes.length, "Bearer synthetic.native", credentials, "https://localhost", life));
        try (NativeAudioTransport transport = transport(edge, life)) {
            assertThrows(IOException.class, () -> transport.read(-1, new byte[10], 0, 1));
            assertThrows(IOException.class, () -> transport.read(0, new byte[10], 5, Integer.MAX_VALUE));
        }
    }
}
