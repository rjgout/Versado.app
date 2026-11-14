import Foundation
private func encoded(_ value: [String:Any]) throws -> String {
    try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]).base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")
}
private func token(_ nonce:String, expiry:Int=1700000300) throws -> String {
    "e30." + (try encoded(["userId":"user","sid":"11111111-1111-4111-8111-111111111111","version":0,"purpose":"native-access","iss":"versado-native-v1","aud":"versado-native-v1","exp":expiry,"nonce":nonce])) + ".synthetic"
}
private func pair(_ identity:String, expiry:Int=1700000300) throws -> String {
    String(data:try JSONSerialization.data(withJSONObject:["accessToken":try token(identity,expiry:expiry),"refreshToken":identity,"expiresIn":300]),encoding:.utf8)!
}
private func stored(_ refresh:String) -> String { "{\"refreshToken\":\"\(refresh)\"}" }
@main struct NativeAudioContextTests {
 static func main() throws {
    let stableToken=try token("one"), repeatedToken=try token("one"); precondition(stableToken==repeatedToken,"Synthetische JWT moet deterministisch zijn")
    let stamp="22222222-2222-4222-8222-222222222222", body=try String(contentsOfFile:CommandLine.arguments[1],encoding:.utf8)
    let scope=try JSONDecoder().decode(NativeAudioPlaybackPayload.self,from:Data(body.utf8)).reader.scope
    let credentials=try NativeAccessCredentials(id:"synthetic-client-id",secret:"synthetic-native-audio-secret-123456")
    var now:TimeInterval=0
    let c=NativeAudioContext(clock:{now})
    c.reset(stamp);c.stage(path:"login",status:200,body:try pair("new"),tag:c.tag(stamp));precondition(!c.anchored)
    c.saved(stored("wrong"),success:true);precondition(!c.anchored)
    c.saved(stored("old"),success:false);c.storedClear();c.saved(stored("new"),success:true);precondition(c.anchored)
    c.reset(stamp);c.stage(path:"login",status:200,body:try pair("new"),tag:c.tag(stamp));c.saved(stored("new"),success:false);c.saved(stored("new"),success:true);precondition(!c.anchored)
    let old=c.tag(stamp);c.reset(stamp);c.stage(path:"login",status:200,body:try pair("old"),tag:old);c.saved(stored("old"),success:true);precondition(!c.anchored)
    c.stage(path:"login",status:200,body:try pair("new"),tag:c.tag(stamp));c.setForeground(false);c.setForeground(true);c.saved(stored("new"),success:true);precondition(!c.anchored)
    c.stage(path:"login",status:200,body:try pair("one"),tag:c.tag(stamp));c.saved(stored("one"),success:true);c.select(scope,owner:"owner")
    let tag=c.tag(stamp)
    let wrong=try c.capture(path:scope.path,status:200,body:body,authorization:"Bearer "+token("other"),credentials:credentials,tag:tag,startedAt:0);precondition(!wrong)
    let valid=try c.capture(path:scope.path,status:200,body:body,authorization:"Bearer "+token("one"),credentials:credentials,tag:tag,startedAt:0);precondition(valid&&c.capsule!.remaining==297)
    let direct=try c.capture(path:scope.path,status:200,body:body,authorization:"Bearer "+token("one"),credentials:nil,tag:tag,startedAt:0)
    precondition(direct && c.capsule!.credentials == nil && c.capsule!.remaining == 297)
    now=297.001;precondition(!c.capsule!.lifetime.current)
    do { _ = try c.capture(path:scope.path,status:200,body:body,authorization:"Bearer "+token("one"),credentials:credentials,tag:c.tag(stamp),startedAt:0);fatalError("Vertraagde autorisatie mag deadline niet verlengen") } catch is NativeAudioFailure {}
    c.select(nil);let late=try c.capture(path:scope.path,status:200,body:body,authorization:"Bearer "+token("one"),credentials:credentials,tag:tag,startedAt:0);precondition(!late)
    c.select(scope,owner:"new-owner");c.stage(path:"refresh",status:200,body:try pair("two"),tag:c.tag(stamp));c.saved(stored("two"),success:true)
    let oldToken=try c.capture(path:scope.path,status:200,body:body,authorization:"Bearer "+token("one"),credentials:credentials,tag:c.tag(stamp),startedAt:now);precondition(!oldToken)
    now=0;c.reset(stamp);c.stage(path:"login",status:200,body:try pair("first"),tag:c.tag(stamp));c.saved(stored("first"),success:true);c.select(scope,owner:"owner")
    let initial=try c.capture(path:scope.path,status:200,body:body,authorization:"Bearer "+token("first"),credentials:credentials,tag:c.tag(stamp),startedAt:0);precondition(initial)
    let oldCapsule=c.capsule!;now=241
    var updated=try JSONSerialization.jsonObject(with:Data(body.utf8)) as! [String:Any]
    var updatedAudio=updated["audio"] as! [String:Any];updatedAudio["serverTime"]=1700000241000 as Int64;updated["audio"]=updatedAudio
    let freshBody=String(data:try JSONSerialization.data(withJSONObject:updated),encoding:.utf8)!
    c.stage(path:"refresh",status:200,body:try pair("second",expiry:1700000541),tag:c.tag(stamp));c.saved(stored("second"),success:true)
    let renewed=try c.capture(path:scope.path,status:200,body:freshBody,authorization:"Bearer "+token("second",expiry:1700000541),credentials:credentials,tag:c.tag(stamp),startedAt:now);precondition(renewed&&c.capsule!.remaining==297)
    now=301;precondition(!oldCapsule.lifetime.current&&c.capsule!.lifetime.current)
    now=539;precondition(!c.capsule!.lifetime.current)
    print("Native audio context: secure-storage commit, epoch, scope, old token, background and hard expiry PASS")
 }
}
