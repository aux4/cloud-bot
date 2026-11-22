# WhatsApp delivery using the cloud database

## a signed message gets one echo reply despite duplicate delivery

```timeout
90000
```

```execute
set -e
: "${TURSO_CLOUD_TEST_URL:?A local libSQL test endpoint is required}"
export TURSO_DATABASE_URL="$TURSO_CLOUD_TEST_URL"
export TURSO_AUTH_TOKEN="${TURSO_CLOUD_TEST_TOKEN:-}"
rm -f graph.ndjson
node fixtures/graph.mjs 18872 graph.ndjson >graph.log 2>&1 &
graphPid=$!
trap 'kill "$graphPid" 2>/dev/null || true; rm -f graph.ndjson graph.log envelope.json retry-brain-count' EXIT
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:18872/ >/dev/null 2>&1; then break; fi
  sleep 0.2
done
curl -fsS http://127.0.0.1:18872/ >/dev/null || { cat graph.log; exit 1; }
node --input-type=module -e '
import fs from "node:fs";
import crypto from "node:crypto";
const body = JSON.stringify({object:"whatsapp_business_account", entry:[{changes:[{value:{messages:[{from:"15551230001",id:"wamid.CLOUD."+crypto.randomUUID(),type:"text",text:{body:"hello"}}]}}]}]});
const signature = "sha256=" + crypto.createHmac("sha256", "test-app-secret").update(body).digest("hex");
fs.writeFileSync("envelope.json", JSON.stringify({method:"POST", headers:{"x-hub-signature-256":signature}, pathParameters:{channel:"whatsapp",bot:"whatsapp-bot"}, queryStringParameters:{},rawBody:body, body}));
'
WHATSAPP_TOKEN=test-token WHATSAPP_APP_SECRET=test-app-secret aux4 whatsapp --verifyToken test-verify-token --phoneNumberId PHONE123 --apiUrl http://127.0.0.1:18872 --db cloud <envelope.json
WHATSAPP_TOKEN=wrong-token WHATSAPP_APP_SECRET=wrong-secret aux4 whatsapp --token test-token --appSecret test-app-secret --verifyToken test-verify-token --phoneNumberId PHONE123 --apiUrl http://127.0.0.1:18872 --db cloud <envelope.json
node --input-type=module -e '
import fs from "node:fs";
import assert from "node:assert/strict";
const rows = fs.readFileSync("graph.ndjson", "utf8").trim().split("\n").map(JSON.parse).filter(r=>r.body.type === "text");
assert.equal(rows.length,1); assert.equal(rows[0].body.text.body,"you said: hello");
assert.equal(rows[0].body.to,"15551230001");
console.log("one reply: you said: hello");
'
WHATSAPP_TOKEN=test-token WHATSAPP_APP_SECRET=test-app-secret aux4 cloud-bot work --apiUrl http://127.0.0.1:18872 --db cloud
WHATSAPP_TOKEN=test-token WHATSAPP_APP_SECRET=test-app-secret node --input-type=module -e '
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
const cfg = JSON.parse(execFileSync("node", ["../lib/config.mjs", "whatsapp-bot", "PHONE123", "test-verify-token", "test-token", "test-app-secret", "http://127.0.0.1:18872", "", ""], {encoding:"utf8"}));
const body = JSON.stringify({object:"whatsapp_business_account",entry:[{changes:[{value:{messages:[{from:"15551230001",id:"wamid.RESUME."+crypto.randomUUID(),type:"text",text:{body:"resume me"}}]}}]}]});
const signature = "sha256="+crypto.createHmac("sha256","test-app-secret").update(body).digest("hex");
const envelope = {method:"POST",headers:{"x-hub-signature-256":signature},pathParameters:{channel:"whatsapp",bot:"whatsapp-bot"},rawBody:body};
const args = ["bot","ingest","--channels",JSON.stringify(cfg.channels),"--bots",JSON.stringify(cfg.bots),"--defaults","{}","--db","cloud","--queue",JSON.stringify({name:"whatsapp_bot_inbox",provider:"repository",db:"cloud",visibility:30,maxAttempts:5})];
assert.equal(JSON.parse(execFileSync("aux4",args,{input:JSON.stringify(envelope),encoding:"utf8"})).statusCode,200);
const work = () => JSON.parse(execFileSync("aux4",["cloud-bot","work","--apiUrl","http://127.0.0.1:18872","--db","cloud"],{encoding:"utf8"}));
const recovered = work();
assert.equal(recovered.processed,1);
assert.equal(recovered.exhausted,false);
assert.equal(work().processed,0);
const replies = fs.readFileSync("graph.ndjson","utf8").trim().split("\n").map(JSON.parse).filter(r=>r.body.type === "text");
assert.equal(replies.length,2);
assert.equal(replies[1].body.text.body,"you said: resume me");
console.log("queued message resumed once");
'
rm -f retry-brain-count
node --input-type=module -e '
import fs from "node:fs";
import crypto from "node:crypto";
const body = JSON.stringify({object:"whatsapp_business_account",entry:[{changes:[{value:{contacts:[{wa_id:"15551230001",profile:{name:"Ada"}}],messages:[{from:"15551230001",id:"wamid.RETRY."+crypto.randomUUID(),type:"text",text:{body:"retry me"}}]}}]}]});
const signature = "sha256="+crypto.createHmac("sha256","test-app-secret").update(body).digest("hex");
fs.writeFileSync("envelope.json",JSON.stringify({method:"POST",headers:{"x-hub-signature-256":signature},pathParameters:{channel:"whatsapp",bot:"whatsapp-bot"},rawBody:body}));
'
WHATSAPP_TOKEN=test-token WHATSAPP_APP_SECRET=test-app-secret aux4 whatsapp --brainCommand 'node fixtures/retry-brain.mjs' --retryDelay 0 --phoneNumberId PHONE123 --apiUrl http://127.0.0.1:18872 --db cloud <envelope.json
WHATSAPP_TOKEN=test-token WHATSAPP_APP_SECRET=test-app-secret aux4 whatsapp --brainCommand 'node fixtures/retry-brain.mjs' --retryDelay 0 --phoneNumberId PHONE123 --apiUrl http://127.0.0.1:18872 --db cloud <envelope.json
node --input-type=module -e '
import fs from "node:fs";
import assert from "node:assert/strict";
assert.equal(fs.readFileSync("retry-brain-count","utf8"),"2");
const replies = fs.readFileSync("graph.ndjson","utf8").trim().split("\n").map(JSON.parse).filter(r=>r.body.type==="text" && r.body.text.body==="you said: retry me");
assert.equal(replies.length,1);
console.log("transient failure recovered automatically; duplicate delivery produced no extra reply");
'
aux4 repository list --db cloud
```

```expect:partial
{"ok":true}
{"ok":true}
one reply: you said: hello
**queued message resumed once
**transient failure recovered automatically; duplicate delivery produced no extra reply
```
