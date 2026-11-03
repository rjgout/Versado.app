package app.versado.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.IOException;
import java.util.*;

public class NativeAudioFocusGateTest {
 static final class Driver implements NativeAudioFocusGate.Driver {
  boolean accept;int requests,releases;final List<Runnable> callbacks=new ArrayList<>();
  public boolean request(Runnable lost){requests++;callbacks.add(lost);return accept;}
  public void release(){releases++;}
 }
 @Test public void refusalCannotBeBypassedBySecondExplicitRequest()throws Exception{
  Driver driver=new Driver();NativeAudioFocusGate gate=new NativeAudioFocusGate(driver);
  assertThrows(IOException.class,()->gate.request(()->fail("geen lease")));
  assertThrows(IOException.class,()->gate.request(()->fail("geen lease")));
  assertEquals(2,driver.requests);assertEquals(2,driver.releases);
  driver.accept=true;int[] lost={0};gate.request(()->lost[0]++);assertEquals(3,driver.requests);
  driver.callbacks.get(0).run();driver.callbacks.get(1).run();assertEquals(0,lost[0]);driver.callbacks.get(2).run();assertEquals(1,lost[0]);
 }
 @Test public void pauseOrFinishReleaseOnlyCurrentLeaseAndOldCallbackCannotStopResume()throws Exception{
  Driver driver=new Driver();driver.accept=true;NativeAudioFocusGate gate=new NativeAudioFocusGate(driver);int[] lost={0};
  gate.request(()->lost[0]++);gate.request(()->lost[0]++);assertEquals(1,driver.requests);
  gate.release();driver.callbacks.get(0).run();assertEquals(0,lost[0]);assertEquals(1,driver.releases);
  gate.request(()->lost[0]++);driver.callbacks.get(0).run();assertEquals(0,lost[0]);driver.callbacks.get(1).run();assertEquals(1,lost[0]);gate.release();
 }
 @Test public void driverExceptionFailsClosedAndNeverLeavesGrantedFlag()throws Exception{
  int[] attempts={0},releases={0};NativeAudioFocusGate gate=new NativeAudioFocusGate(new NativeAudioFocusGate.Driver(){public boolean request(Runnable lost){attempts[0]++;throw new IllegalStateException("synthetic");}public void release(){releases[0]++;}});
  assertThrows(IOException.class,()->gate.request(()->{}));assertThrows(IOException.class,()->gate.request(()->{}));assertEquals(2,attempts[0]);assertEquals(2,releases[0]);
 }
}
