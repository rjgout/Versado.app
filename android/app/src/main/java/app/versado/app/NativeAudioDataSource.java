package app.versado.app;

import android.media.MediaDataSource;
import android.os.Looper;
import java.io.IOException;

/** De echte Android-decoderadapter, nog niet aan een actieve speler gekoppeld. */
final class NativeAudioDataSource extends MediaDataSource {
    interface ThreadCheck { boolean isMain(); }
    private final NativeAudioTransport transport;
    private final ThreadCheck thread;
    NativeAudioDataSource(NativeAudioTransport transport) {
        this(transport, () -> { Looper main = Looper.getMainLooper(); return main != null && Looper.myLooper() == main; });
    }
    NativeAudioDataSource(NativeAudioTransport transport, ThreadCheck thread) { this.transport = transport; this.thread = thread; }
    @Override public int readAt(long position, byte[] buffer, int offset, int size) throws IOException {
        if (thread.isMain()) throw new IOException("audio_thread_invalid");
        return transport.read(position, buffer, offset, size);
    }
    @Override public long getSize() throws IOException { return transport.size(); }
    @Override public void close() { transport.close(); }
}
