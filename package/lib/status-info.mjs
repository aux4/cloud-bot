import fs from "node:fs";
import { configuredAgentMachine } from "./agent-config.mjs";
import { spawnSync } from "node:child_process";
const e = process.env;
const agentMachine = configuredAgentMachine();
const read = path => { try { return fs.readFileSync(path, "utf8").trim(); } catch { return ""; } };
const packageVersions = {};
for (const name of ["cloud-bot", "bot", "bot-meta", "bot-chat", "queue", "repository", "cloud"]) {
  try { packageVersions[name] = JSON.parse(fs.readFileSync(new URL(`../../${name}/.aux4`, import.meta.url), "utf8")).version; } catch { /* Optional diagnostic only. */ }
}
const count = spawnSync("aux4", ["repository", "count", "whatsapp_bot_inbox_messages", "--db", "cloud"], {encoding:"utf8", timeout:10000, maxBuffer:65536});
let queueCount;
try { const value = JSON.parse(count.stdout); if (Number.isSafeInteger(value) && value >= 0) queueCount = value; } catch { /* Never expose raw command errors or message bodies. */ }
const queueDiagnostics = {exitCode:count.status, count:queueCount};
const capabilityLog = read("/tmp/capability-log").split("\n").filter(line => /^\[capabilities\] [a-z:]+: (credentials (cached|issued) \(expire [0-9TZ:.-]+\)|credential exchange failed \(HTTP [0-9]+\)|skipped: verified caller required)$/.test(line));
let exchangeProbe;
if (!e.TURSO_DATABASE_URL && e.CLOUD_SYNC_TOKEN && e.AUX4_CLOUD_API_URL && e.AUX4_CLOUD_SCOPE) {
  try {
    const response = await fetch(`${e.AUX4_CLOUD_API_URL}/v1/${encodeURIComponent(e.AUX4_CLOUD_SCOPE)}/capabilities/turso:database/credentials`, {method:"POST", headers:{"X-Api-Key":e.CLOUD_SYNC_TOKEN,"Content-Type":"application/json"},body:"{}",signal:AbortSignal.timeout(25000)});
    const result = await response.json();
    const known = ["Failed to read the turso platform credential", "The turso platform credential is not configured", "Failed to provision the turso database for this scope", "Failed to issue a turso database token", "Forbidden", "Machine authentication required"];
    exchangeProbe = {status:response.status, error:known.includes(result.error) ? result.error : undefined, databaseTokenLength:(result.env?.TURSO_AUTH_TOKEN || "").length};
  } catch { exchangeProbe = {error:"Capability probe unavailable"}; }
}
console.log(JSON.stringify({packageVersions, queueDiagnostics, agentMachine, replyMode:agentMachine ? "callback" : "stdout", machine:e.AUX4_CLOUD_MACHINE || "", capabilities:(e.AUX4_CLOUD_CAPABILITIES || "").split(",").filter(Boolean), databaseUrl:e.TURSO_DATABASE_URL || "", databaseTokenLength:(e.TURSO_AUTH_TOKEN || "").length, capabilityDiagnostics:{exchangeProbe,apiUrl:e.AUX4_CLOUD_API_URL || "", machineKeyLength:(e.CLOUD_SYNC_TOKEN || "").length, resolverPresent:fs.existsSync("/var/task/aux4/resolve-capabilities.sh"), principalStatus:["ok","none","invalid"].includes(read("/tmp/principal-status")) ? read("/tmp/principal-status") : "unknown", log:capabilityLog}}));
