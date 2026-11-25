package app.versado.app;

import android.media.MediaDataSource;
import android.os.Looper;
import java.io.IOException;
import java.util.Arrays;
import java.util.concurrent.Semaphore;

/** Dezelfde begrensde decoderadapter voor Media3. Extractors vragen soms vier
 * bytes per MP3-frame: één tijdelijk 64KiB-read-aheadblok voorkomt een HTTP-call
 * per header. Geen bestandscache; iedere aflevering blijft binnen de bestaande
 * intrekkingsgate. Close wacht nooit op netwerk-I/O en wist de buffer. */
final class NativeAudioDataSource extends MediaDataSource {
    interface ThreadCheck { boolean isMain(); }
    private static final int READ_AHEAD = 64 * 1024;
    private final NativeAudioTransport transport;
    private final ThreadCheck thread;
    private final Object bufferLock = new Object();
    private final byte[] buffer = new byte[READ_AHEAD];
    private final Semaphore fills = new Semaphore(4);
    private long bufferStart = -1;
    private int bufferLength;
    private volatile boolean closed;
    NativeAudioDataSource(NativeAudioTransport transport) {
        this(transport, () -> { Looper main = Looper.getMainLooper(); return main != null && Looper.myLooper() == main; });
    }
    NativeAudioDataSource(NativeAudioTransport transport, ThreadCheck thread) { this.transport = transport; this.thread = thread; }
    private IOException unavailable() { return new IOException("audio_transport_unavailable"); }
    @Override public int readAt(long position, byte[] target, int offset, int size) throws IOException {
        if (thread.isMain()) throw new IOException("audio_thread_invalid");
        if (position < 0 || target == null || offset < 0 || size < 0 || (long)offset + size > target.length) throw unavailable();
        if (size == 0 || size >= READ_AHEAD) return transport.read(position,target,offset,size);
        synchronized (bufferLock) {
            int hit = transport.deliver(() -> {
                if (closed) throw unavailable();
                if (position < bufferStart || position >= bufferStart + bufferLength) return -2;
                int from=(int)(position-bufferStart),count=Math.min(size,bufferLength-from);
                System.arraycopy(buffer,from,target,offset,count);return count;
            });
            if (hit != -2) return hit;
        }
        if (!fills.tryAcquire()) throw unavailable();
        byte[] fresh = new byte[READ_AHEAD];
        try {
            // Geen buffer-/lifetime-lock tijdens execute(): close kan direct annuleren.
            int received=transport.read(position,fresh,0,fresh.length);
            if (received < 0) return -1;
            synchronized (bufferLock) {
                return transport.deliver(() -> {
                    if (closed) throw unavailable();
                    Arrays.fill(buffer,(byte)0);System.arraycopy(fresh,0,buffer,0,received);
                    bufferStart=position;bufferLength=received;
                    int count=Math.min(size,received);System.arraycopy(buffer,0,target,offset,count);return count;
                });
            }
        } finally { Arrays.fill(fresh,(byte)0);fills.release(); }
    }
    @Override public long getSize() throws IOException { return transport.size(); }
    @Override public void close() {
        closed=true;transport.close();
        synchronized(bufferLock){Arrays.fill(buffer,(byte)0);bufferStart=-1;bufferLength=0;}
    }
}
