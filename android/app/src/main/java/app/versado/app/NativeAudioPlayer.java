package app.versado.app;

import android.content.Context;
import android.content.BroadcastReceiver;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import androidx.media3.common.*;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.*;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.source.*;
import java.io.IOException;
import java.util.*;
import java.util.function.Consumer;
import org.json.*;

/** Alleen uitvoer. Gedeelde React-provider blijft eigenaar van de interface;
 * Capsule/context komt uitsluitend uit de bestaande beveiligde native brug. */
@UnstableApi
final class NativeAudioPlayer {
    final NativeAudioContext context;
    Consumer<JSONObject> emit=value->{};
    private final Context app;
    private final Handler main=new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private SourceGroup sourceGroup;
    private boolean destroyed;
    private final BroadcastReceiver noisy = new BroadcastReceiver(){@Override public void onReceive(Context context,Intent intent){if(command!=null)NativeAudioPlayer.this.context.suspend();}};
    private TextToSpeech speech;
    private boolean speechReady,ttsStarted;
    private final List<Consumer<JSONArray>> voiceWaiters=new ArrayList<>();
    private NativeAudioContext.Capsule active;
    private String command,recording,voice,utterance;
    private long generation,actionVersion;
    private int index,ttsOffset;
    private float speed=1;
    private boolean playing,finished,renewSignalled,triedFallback;
    private AudioFocusRequest focus;
    private AudioManager.OnAudioFocusChangeListener focusListener;
    NativeAudioPlayer(Context app,NativeAudioContext context){this.app=app.getApplicationContext();this.context=context;context.onInvalidated=()->clear("invalidated",false);
        IntentFilter filter=new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if(android.os.Build.VERSION.SDK_INT>=33)this.app.registerReceiver(noisy,filter,Context.RECEIVER_NOT_EXPORTED);else this.app.registerReceiver(noisy,filter);
    }
    JSONObject status()throws JSONException{
        JSONObject value=new JSONObject().put("contextEpoch",context.epoch()).put("anchored",context.anchored()).put("foreground",context.foreground()).put("validForMs",context.capsule()==null?0:context.capsule().remaining());
        if(context.owner()!=null)value.put("ownerId",context.owner());if(context.capsule()!=null)value.put("readerHash",context.capsule().readerHash);return value;
    }
    private void event(String reason,boolean stopped,boolean failed){
        if(command==null)return;
        try{JSONObject value=new JSONObject().put("commandId",command).put("actionVersion",actionVersion).put("index",index).put("playing",playing).put("stopped",stopped).put("failed",failed);if(reason!=null)value.put("reason",reason);emit.accept(value);}catch(JSONException ignored){}
    }
    private boolean valid(){return command!=null&&active!=null&&active.lifetime.current()&&context.capsule()!=null&&context.capsule().lifetime.current();}
    private void release(){
        generation++;if(sourceGroup!=null){sourceGroup.close();sourceGroup=null;}utterance=null;if(speech!=null)speech.stop();if(player!=null){player.release();player=null;}
        AudioManager manager=(AudioManager)app.getSystemService(Context.AUDIO_SERVICE);
        if(android.os.Build.VERSION.SDK_INT>=26&&focus!=null)manager.abandonAudioFocusRequest(focus);
        else if(focusListener!=null)manager.abandonAudioFocus(focusListener);
        focus=null;focusListener=null;
    }
    private void clear(String reason,boolean failed){
        release();main.removeCallbacks(tick);playing=false;event(reason,true,failed);active=null;command=null;recording=null;voice=null;index=0;ttsOffset=0;finished=false;renewSignalled=false;
    }
    void fail(){clear("unavailable",true);context.invalidate();}
    void suspend(){context.suspend();}
    void destroy(){if(destroyed)return;destroyed=true;context.reset(null);app.unregisterReceiver(noisy);if(speech!=null){speech.shutdown();speech=null;}voiceWaiters.clear();main.removeCallbacksAndMessages(null);}
    private final Runnable tick=new Runnable(){@Override public void run(){
        if(command==null)return;if(!valid()){clear("expired",true);context.invalidate();return;}
        if(player!=null&&recording!=null){try{NativeAudioContext.Recording source=active.recording(recording);double at=source.start+player.getCurrentPosition()/1000d;int next=0;for(int i=0;i<source.verses.size();i++)if(source.verses.get(i).start<=at)next=i;if(next!=index){index=next;event(null,false,false);}}catch(IOException ignored){fail();return;}}
        if(!renewSignalled&&active.remaining()<60000){renewSignalled=true;event("renew",false,false);}main.postDelayed(this,150);
    }};
    void authorized(){
        NativeAudioContext.Capsule fresh=context.capsule(),old=active;if(old==null||fresh==null||command==null)return;
        if(!old.readerHash.equals(fresh.readerHash)){fail();return;}if(old.claims.token.equals(fresh.claims.token))return;
        Long at=player==null?null:player.getCurrentPosition();boolean resume=playing;
        if(recording!=null){release();active=fresh;playing=resume;try{prepareRecording(at,resume);}catch(Exception ignored){fail();}}
        else{active=fresh;old.lifetime.invalidate();}renewSignalled=false;
    }
    void control(JSONObject value)throws Exception{
        String action=value.getString("action"),id=value.getString("commandId");UUID.fromString(id);
        long sequence=NativeAudioContext.integer(value,"actionVersion",1,9007199254740991L);
        NativeAudioContext.Capsule capsule=context.capsule();
        if(!context.foreground()||capsule==null||!capsule.lifetime.current()||!Objects.equals(context.owner(),value.getString("ownerId"))||context.tag(value.getString("sessionStamp"))==null||NativeAudioContext.integer(value,"contextEpoch",0,9007199254740991L)!=context.epoch()||!capsule.readerHash.equals(value.getString("readerHash")))throw NativeAudioContext.invalid();
        if("start".equals(action)){
            int number=(int)NativeAudioContext.integer(value,"index",0,capsule.verses.size()-1);double rate=NativeAudioContext.seconds(value,"speed");if(!Arrays.asList(.75,1d,1.25,1.5,2d).contains(rate))throw NativeAudioContext.invalid();
            String source=value.isNull("sourceId")?null:value.optString("sourceId",null),selectedVoice=value.optString("voiceId",null);
            if(source!=null)capsule.recording(source);else findVoice(selectedVoice,capsule);
            clear("replaced",false);active=capsule;command=id;actionVersion=sequence;index=number;speed=(float)rate;recording=source;voice=selectedVoice;playing=true;triedFallback=false;
            try{if(source!=null)prepareRecording(null,true);else speak();main.post(tick);event(null,false,false);}catch(Exception error){fail();throw NativeAudioContext.invalid();}return;
        }
        if(!id.equals(command)||sequence<=actionVersion||!valid())throw NativeAudioContext.invalid();actionVersion=sequence;
        switch(action){
            case "stop":context.invalidate();break;
            case "pause":playing=false;if(player!=null)player.pause();else{utterance=null;if(speech!=null)speech.stop();ttsOffset=0;}event(null,false,false);break;
            case "resume":playing=true;if(player!=null){if(finished){finished=false;player.seekTo(0);}player.play();}else speak();event(null,false,false);break;
            case "seek":index=(int)NativeAudioContext.integer(value,"index",0,capsule.verses.size()-1);finished=false;if(player!=null){NativeAudioContext.Recording source=active.recording(recording);player.seekTo((long)((source.verses.get(index).start-source.start)*1000));}else{utterance=null;speech.stop();ttsOffset=0;if(playing)speak();}event(null,false,false);break;
            case "speed":double rate=NativeAudioContext.seconds(value,"speed");if(!Arrays.asList(.75,1d,1.25,1.5,2d).contains(rate))throw NativeAudioContext.invalid();speed=(float)rate;if(player!=null)player.setPlaybackParameters(new PlaybackParameters(speed));else{utterance=null;speech.stop();ttsOffset=0;if(playing)speak();}event(null,false,false);break;
            default:throw NativeAudioContext.invalid();
        }
    }
    private void prepareRecording(Long position,boolean autoplay)throws Exception{
        NativeAudioContext.Recording source=active.recording(recording);long current=generation;
        SourceGroup group=new SourceGroup(active,source);sourceGroup=group;
        MediaSource progressive=new ProgressiveMediaSource.Factory(()->new SourceData(group)).createMediaSource(MediaItem.fromUri(sourceUri(source)));
        long end=source.end==null?C.TIME_END_OF_SOURCE:(long)(source.end*1000000);
        MediaSource clipped=new ClippingMediaSource(progressive,(long)(source.start*1000000),end);
        ExoPlayer output=new ExoPlayer.Builder(app).setLoadControl(new DefaultLoadControl.Builder().setBufferDurationsMs(5000,15000,500,1000).setTargetBufferBytes(2*1024*1024).setPrioritizeTimeOverSizeThresholds(false).build()).build();player=output;
        output.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(),true);
        output.setHandleAudioBecomingNoisy(true);
        output.addListener(new Player.Listener(){
            private boolean current(){return generation==current&&player==output&&valid();}
            @Override public void onPlayerError(PlaybackException error){if(current())recordingFailed();}
            @Override public void onPlaybackStateChanged(int state){if(!current())return;if(state==Player.STATE_ENDED)finish();else event(null,false,false);}
            @Override public void onPlayWhenReadyChanged(boolean ready,int reason){if(current()&&!ready&&(reason==Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS||reason==Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY))context.suspend();}
        });
        output.setMediaSource(clipped);output.setPlaybackParameters(new PlaybackParameters(speed));output.prepare();
        output.seekTo(position==null?(long)((source.verses.get(index).start-source.start)*1000):Math.max(0,position));output.setPlayWhenReady(autoplay&&playing);
    }
    private void recordingFailed(){
        if(active==null||triedFallback){fail();return;}for(NativeAudioContext.Recording source:active.sources)if(Objects.equals(source.fallbackFor,recording)){
            triedFallback=true;release();recording=source.id;try{prepareRecording(null,playing);}catch(Exception ignored){fail();}return;
        }fail();
    }
    private void finish(){if(player!=null)player.pause();playing=false;index=0;ttsOffset=0;finished=true;event(null,false,false);}
    static Uri sourceUri(NativeAudioContext.Recording source){return Uri.parse("versado-audio://source/"+source.id+".mp3");}
    /** Geen HTTP-library of URL-router: deze decoderadapter accepteert alleen
     * de geselecteerde opaque URI en delegeert alle reads aan PR261. */
    static final class SourceGroup {
        final NativeAudioContext.Capsule capsule;final NativeAudioContext.Recording recording;
        private final Set<NativeAudioDataSource> sources=new HashSet<>();private boolean closed;
        private final NativeAccessTransport.Calls calls;
        SourceGroup(NativeAudioContext.Capsule capsule,NativeAudioContext.Recording recording){this(capsule,recording,null);}
        // Alleen package-interne OS-contractproeven vervangen HTTP; geen JS-optie.
        SourceGroup(NativeAudioContext.Capsule capsule,NativeAudioContext.Recording recording,NativeAccessTransport.Calls calls){this.capsule=capsule;this.recording=recording;this.calls=calls;}
        NativeAudioDataSource open()throws IOException{
            NativeAudioTransport transport=calls==null?capsule.transport(recording.id):new NativeAudioTransport(capsule.scope.path().replace("/audio/playback","/audio/"+recording.id+"/stream"),recording.size,"Bearer "+capsule.claims.token,capsule.credentials,"https://localhost",capsule.lifetime,calls);
            NativeAudioDataSource source=new NativeAudioDataSource(transport);
            boolean accepted; synchronized(this){accepted=!closed&&sources.size()<4;if(accepted)sources.add(source);}
            if(!accepted){source.close();throw NativeAudioContext.invalid();}return source;
        }
        void release(NativeAudioDataSource source){synchronized(this){sources.remove(source);}source.close();}
        void close(){NativeAudioDataSource[] pending;synchronized(this){closed=true;pending=sources.toArray(new NativeAudioDataSource[0]);sources.clear();}for(NativeAudioDataSource source:pending)source.close();}
    }
    static final class SourceData extends BaseDataSource{
        private final SourceGroup group;
        private NativeAudioDataSource source;private long position,remaining;private boolean opened;
        SourceData(SourceGroup group){super(true);this.group=group;}
        @Override public long open(DataSpec spec)throws IOException{
            if(opened||!spec.uri.equals(sourceUri(group.recording))||spec.position<0||spec.position>group.recording.size||spec.httpMethod!=DataSpec.HTTP_METHOD_GET||(spec.length!=C.LENGTH_UNSET&&spec.length<0))throw NativeAudioContext.invalid();
            transferInitializing(spec);source=group.open();position=spec.position;remaining=group.recording.size-position;
            if(spec.length!=C.LENGTH_UNSET)remaining=Math.min(remaining,spec.length);opened=true;transferStarted(spec);return remaining;
        }
        @Override public int read(byte[] bytes,int offset,int length)throws IOException{
            if(!opened||source==null)throw NativeAudioContext.invalid();if(length==0)return 0;if(remaining==0)return C.RESULT_END_OF_INPUT;
            int count=source.readAt(position,bytes,offset,(int)Math.min(length,remaining));if(count<0)throw NativeAudioContext.invalid();position+=count;remaining-=count;bytesTransferred(count);return count;
        }
        @Override public Uri getUri(){return opened?sourceUri(group.recording):null;}
        @Override public void close(){if(source!=null){group.release(source);source=null;}if(opened){opened=false;transferEnded();}}
    }
    private void initializeSpeech(){
        if(ttsStarted)return;ttsStarted=true;
        speech=new TextToSpeech(app,status->main.post(()->{
            if(destroyed)return;
            speechReady=status==TextToSpeech.SUCCESS;
            if(speechReady)speech.setOnUtteranceProgressListener(new UtteranceProgressListener(){
                @Override public void onStart(String id){main.post(()->{if(utterance!=null&&utterance.equals(id)&&valid()&&playing)event(null,false,false);});}
                @Override public void onDone(String id){main.post(()->{if(utterance==null||!utterance.equals(id)||!valid()||!playing)return;utterance=null;try{speakNext();}catch(Exception ignored){fail();}});}
                @Override public void onError(String id){main.post(()->{if(utterance!=null&&utterance.equals(id)&&valid())fail();});}
            });
            JSONArray voices=voiceRows();List<Consumer<JSONArray>> pending=new ArrayList<>(voiceWaiters);voiceWaiters.clear();for(Consumer<JSONArray> waiter:pending)waiter.accept(voices);
        }));
    }
    private List<Voice> localVoices(){
        if(!speechReady||speech==null)return Collections.emptyList();Set<Voice> available=speech.getVoices();if(available==null)return Collections.emptyList();List<Voice> result=new ArrayList<>();
        for(Voice voice:available)if(!voice.isNetworkConnectionRequired()&&NativeAudioContext.language(voice.getLocale().getLanguage())&&(voice.getFeatures()==null||!voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)))result.add(voice);
        result.sort(Comparator.comparing(Voice::getName));return result;
    }
    private JSONArray voiceRows(){JSONArray result=new JSONArray();for(Voice voice:localVoices()){if(result.length()>=512)break;try{result.put(new JSONObject().put("id",voice.getName()).put("name",voice.getName()).put("language",voice.getLocale().toLanguageTag()).put("local",true));}catch(JSONException ignored){}}return result;}
    void voices(Consumer<JSONArray> done){
        if(destroyed){done.accept(new JSONArray());return;}initializeSpeech();if(speechReady){done.accept(voiceRows());return;}if(voiceWaiters.size()>=4){done.accept(new JSONArray());return;}
        voiceWaiters.add(done);main.postDelayed(()->{if(voiceWaiters.remove(done))done.accept(new JSONArray());},8000);
    }
    private Voice findVoice(String selected,NativeAudioContext.Capsule capsule)throws IOException{
        Voice fallback=null;for(Voice voice:localVoices())if(voice.getLocale().getLanguage().equals(capsule.sourceLanguage)){if(voice.getName().equals(selected))return voice;if(fallback==null)fallback=voice;}
        if(selected!=null||fallback==null)throw NativeAudioContext.invalid();return fallback;
    }
    private void focus()throws IOException{
        if(focusListener!=null)return;AudioManager manager=(AudioManager)app.getSystemService(Context.AUDIO_SERVICE);long version=generation;
        focusListener=change->main.post(()->{if(version==generation&&recording==null&&command!=null&&change!=AudioManager.AUDIOFOCUS_GAIN)context.suspend();});
        int result;
        if(android.os.Build.VERSION.SDK_INT>=26){focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_MEDIA).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build()).setOnAudioFocusChangeListener(focusListener,main).build();result=manager.requestAudioFocus(focus);}
        else result=manager.requestAudioFocus(focusListener,AudioManager.STREAM_MUSIC,AudioManager.AUDIOFOCUS_GAIN);
        if(result!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED)throw NativeAudioContext.invalid();
    }
    private void speak()throws Exception{
        if(!valid()||speech==null||!speechReady)throw NativeAudioContext.invalid();Voice selected=findVoice(voice,active);if(speech.setVoice(selected)!=TextToSpeech.SUCCESS||speech.setSpeechRate(speed)!=TextToSpeech.SUCCESS)throw NativeAudioContext.invalid();focus();ttsOffset=0;speakChunk();
    }
    private void speakChunk()throws Exception{
        String text=active.verses.get(index).text;int end=Math.min(text.length(),ttsOffset+TextToSpeech.getMaxSpeechInputLength());
        if(end<text.length()){if(Character.isHighSurrogate(text.charAt(end-1)))end--;int space=text.lastIndexOf(' ',end);if(space>ttsOffset+(end-ttsOffset)/2)end=space;}
        if(end<=ttsOffset)throw NativeAudioContext.invalid();final int next=end;String id=UUID.randomUUID().toString();utterance=id;
        android.os.Bundle values=new android.os.Bundle();values.putInt("versado-end",next);
        // Endpositie hoort bij deze ene utterance; alleen één chunk staat klaar.
        chunkEnd=next;if(speech.speak(text.substring(ttsOffset,end),TextToSpeech.QUEUE_FLUSH,values,id)!=TextToSpeech.SUCCESS)throw NativeAudioContext.invalid();
    }
    private int chunkEnd;
    private void speakNext()throws Exception{
        ttsOffset=chunkEnd;if(ttsOffset<active.verses.get(index).text.length()){speakChunk();return;}ttsOffset=0;if(index+1<active.verses.size()){index++;speakChunk();event(null,false,false);}else finish();
    }
}
