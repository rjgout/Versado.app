package app.versado.app;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.media3.common.*;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.*;
import android.os.SystemClock;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import org.json.*;
import okhttp3.*;
import okio.ByteString;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Echte Android-codec achter exact dezelfde SourceData + ClippingMediaSource.
 * Alleen HTTPS-antwoorden zijn synthetisch; geen externe bron/toestelacceptatie. */
@UnstableApi @RunWith(AndroidJUnit4.class)
public class NativeAudioDecoderTest {
 @Test public void secureRangeAdapterDecodesAndStopsAtClipBoundary()throws Exception {
  var instrumentation=InstrumentationRegistry.getInstrumentation();var assets=instrumentation.getContext().getAssets();
  byte[] bytes;String body;try(var stream=assets.open("synthetic.mp3")){bytes=stream.readAllBytes();}try(var stream=assets.open("playback.json")){body=new String(stream.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);}
  JSONObject json=new JSONObject(body),audio=json.getJSONObject("audio");String id=String.join("",Collections.nCopies(64,"b"));
  audio.put("sources",new JSONArray().put(new JSONObject().put("id",id).put("kind","recording").put("language","nl").put("audioChapterId","chapter").put("collectionId","collection").put("sha256",ByteString.of(bytes).sha256().hex()).put("byteSize",bytes.length).put("start",7).put("end",8).put("verses",new JSONArray().put(new JSONObject().put("number",2).put("start",7).put("end",7.5)).put(new JSONObject().put("number",3).put("start",7.5).put("end",8)))));
  String token="e30."+ByteString.encodeUtf8(new JSONObject().put("userId","user").put("sid",audio.getString("sessionId")).put("version",0).put("purpose","native-access").put("iss","versado-native-v1").put("aud","versado-native-v1").put("exp",1700000300).toString()).base64Url().replace("=","")+".synthetic";
  assertTrue("Fixture moet paddingloze productie-JWT-vorm gebruiken",("Bearer "+token).matches("Bearer [A-Za-z0-9._~-]{1,2040}"));
  var credentials=new NativeAccessTransport.Credentials("synthetic-client-id","synthetic-native-audio-secret-123456");
  var capsule=new NativeAudioContext.Capsule(json.toString(),new NativeAudioContext.Claims(token),credentials,SystemClock.elapsedRealtimeNanos(),SystemClock::elapsedRealtimeNanos);
  AtomicInteger requests=new AtomicInteger();List<Request> captured=Collections.synchronizedList(new ArrayList<>());
  OkHttpClient edge=NativeAccessTransport.client().newBuilder().addInterceptor(chain->{Request request=chain.request();captured.add(request);requests.incrementAndGet();String[] range=request.header("Range").substring(6).split("-");int start=Integer.parseInt(range[0]),end=Integer.parseInt(range[1]);assertTrue(end-start<256*1024);return new Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(206).message("Synthetic").header("Content-Type","audio/mpeg").header("Access-Control-Allow-Origin","https://localhost").header("Content-Range","bytes "+start+"-"+end+"/"+bytes.length).body(ResponseBody.create(Arrays.copyOfRange(bytes,start,end+1),MediaType.get("audio/mpeg"))).build();}).build();
  var group=new NativeAudioPlayer.SourceGroup(capsule,capsule.recording(id),edge::newCall);
  CountDownLatch ended=new CountDownLatch(1);AtomicReference<Throwable> error=new AtomicReference<>();AtomicInteger rendered=new AtomicInteger();AtomicLong duration=new AtomicLong();AtomicReference<ExoPlayer> player=new AtomicReference<>();
  instrumentation.runOnMainSync(()->{try{
   ExoPlayer output=new ExoPlayer.Builder(instrumentation.getTargetContext()).build();player.set(output);
   MediaSource source=new ProgressiveMediaSource.Factory(()->new NativeAudioPlayer.SourceData(group)).createMediaSource(MediaItem.fromUri(NativeAudioPlayer.sourceUri(group.recording)));
   output.addListener(new Player.Listener(){@Override public void onPlayerError(PlaybackException failure){error.set(failure);ended.countDown();}@Override public void onPlaybackStateChanged(int state){if(state==Player.STATE_ENDED){var counters=output.getAudioDecoderCounters();if(counters!=null){counters.ensureUpdated();rendered.set(counters.renderedOutputBufferCount);}duration.set(output.getDuration());ended.countDown();}}});
   output.setMediaSource(new ClippingMediaSource(source,7000000,8000000));output.prepare();output.play();
  }catch(Throwable failure){error.set(failure);ended.countDown();}});
  try{assertTrue("Decoder moet binnen 30s eindigen",ended.await(30,TimeUnit.SECONDS));if(error.get()!=null){StringBuilder causes=new StringBuilder();for(Throwable cause=error.get();cause!=null;cause=cause.getCause())causes.append(cause.getClass().getSimpleName()).append(": ").append(cause.getMessage()).append("; ");throw new AssertionError("Synthetic decoder: "+causes+" rangeRequests="+requests.get());}assertTrue("Echte PCM-outputbuffers",rendered.get()>0);assertEquals(1000,duration.get());assertTrue(requests.get()>0);assertTrue("Geen HTTP per MP3-header: "+requests.get(),requests.get()<=64);for(Request request:captured){assertEquals("dev.versado.app",request.url().host());assertNull(request.url().query());assertNull(request.header("Cookie"));assertEquals("Bearer "+token,request.header("Authorization"));}}
  finally{group.close();instrumentation.runOnMainSync(()->{if(player.get()!=null)player.get().release();});capsule.lifetime.invalidate();edge.dispatcher().executorService().shutdown();edge.connectionPool().evictAll();}
 }
}
