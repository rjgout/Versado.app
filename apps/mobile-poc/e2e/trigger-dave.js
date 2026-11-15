// Draait in Maestro (host): laat de tweede client (Dave) nu een vriendenverzoek sturen.
var res = http.get('http://127.0.0.1:3199/dave');
if (!res.ok) { throw new Error('trigger mislukt: ' + res.status); }
