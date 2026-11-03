package app.versado.app;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;
import java.nio.file.*;
import java.io.File;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import okio.ByteString;

public class NativeAudioContextTest {
 static final String STAMP="22222222-2222-4222-8222-222222222222",SID="11111111-1111-4111-8111-111111111111";
 static String token(String identity)throws Exception{return "e30."+ByteString.encodeUtf8(new JSONObject().put("userId","user").put("sid",SID).put("version",0).put("purpose","native-access").put("iss","versado-native-v1").put("aud","versado-native-v1").put("exp",1700000300).put("nonce",identity).toString()).base64Url()+".synthetic";}
 static String pair(String identity)throws Exception{return new JSONObject().put("accessToken",token(identity)).put("refreshToken",identity).put("expiresIn",300).toString();}
 static String stored(String refresh)throws Exception{return new JSONObject().put("refreshToken",refresh).toString();}
 static String fixture()throws Exception{for(File folder=new File(System.getProperty("user.dir"));folder!=null;folder=folder.getParentFile()){Path file=folder.toPath().resolve("tests/fixtures/native-audio/playback.json");if(Files.isRegularFile(file))return Files.readString(file);}throw new Exception("fixture missing");}
 static NativeAccessTransport.Credentials credentials()throws Exception{return new NativeAccessTransport.Credentials("synthetic-client-id","synthetic-native-audio-secret-123456");}
 @Test public void secureStorageCommitAndOldOutboxCannotActivateOrEraseNewStage()throws Exception{
  NativeAudioContext c=new NativeAudioContext(()->0L);c.reset(STAMP);c.stage("login",200,pair("new"),c.tag(STAMP));assertFalse(c.anchored());
  c.saved(stored("wrong"),true);assertFalse(c.anchored());c.saved(stored("old"),false);c.storedClear();c.saved(stored("new"),true);assertTrue(c.anchored());
  c.reset(STAMP);c.stage("login",200,pair("new"),c.tag(STAMP));c.saved(stored("new"),false);c.saved(stored("new"),true);assertFalse(c.anchored());
 }
 @Test public void oldRequestsAndBackgroundStagingNeverReactivate()throws Exception{
  NativeAudioContext c=new NativeAudioContext(()->0L);c.reset(STAMP);NativeAudioContext.Tag tag=c.tag(STAMP);c.reset(STAMP);c.stage("login",200,pair("old"),tag);c.saved(stored("old"),true);assertFalse(c.anchored());
  c.stage("login",200,pair("new"),c.tag(STAMP));c.setForeground(false);c.setForeground(true);c.saved(stored("new"),true);assertFalse(c.anchored());
 }
 @Test public void captureRequiresCurrentSessionTokenScopeAndHardDeadline()throws Exception{
  AtomicLong now=new AtomicLong();NativeAudioContext c=new NativeAudioContext(now::get);String body=fixture();NativeAudioContext.Scope scope=new NativeAudioContext.Scope(new JSONObject(body).getJSONObject("reader"));
  c.reset(STAMP);c.stage("login",200,pair("one"),c.tag(STAMP));c.saved(stored("one"),true);c.select(scope,"owner");NativeAudioContext.Tag tag=c.tag(STAMP);
  assertFalse(c.capture(scope.path(),200,body,"Bearer "+token("other"),credentials(),tag,0));
  assertTrue(c.capture(scope.path(),200,body,"Bearer "+token("one"),credentials(),tag,0));assertEquals(297000,c.capsule().remaining());
  now.set(297001L*1000000);assertFalse(c.capsule().lifetime.current());
  assertThrows(java.io.IOException.class,()->c.capture(scope.path(),200,body,"Bearer "+token("one"),credentials(),c.tag(STAMP),0));
  c.select(null);assertFalse(c.capture(scope.path(),200,body,"Bearer "+token("one"),credentials(),tag,0));
  c.select(scope,"new-owner");c.stage("refresh",200,pair("two"),c.tag(STAMP));c.saved(stored("two"),true);
  assertFalse(c.capture(scope.path(),200,body,"Bearer "+token("one"),credentials(),c.tag(STAMP),now.get()));
 }
}
