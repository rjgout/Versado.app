package app.versado.app;

import java.io.IOException;
import java.util.*;
import java.util.function.LongSupplier;
import org.json.*;
import okio.ByteString;

/** Native geheugenprojectie van de bestaande sessie; geen setter voor tokens,
 * tweede sessieopslag, bestandscache of autorisatie vanuit JavaScript. De
 * eigenaarqueue beheert state; alleen de onveranderlijke requesttag is volatile. */
final class NativeAudioContext {
    static IOException invalid() { return new IOException("audio_context_unavailable"); }
    static boolean id(String value) { return value != null && value.matches("[A-Za-z0-9_-]{1,128}"); }
    static boolean hash(String value) { return value != null && value.matches("[a-f0-9]{64}"); }
    static boolean language(String value) { return Arrays.asList("nl","en","de","fr","es").contains(value); }
    static long integer(JSONObject object, String key, long min, long max) throws Exception {
        Object value = object.get(key);
        if (!(value instanceof Number)) throw invalid();
        Number number = (Number) value; long result = number.longValue();
        if (!Double.isFinite(number.doubleValue()) || number.doubleValue() != result || result < min || result > max) throw invalid();
        return result;
    }
    static double seconds(JSONObject object, String key) throws Exception {
        Object value = object.get(key); if (!(value instanceof Number)) throw invalid();
        double result = ((Number) value).doubleValue(); if (!Double.isFinite(result) || result < 0) throw invalid(); return result;
    }
    static final class Scope {
        final String user, collection, language, course, kind, target, chapter;
        final long selection; final int start, end;
        Scope(JSONObject value) throws Exception {
            if (integer(value,"version",1,1) != 1) throw invalid();
            user=value.getString("userId"); collection=value.getString("activeCollectionId"); language=value.getString("language");
            course=value.getString("courseId"); kind=value.getString("kind"); target=value.getString("targetId"); chapter=value.getString("chapterId");
            selection=integer(value,"selectionVersion",0,9007199254740991L); start=(int)integer(value,"startVerse",1,500); end=(int)integer(value,"endVerse",start,500);
            if (!id(user)||!id(collection)||!id(course)||!id(target)||!id(chapter)||!NativeAudioContext.language(language)||!("steps".equals(kind)||"chapters".equals(kind))) throw invalid();
        }
        String path() { return "courses/"+course+"/read/"+kind+"/"+target+"/audio/playback"; }
        String key() { return String.join("\u0000",user,collection,language,course,kind,target,chapter,Long.toString(selection),Integer.toString(start),Integer.toString(end)); }
        boolean same(Scope other) { return other != null && key().equals(other.key()); }
    }
    static final class Verse {
        final String id, text; final int number;
        Verse(JSONObject value, int expected) throws Exception {
            id=value.getString("id"); text=value.getString("text"); number=(int)integer(value,"number",expected,expected);
            if (!NativeAudioContext.id(id)||text.isEmpty()||text.length()>20000) throw invalid();
        }
    }
    static final class Segment {
        final int number; final double start; final Double end;
        Segment(JSONObject value, int expected) throws Exception {
            number=(int)integer(value,"number",expected,expected); start=seconds(value,"start"); end=value.isNull("end")?null:seconds(value,"end");
            if (end!=null&&end<=start) throw invalid();
        }
    }
    static final class Recording {
        final String id, language, fallbackFor; final long size; final double start; final Double end; final List<Segment> verses=new ArrayList<>();
        Recording(JSONObject value, Scope scope) throws Exception {
            id=value.getString("id");language=value.getString("language");fallbackFor=value.has("fallbackFor")?value.getString("fallbackFor"):null;
            if (!hash(id)||!hash(value.getString("sha256"))||!NativeAudioContext.language(language)||!NativeAudioContext.id(value.getString("audioChapterId"))||!NativeAudioContext.id(value.getString("collectionId"))||!Arrays.asList("legacy","recording").contains(value.getString("kind"))||fallbackFor!=null&&!hash(fallbackFor))throw invalid();
            size=integer(value,"byteSize",1,256L*1024*1024);start=seconds(value,"start");end=value.isNull("end")?null:seconds(value,"end");
            JSONArray rows=value.getJSONArray("verses"); if(rows.length()!=scope.end-scope.start+1)throw invalid();
            for(int i=0;i<rows.length();i++) { Segment verse=new Segment(rows.getJSONObject(i),scope.start+i); if(i>0&&(verses.get(i-1).end==null||verses.get(i-1).end>verse.start))throw invalid();verses.add(verse); }
            if(start!=verses.get(0).start||!Objects.equals(end,verses.get(verses.size()-1).end))throw invalid();
        }
    }
    static final class Claims {
        final String user,sid,token; final long version; final double expiry;
        Claims(String token) throws Exception {
            this.token=token;String[] parts=token.split("\\.",-1);if(token.length()>2048||parts.length!=3)throw invalid();
            ByteString bytes=ByteString.decodeBase64(parts[1]);if(bytes==null)throw invalid();JSONObject value=new JSONObject(bytes.utf8());
            user=value.getString("userId");sid=value.getString("sid");version=integer(value,"version",0,9007199254740991L);expiry=seconds(value,"exp");
            if(!id(user)||!id(sid)||!"native-access".equals(value.getString("purpose"))||!"versado-native-v1".equals(value.getString("iss"))||!"versado-native-v1".equals(value.getString("aud")))throw invalid();
            UUID.fromString(sid);
        }
        boolean sameSession(Claims other){return user.equals(other.user)&&sid.equals(other.sid)&&version==other.version;}
    }
    static final class Capsule {
        final Scope scope; final String readerHash,sourceLanguage,title; final List<Verse> verses=new ArrayList<>(); final List<Recording> sources=new ArrayList<>();
        final Claims claims;final NativeAccessTransport.Credentials credentials;final NativeAudioTransport.Lifetime lifetime;final long startedAt,validFor;private final LongSupplier clock;
        long remaining(){return Math.max(0,validFor-(clock.getAsLong()-startedAt)/1000000);}
        Capsule(String body,Claims claims,NativeAccessTransport.Credentials credentials,long started,LongSupplier clock) throws Exception {
            if(body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>1048576)throw invalid();JSONObject value=new JSONObject(body);integer(value,"version",1,1);
            JSONObject audio=value.getJSONObject("audio"),reader=value.getJSONObject("reader");scope=new Scope(audio);if(!scope.same(new Scope(reader)))throw invalid();
            readerHash=audio.getString("readerHash");sourceLanguage=audio.getString("sourceLanguage");
            if(!hash(readerHash)||!language(sourceLanguage)||!sourceLanguage.equals(reader.getString("sourceLanguage"))||!claims.user.equals(scope.user)||!claims.sid.equals(audio.getString("sessionId")))throw invalid();
            integer(audio,"maxAgeMs",300000,300000);long serverTime=integer(audio,"serverTime",1,9007199254740991L);
            String book=reader.getString("bookName");if(book.isEmpty()||book.length()>256)throw invalid();title=book+" "+integer(reader,"chapterNumber",1,Integer.MAX_VALUE);
            JSONArray text=reader.getJSONArray("verses");if(text.length()!=scope.end-scope.start+1)throw invalid();Set<String> ids=new HashSet<>();
            for(int i=0;i<text.length();i++){Verse verse=new Verse(text.getJSONObject(i),scope.start+i);if(!ids.add(verse.id))throw invalid();verses.add(verse);}
            JSONArray recordings=audio.getJSONArray("sources");if(recordings.length()>10)throw invalid();ids.clear();
            for(int i=0;i<recordings.length();i++){Recording recording=new Recording(recordings.getJSONObject(i),scope);if(!ids.add(recording.id))throw invalid();sources.add(recording);}
            this.clock=clock;this.claims=claims;this.credentials=credentials;this.startedAt=clock.getAsLong();
            validFor=(long)(Math.min(300000,claims.expiry*1000-serverTime)-Math.max(0,(this.startedAt-started)/1000000)-3000);
            if(validFor<=1000)throw invalid();lifetime=new NativeAudioTransport.Lifetime(validFor,clock);
        }
        String sourceIds(){StringBuilder result=new StringBuilder();for(Recording recording:sources)result.append(recording.id).append(':');return result.toString();}
        Recording recording(String id)throws IOException{for(Recording source:sources)if(source.id.equals(id))return source;throw invalid();}
        NativeAudioTransport transport(String sourceId)throws IOException{return new NativeAudioTransport(scope.path().replace("/audio/playback","/audio/"+sourceId+"/stream"),recording(sourceId).size,"Bearer "+claims.token,credentials,"https://localhost",lifetime);}
    }
    static final class Tag { final String stamp;final long session,context;Tag(String stamp,long session,long context){this.stamp=stamp;this.session=session;this.context=context;} }
    private static final class Pending { final Claims claims;final String refreshHash;final Tag tag;Pending(Claims claims,String refresh,Tag tag) throws Exception {this.claims=claims;this.refreshHash=refreshHash(refresh);this.tag=tag;} }
    private static String refreshHash(String value) throws Exception { return ByteString.of(java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8))).hex(); }
    private String stamp,owner;private boolean foreground=true;private long sessionEpoch,contextEpoch;private volatile Tag marker=new Tag(null,0,0);
    private Pending pending;private Claims anchor;private Scope expected;private Capsule capsule;
    private final LongSupplier clock;Runnable onInvalidated=()->{};
    NativeAudioContext(){this(android.os.SystemClock::elapsedRealtimeNanos);}
    NativeAudioContext(LongSupplier clock){this.clock=clock;}
    private void mark(){marker=new Tag(stamp,sessionEpoch,contextEpoch);}
    Tag tag(String stamp){Tag current=marker;return stamp!=null&&stamp.equals(current.stamp)?current:null;}
    private boolean current(Tag tag){return tag!=null&&Objects.equals(tag.stamp,stamp)&&tag.session==sessionEpoch;}
    boolean anchored(){return anchor!=null;}
    long epoch(){return contextEpoch;}Capsule capsule(){return capsule;}
    void reset(String stamp){sessionEpoch++;pending=null;anchor=null;this.stamp=stamp;select(null);}
    void select(Scope scope){select(scope,null);}
    void select(Scope scope,String owner){if(scope!=null&&scope.same(expected)&&Objects.equals(owner,this.owner))return;this.owner=owner;expected=scope;invalidate();}
    String owner(){return owner;}
    void forget(String owner){if(Objects.equals(owner,this.owner))select(null);}
    void invalidate(){contextEpoch++;mark();if(capsule!=null)capsule.lifetime.invalidate();capsule=null;onInvalidated.run();}
    boolean foreground(){return foreground;}
    void setForeground(boolean active){if(foreground==active)return;foreground=active;suspend();}
    void accessFailed(Tag tag){if(current(tag))suspend();}
    void suspend(){sessionEpoch++;pending=null;invalidate();}
    void stage(String path,int status,String body,Tag tag){
        if(!foreground||!current(tag)||status!=200||!Arrays.asList("login","refresh","apple/complete","security-setup/complete").contains(path))return;
        try {JSONObject value=new JSONObject(body);integer(value,"expiresIn",300,300);Claims claims=new Claims(value.getString("accessToken"));String refresh=value.getString("refreshToken");if(refresh.isEmpty()||refresh.length()>128)throw invalid();pending=new Pending(claims,refresh,tag);}catch(Exception ignored){}
    }
    void storedClear(){anchor=null;select(null);}
    void saved(String raw,boolean success){
        if(!success){try{JSONObject failed=new JSONObject(raw);if(pending!=null&&pending.refreshHash.equals(refreshHash(failed.optString("refreshToken")))){pending=null;invalidate();}}catch(Exception ignored){}return;}
        try {JSONObject value=new JSONObject(raw);if(value.optBoolean("logoutPending",false)){storedClear();return;}
            Pending staged=pending;if(staged==null||!current(staged.tag)||!staged.refreshHash.equals(refreshHash(value.optString("refreshToken"))))return;
            if(anchor!=null&&!anchor.sameSession(staged.claims))select(null);anchor=staged.claims;pending=null;
        }catch(Exception ignored){pending=null;invalidate();}
    }
    boolean matchesStamp(String value){return value!=null&&Objects.equals(value,stamp);}
    void observed(String path,int status,String body,String authorization,Tag tag){
        if(!current(tag)||tag.context!=contextEpoch)return;
        if("refresh".equals(path)&&(status==400||status==401||status==403)){suspend();return;}
        if(expected==null||anchor==null||!("Bearer "+anchor.token).equals(authorization))return;
        try {JSONObject root=new JSONObject(body);
            if((status==401||status==403)&&Arrays.asList("session_expired","session_changed","web_security_setup_required").contains(root.optString("error"))){invalidate();return;}
            if("content-context".equals(path)&&status==200){JSONObject state=root.optJSONObject("state");if(state==null)state=root;JSONObject picker=state.optJSONObject("picker");if(picker!=null&&(!expected.collection.equals(picker.optString("activeCollectionId"))||expected.selection!=picker.optLong("selectionVersion",-1)))invalidate();}
            String readerPath=expected.path().replace("/audio/playback","");
            if(path.equals(readerPath)||path.equals(readerPath+"/resume")){
                if(status!=200){invalidate();return;}JSONObject reader=root.optJSONObject("reader");if(reader==null)reader=root;
                if(!expected.same(new Scope(reader))){invalidate();return;}
                if(capsule!=null){JSONArray verses=reader.getJSONArray("verses");if(!capsule.sourceLanguage.equals(reader.getString("sourceLanguage"))||verses.length()!=capsule.verses.size()){invalidate();return;}
                    for(int i=0;i<verses.length();i++)if(!capsule.verses.get(i).id.equals(verses.getJSONObject(i).getString("id"))||!capsule.verses.get(i).text.equals(verses.getJSONObject(i).getString("text"))){invalidate();return;}}
            }
        }catch(Exception ignored){if(path.equals(expected.path()))invalidate();}
    }
    boolean capture(String path,int status,String body,String authorization,NativeAccessTransport.Credentials credentials,Tag tag,long started)throws IOException{
        if(!foreground||!current(tag)||tag.context!=contextEpoch||expected==null||!expected.path().equals(path)||anchor==null||!("Bearer "+anchor.token).equals(authorization))return false;
        if(status!=200){invalidate();return false;}
        try {Capsule fresh=new Capsule(body,anchor,credentials,started,clock);if(!fresh.scope.same(expected))throw invalid();
            if(capsule!=null&&(!capsule.readerHash.equals(fresh.readerHash)||!capsule.sourceIds().equals(fresh.sourceIds()))){fresh.lifetime.invalidate();throw invalid();}
            capsule=fresh;return true;
        }catch(Exception ignored){invalidate();throw invalid();}
    }
}
