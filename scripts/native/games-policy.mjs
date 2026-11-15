import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {GAME_API_ROUTES} from '../../src/lib/native/gamesRoutes.ts';
import {GAME_PAGE_ROUTES} from '../../src/lib/native/gamesPagesRoutes.ts';
const begin='// BEGIN NATIVE GAMES POLICY',end='// END NATIVE GAMES POLICY';
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function pattern(row){return row.segments.map(part=>part.startsWith('[')?part==='[word]'?"[\\p{L}\\p{M}'’\\-]{1,64}":'[A-Za-z0-9_-]{1,128}':escape(part)).join('/');}
const apiRows=GAME_API_ROUTES.map(row=>({pattern:pattern(row),methods:row.methods.join(','),query:row.query.join(','),word:row.path==='dictionary/[word]'}));
const pageRows=GAME_PAGE_ROUTES.map(row=>({pattern:'/'+pattern(row),methods:'GET',query:row.query.join(','),word:false}));
const literal=JSON.stringify;
const audioBase="games/(?:reading/[A-Za-z0-9_-]{1,128}|MODE-(?:solo|live)/[A-Za-z0-9_-]{1,128}/(?:0|[1-9][0-9]?|[1-4][0-9]{2}))/audio/";
const audioPattern=stream=>"\\A"+audioBase.replace("MODE",stream?"intro":"(?:intro|ak)")+(stream?"[a-f0-9]{64}/stream":"playback")+"\\z";
export function swiftPolicy(){
 const rows=list=>list.map(row=>`        Rule(${literal(row.pattern)}, ${literal(row.methods)}, ${literal(row.query)}, ${row.word})`).join(',\n');
 return `${begin}\n// Gegenereerd uit de expliciete games-v1-grenzen; wijzigen via games-policy.mjs.\nenum NativeGamesPolicy {
    private struct Rule {
        let regex: NSRegularExpression, methods: Set<String>, query: Set<String>, word: Bool
        init(_ pattern: String, _ methods: String, _ query: String, _ word: Bool) {
            self.regex = try! NSRegularExpression(pattern: "\\\\A" + pattern + "\\\\z")
            self.methods = Set(methods.split(separator: ",").map(String.init))
            self.query = Set(query.split(separator: ",").map(String.init)); self.word = word
        }
        func matches(_ input: String, _ method: String, _ keys: Set<String>) -> Bool {
            guard methods.contains(method), keys.isSubset(of: query) else { return false }
            var value = input
            if word {
                let parts = input.split(separator: "/", omittingEmptySubsequences: false)
                guard parts.count == 2, parts[0] == "dictionary", let decoded = String(parts[1]).removingPercentEncoding else { return false }
                value = "dictionary/" + decoded
            }
            return regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
        }
    }
    private static let api: [Rule] = [\n${rows(apiRows)}\n    ]
    private static let pages: [Rule] = [\n${rows(pageRows)}\n    ]
    private static func clean(_ input: String, _ max: Int) -> Bool {
        input.utf8.count <= max && input.utf8.allSatisfy { $0 >= 33 && $0 <= 126 && $0 != 92 && $0 != 35 } && input.range(of: "%(?![0-9A-Fa-f]{2})", options: .regularExpression) == nil
    }
    private static func query(_ input: String) -> [URLQueryItem]? {
        guard let parts = URLComponents(string: "https://policy.invalid/" + input), parts.host == "policy.invalid", parts.fragment == nil else { return nil }
        let items = parts.queryItems ?? []
        guard Set(items.map { $0.name }).count == items.count else { return nil }
        return items
    }
    static func audioAllowed(_ path: String, _ stream: Bool) -> Bool {
        clean(path, 512) && path.range(of: stream ? ${literal(audioPattern(true))} : ${literal(audioPattern(false))}, options: .regularExpression) != nil
    }
    static func allows(_ path: String, _ method: String) -> Bool {
        guard clean(path, 8192), path.hasPrefix("games/"), let items = query(path) else { return false }
        if method == "GET", audioAllowed(path, false) { return true }
        let raw = String(path.dropFirst(6)).split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0]
        let keys = Set(items.map { $0.name })
        if raw == "page" { return method == "GET" && keys == Set(["route"]) && items.count == 1 && page(items[0].value ?? "") }
        if items.isEmpty {
            if method == "GET", String(raw).range(of: "\\\\Areading/[A-Za-z0-9_-]{1,128}/annotations(?:/[A-Za-z0-9_-]{1,128})?\\\\z", options: .regularExpression) != nil { return true }
            if method == "POST", String(raw).range(of: "\\\\Areading/[A-Za-z0-9_-]{1,128}/annotations\\\\z", options: .regularExpression) != nil { return true }
        }
        if raw == "list-order" {
            guard method == "GET" && items.count == 1 && items[0].name == "listKey" && items[0].value == "games" || method == "PUT" && items.isEmpty else { return false }
        }
        return api.contains { $0.matches(String(raw), method, keys) }
    }
    private static func page(_ href: String) -> Bool {
        guard clean(href, 4096), href.hasPrefix("/"), !href.hasPrefix("//"), !href.split(separator: "?", maxSplits: 1)[0].contains("%"), let items = query(String(href.dropFirst())) else { return false }
        let path = String(href.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0])
        if path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) { return false }
        for item in items {
            let values = ["view": ["leaderboard"], "availability": ["unavailable"], "resume": ["completed"], "mode": ["SOLO", "MATCH"], "cat": ["NO_HINTS", "WITH_HINTS"], "kompas": ["play"]]
            let value = item.value ?? ""
            if item.name == "tab", ["required", "continue", "waiting"].contains(item.value ?? "") { continue }
            if ["challengeId", "cursus"].contains(item.name) {
                guard value.range(of: "\\\\A[A-Za-z0-9_-]{1,128}\\\\z", options: .regularExpression) != nil else { return false }; continue
            }
            if item.name == "vers" { guard let number = Int(value), number >= 1, number <= 500, String(number) == value else { return false }; continue }
            if item.name == "returnTo" { guard value.hasPrefix("/mysteries/"), page(value) else { return false }; continue }
            guard let allowed = values[item.name], allowed.contains(value) else { return false }
        }
        return pages.contains { $0.matches(path, "GET", Set(items.map { $0.name })) }
    }
}\n${end}`;
}
export function javaPolicy(){
 const rows=list=>list.map(row=>`        new Rule(${literal(row.pattern)}, ${literal(row.methods)}, ${literal(row.query)}, ${row.word})`).join(',\n');
 return `${begin}\n// Gegenereerd uit de expliciete games-v1-grenzen; wijzigen via games-policy.mjs.\nfinal class NativeGamesPolicy {
    private static final class Rule {
        final java.util.regex.Pattern pattern;
        final java.util.List<String> methods, query;
        final boolean word;
        Rule(String pattern, String methods, String query, boolean word) {
            this.pattern = java.util.regex.Pattern.compile("\\\\A" + pattern + "\\\\z");
            this.methods = java.util.Arrays.asList(methods.split(","));
            this.query = query.isEmpty() ? java.util.Collections.emptyList() : java.util.Arrays.asList(query.split(",")); this.word = word;
        }
        boolean matches(String input, String method, java.util.Set<String> keys) {
            if (!methods.contains(method) || !query.containsAll(keys)) return false;
            String value = input;
            if (word) {
                String[] parts = input.split("/", -1);
                if (parts.length != 2 || !parts[0].equals("dictionary")) return false;
                try { value = "dictionary/" + java.net.URLDecoder.decode(parts[1], "UTF-8"); } catch (Exception error) { return false; }
            }
            return pattern.matcher(value).matches();
        }
    }
    private static final Rule[] API = {\n${rows(apiRows)}\n    };
    private static final Rule[] PAGES = {\n${rows(pageRows)}\n    };
    private static boolean clean(String input, int max) {
        if (input == null || input.length() > max) return false;
        for (int i = 0; i < input.length(); i++) { int ch = input.charAt(i); if (ch < 33 || ch > 126 || ch == 92 || ch == 35) return false; }
        return !java.util.regex.Pattern.compile("%(?![0-9A-Fa-f]{2})").matcher(input).find();
    }
    private static java.util.Map<String,String> query(String input) throws Exception {
        java.net.URI uri = new java.net.URI("https://policy.invalid/" + input);
        if (!"policy.invalid".equals(uri.getHost()) || uri.getFragment() != null) throw new Exception();
        java.util.Map<String,String> result = new java.util.HashMap<>();
        if (uri.getRawQuery() != null && !uri.getRawQuery().isEmpty()) for (String pair : uri.getRawQuery().split("&", -1)) {
            if (pair.isEmpty()) continue;
            String[] parts = pair.split("=", 2);
            String key = java.net.URLDecoder.decode(parts[0], "UTF-8"), value = parts.length > 1 ? java.net.URLDecoder.decode(parts[1], "UTF-8") : "";
            if (result.containsKey(key)) throw new Exception(); result.put(key, value);
        }
        return result;
    }
    static boolean audioAllowed(String path, boolean stream) {
        return clean(path, 512) && java.util.regex.Pattern.compile(stream ? ${literal(audioPattern(true))} : ${literal(audioPattern(false))}).matcher(path).matches();
    }
    static boolean allows(String path, String method) {
        if (!clean(path, 8192) || method == null || !path.startsWith("games/")) return false;
        try {
            if (method.equals("GET") && audioAllowed(path, false)) return true;
            java.util.Map<String,String> query = query(path);
            String raw = path.substring(6).split("\\\\?", 2)[0];
            if (raw.equals("page")) return method.equals("GET") && query.size() == 1 && query.containsKey("route") && page(query.get("route"));
            if (query.isEmpty() && (method.equals("GET") && raw.matches("reading/[A-Za-z0-9_-]{1,128}/annotations(?:/[A-Za-z0-9_-]{1,128})?") || method.equals("POST") && raw.matches("reading/[A-Za-z0-9_-]{1,128}/annotations"))) return true;
            if (raw.equals("list-order") && !(method.equals("GET") && query.size() == 1 && "games".equals(query.get("listKey")) || method.equals("PUT") && query.isEmpty())) return false;
            for (Rule rule : API) if (rule.matches(raw, method, query.keySet())) return true;
        } catch (Exception error) { return false; }
        return false;
    }
    private static boolean page(String href) {
        if (!clean(href, 4096) || !href.startsWith("/") || href.startsWith("//") || href.split("\\\\?", 2)[0].contains("%")) return false;
        try {
            String path = href.split("\\\\?", 2)[0];
            for (String part : path.split("/", -1)) if (part.equals(".") || part.equals("..")) return false;
            java.util.Map<String,String> query = query(href.substring(1));
            for (java.util.Map.Entry<String,String> item : query.entrySet()) {
                String key = item.getKey(), value = item.getValue();
                if (key.equals("kompas") && value.equals("play")) continue;
                if (key.equals("tab") && java.util.Arrays.asList("required","continue","waiting").contains(value)) continue;
                if ((key.equals("challengeId") || key.equals("cursus")) && value.matches("[A-Za-z0-9_-]{1,128}")) continue;
                if (key.equals("vers") && value.matches("(?:[1-9]|[1-9][0-9]|[1-4][0-9]{2}|500)")) continue;
                if (key.equals("returnTo") && value.startsWith("/mysteries/") && page(value)) continue;
                if (!(key.equals("view") && value.equals("leaderboard") || key.equals("availability") && value.equals("unavailable") || key.equals("resume") && value.equals("completed") || key.equals("mode") && (value.equals("SOLO") || value.equals("MATCH")) || key.equals("cat") && (value.equals("NO_HINTS") || value.equals("WITH_HINTS")))) return false;
            }
            for (Rule rule : PAGES) if (rule.matches(path, "GET", query.keySet())) return true;
        } catch (Exception error) { return false; }
        return false;
    }
}\n${end}`;
}
export function updatePolicy(original,generated){const start=original.indexOf(begin),finish=original.indexOf(end);if(start<0&&finish<0)return original.trimEnd()+'\n\n'+generated+'\n';if(start<0||finish<start)throw Error('Onvolledige policy-markers');return original.slice(0,start)+generated+original.slice(finish+end.length);}
export const GAME_POLICY_CASES = [
  ...['games/list-order','games/list-order?listKey=courses','games/list-order?listKey=today-continue'].map(path=>[path,'GET',false]),
  ['games/list-order?listKey=games','PUT',false],
  ['games/reading/chapter/annotations','GET',true],['games/reading/chapter/annotations/verse','GET',true],['games/reading/chapter/annotations','POST',true],
  ...['games/annotations?view=reader&chapterId=chapter','games/reading/chapter/annotations?user=B','games/reading/chapter/annotations/verse/extra'].map(path=>[path,'GET',false]),
  ['games/reading/chapter/annotations/verse','POST',false],['games/reading/chapter/annotations','PUT',false],

  ...['games/ak-solo/run/1/audio/playback','games/ak-live/ABCDE/12/audio/playback','games/reading/chapter/audio/playback','games/intro-solo/run/0/audio/playback','games/intro-live/ABCDE/14/audio/playback'].map(path=>[path,'GET',true]),
  ...['games/ak-solo/run/1/audio/'+ 'a'.repeat(64)+'/stream','games/reading/chapter/audio/'+ 'a'.repeat(64)+'/stream','games/intro-solo/run/01/audio/playback','games/intro-live/ABCDE/500/audio/playback','games/reading/chapter/audio/playback?token=x','games/reading/chapter/audio/../../playback'].map(path=>[path,'GET',false]),
  ['games/reading/chapter/audio/playback','POST',false],
  ['games/reading/chapter/audio/playback','HEAD',false],
  ...GAME_API_ROUTES.flatMap(row=>row.methods.map(method=>['games/'+row.path.replace(/\[[A-Za-z]+\]/g,'synthetic')+(row.path==='list-order'&&method==='GET'?'?listKey=games':''),method,true])),
  ...GAME_PAGE_ROUTES.map(row=>['games/page?route='+encodeURIComponent(row.path.replace(/\[[A-Za-z]+\]/g,'synthetic')),'GET',true]),
  ['games/page?route=%2Flive%3Fkompas%3Dplay','GET',true],
  ['games/page?route=%2Flive%3Fkompas%3Dadmin','GET',false],
  ['games/page?route=%2Facties%3Ftab%3Dcontinue','GET',true],
  ['games/page?route=%2Facties%3Ftab%3Dforeign','GET',false],
  ['games/page?route=%2Fsnelle-zendeling%3Fview%3Dleaderboard','GET',true],
  ['games/page?route=%2Flive%3Favailability%3Dunavailable','GET',true],
  ['games/page?route=%2Fmysteries%2F001a%2Fplay%3Fresume%3Dcompleted','GET',true],
  ['games/dictionary/%C3%89CRIT','GET',true],
  ['games/users/search?q=Jan%2342','GET',true],
  ...['games/page','games/page?route=%2Fadminbackend','games/page?route=%2Flive&route=%2Fword-game','games/page?route=https%3A%2F%2Fevil.invalid','games/page?route=%2Flive%3Ftoken%3Dx','games/admin/users','games/auth/login','games/../profile','games/%2e%2e/profile','games/word-game?token=synthetic','games/word-game?url=https://evil.invalid','games/users/search?q=a&q=b','games/dictionary/%2Fadmin','games/dictionary/%252Fadmin','games/word-game#x','games/word-game\n','games/users/search?q=%ZZ'].map(path=>[path,'GET',false]),
  ['games/word-game','DELETE',false],['games/page?route=%2Flive','POST',false],
];
export function swiftCases(){return '// BEGIN GAME REQUEST CASES\nprivate func verifyNativeGamesPolicy() {\n    let cases: [(String, String, Bool)] = [\n'+GAME_POLICY_CASES.map(([path,method,allowed])=>'        ('+literal(path)+', '+literal(method)+', '+allowed+')').join(',\n')+'\n    ]\n    for (path, method, expected) in cases { if NativeAccessPolicy.routeAllowed(path, method) != expected { fatalError("Spelpolicy verschilt voor " + method + " " + path) } }\n}\n// END GAME REQUEST CASES';}
export function javaCases(){return '    // BEGIN GAME REQUEST CASES\n    @Test public void explicitGamesPolicyMatchesTheSharedBoundary() {\n'+GAME_POLICY_CASES.map(([path,method,allowed])=>'        assertEquals('+allowed+', NativeAccessTransport.routeAllowed('+literal(path)+', '+literal(method)+'));').join('\n')+'\n    }\n    // END GAME REQUEST CASES';}
function updateCases(original,generated,java){const a=original.indexOf('// BEGIN GAME REQUEST CASES'),b=original.indexOf('// END GAME REQUEST CASES');if(a>=0&&b>a)return original.slice(0,a-(java?4:0))+generated+original.slice(b+'// END GAME REQUEST CASES'.length);if(a>=0||b>=0)throw Error('Onvolledige spelpolicyproeven');if(java){const i=original.lastIndexOf('\n}');if(i<0)throw Error('Java-testklasse ontbreekt');return original.slice(0,i)+'\n'+generated+original.slice(i);}return original.trimEnd()+'\n\n'+generated+'\n';}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv.includes('--write')&&!process.argv.includes('--check'))throw Error('Kies --write of --check');
 for(const [path,render]of [['ios/App/App/NativeAccessTransport.swift',swiftPolicy],['android/app/src/main/java/app/versado/app/NativeAccessTransport.java',javaPolicy]]){
  const original=readFileSync(path,'utf8'),updated=updatePolicy(original,render());
  if(process.argv.includes('--write'))writeFileSync(path,updated);else if(original!==updated)throw Error('Native spelpolicy verouderd: '+path);
 }
 for(const [path,render,java] of [['tests/native-access-policy.swift',swiftCases,false],['android/app/src/test/java/app/versado/app/NativeAccessTransportTest.java',javaCases,true]]) {
  const original=readFileSync(path,'utf8'),updated=updateCases(original,render(),java);
  if(process.argv.includes('--write'))writeFileSync(path,updated);else if(original!==updated)throw Error('Native spelpolicyproeven verouderd: '+path);
 }

}
