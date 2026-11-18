package app.versado.app;
import java.io.IOException;

/** Alleen de tijdelijke OS-audiofocuslease op de eigenaarqueue. Geen sessie,
 * spelerstatus of retry: een geweigerde aanvraag moet opnieuw expliciet komen. */
final class NativeAudioFocusGate {
    interface Driver { boolean request(Runnable lost); void release(); }
    private final Driver driver;
    private long epoch;
    private boolean granted;
    NativeAudioFocusGate(Driver driver){this.driver=driver;}
    void request(Runnable lost)throws IOException{
        if(granted)return;
        long lease=++epoch;
        boolean accepted;
        try{accepted=driver.request(()->{if(granted&&lease==epoch)lost.run();});}
        catch(RuntimeException error){release();throw new IOException("audio_focus_unavailable");}
        if(!accepted){release();throw new IOException("audio_focus_unavailable");}
        granted=true;
    }
    void release(){granted=false;epoch++;driver.release();}
}
