package app.versado.app;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import java.util.function.LongSupplier;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.*;

/** Native interne transportbasis; geen plugincommand, JS-bytes of nieuwe sessie. */
final class NativeAudioTransport implements AutoCloseable {
    static final int MAX_CHUNK = 256 * 1024;
    static final long MAX_FILE = 256L * 1024 * 1024;
    static final class Lifetime {
        private final long deadline;
        private final LongSupplier clock;
        private boolean stopped;
        private final Map<UUID, Runnable> callbacks = new java.util.HashMap<>();
        Lifetime(long validForMillis) { this(validForMillis, android.os.SystemClock::elapsedRealtimeNanos); }
        Lifetime(long validForMillis, LongSupplier clock) { this.clock = clock; deadline = clock.getAsLong() + Math.max(0, Math.min(validForMillis, 300000)) * 1000000L; }
        synchronized boolean current() { return !stopped && clock.getAsLong() < deadline; }
        interface Delivery<T> { T run() throws IOException; }
        synchronized <T> T deliver(Delivery<T> delivery) throws IOException {
            if (!current()) throw unavailable(); return delivery.run();
        }
        synchronized void exclusive(Runnable action) { action.run(); }
        UUID observe(Runnable callback) {
            UUID id = UUID.randomUUID(); boolean valid;
            synchronized (this) { valid = current(); if (valid) callbacks.put(id, callback); }
            if (!valid) callback.run(); return id;
        }
        synchronized void remove(UUID id) { callbacks.remove(id); }
        void invalidate() {
            Runnable[] pending;
            synchronized (this) { stopped = true; pending = callbacks.values().toArray(new Runnable[0]); callbacks.clear(); }
            for (Runnable callback : pending) callback.run();
        }
    }
    private final String path, authorization, origin;
    private final NativeAccessTransport.Credentials credentials;
    private final Lifetime lifetime;
    private final NativeAccessTransport.Calls calls;
    private final long total;
    private final AtomicBoolean closed = new AtomicBoolean();
    private final Semaphore slots = new Semaphore(4);
    private final Map<Call, Boolean> inflight = new ConcurrentHashMap<>();
    private final UUID observer;
    NativeAudioTransport(String path, long total, String authorization, NativeAccessTransport.Credentials credentials, String origin, Lifetime lifetime) throws IOException {
        this(path, total, authorization, credentials, origin, lifetime, NativeAccessTransport.client()::newCall);
    }
    NativeAudioTransport(String path, long total, String authorization, NativeAccessTransport.Credentials credentials, String origin, Lifetime lifetime, NativeAccessTransport.Calls calls) throws IOException {
        if (path == null || !path.matches("courses/[A-Za-z0-9_-]{1,128}/read/(?:steps|chapters)/[A-Za-z0-9_-]{1,128}/audio/[a-f0-9]{64}/stream") ||
            total <= 0 || total > MAX_FILE || authorization == null || !authorization.matches("Bearer [A-Za-z0-9._~-]{1,2040}") || lifetime == null ||
            !("https://localhost".equals(origin) || "capacitor://localhost".equals(origin))) throw unavailable();
        this.path = path; this.total = total; this.authorization = authorization; this.credentials = credentials; this.origin = origin; this.lifetime = lifetime; this.calls = calls;
        observer = lifetime.observe(this::close);
    }
    private static IOException unavailable() { return new IOException("audio_transport_unavailable"); }
    <T> T deliver(Lifetime.Delivery<T> delivery) throws IOException {
        return lifetime.deliver(() -> { if (closed.get()) throw unavailable(); return delivery.run(); });
    }
    private void current() throws IOException { deliver(() -> null); }
    long size() throws IOException { current(); return total; }
    /** MediaDataSource mag gedeeltelijke reads ontvangen. Nooit meer dan één
     * begrensde range per readAt, ook bij een extreem grote decoder-aanvraag. */
    int read(long position, byte[] buffer, int offset, int size) throws IOException {
        current();
        if (position < 0 || buffer == null || offset < 0 || size < 0 || (long) offset + size > buffer.length) throw unavailable();
        if (size == 0) return 0;
        if (position >= total) return -1;
        if (!slots.tryAcquire()) throw unavailable();
        int length = (int) Math.min(Math.min(size, MAX_CHUNK), total - position);
        Call call = null;
        byte[] chunk = new byte[length];
        try {
            Request.Builder builder = new Request.Builder().url((credentials == null ? NativeAccessTransport.TEST_ORIGIN : NativeAccessTransport.ORIGIN) + "/api/v1/native/" + path)
                .tag(AtomicBoolean.class, new AtomicBoolean())
                .header("Origin", origin).header("X-Versado-Client", "native-v1")
                .header("Accept", "audio/mpeg").header("Accept-Encoding", "identity")
                .header("Authorization", authorization)
                .header("Range", "bytes=" + position + "-" + (position + length - 1)).get();
            if (credentials != null) builder.header("CF-Access-Client-Id", credentials.id).header("CF-Access-Client-Secret", credentials.secret);
            Request request = builder.build();
            call = calls.create(request); inflight.put(call, true); current();
            try (Response response = call.execute()) {
                current();
                String type = response.header("Content-Type"), encoding = response.header("Content-Encoding");
                if (response.code() != 206 || type == null || !"audio/mpeg".equalsIgnoreCase(type.split(";", 2)[0].trim()) ||
                    !origin.equals(response.header("Access-Control-Allow-Origin")) || encoding != null && !"identity".equalsIgnoreCase(encoding) ||
                    !("bytes " + position + "-" + (position + length - 1) + "/" + total).equals(response.header("Content-Range")) ||
                    response.body() == null || response.body().contentLength() != length) throw unavailable();
                try (InputStream input = response.body().byteStream()) {
                    int received = 0;
                    while (received < length) {
                        current(); int count = input.read(chunk, received, length - received);
                        if (count < 0) throw unavailable();
                        if (count == 0) continue;
                        received += count;
                    }
                    if (input.read() != -1) throw unavailable();
                    return lifetime.deliver(() -> { if (closed.get()) throw unavailable(); System.arraycopy(chunk, 0, buffer, offset, length); return length; });
                }
            }
        } catch (IOException ignored) { throw unavailable(); }
        finally { Arrays.fill(chunk, (byte) 0); if (call != null) { inflight.remove(call); call.cancel(); } slots.release(); }
    }
    @Override public void close() {
        lifetime.exclusive(() -> {
            if (!closed.compareAndSet(false, true)) return;
            for (Call call : inflight.keySet()) call.cancel(); inflight.clear();
            // observe kan bij een reeds verlopen lifetime synchronisch close doen.
            if (observer != null) lifetime.remove(observer);
        });
    }
}
