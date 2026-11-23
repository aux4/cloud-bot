import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { configuredAgentMachine } from "./agent-config.mjs";

const INPUT_LIMIT = 65536;
const OUTPUT_LIMIT = 131072;
const OPERATIONS = Object.freeze(["action", "update", "return"]);
const FAILURE = "Artifact operation could not be completed. Reload before trying again.";
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Invalid artifact request");
}

export function verifyArtifactEnvelope(raw, secret, now = Date.now()) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > INPUT_LIMIT) throw new Error("Invalid artifact request");
  const envelope = JSON.parse(raw);
  keys(envelope, ["version", "timestamp", "payload", "signature"]);
  if (envelope.version !== 1 || typeof envelope.timestamp !== "string" || !/^\d{10,12}$/.test(envelope.timestamp)
      || typeof envelope.payload !== "string" || !/^sha256=[a-f0-9]{64}$/.test(envelope.signature || "")
      || typeof secret !== "string" || secret.length < 32
      || Math.abs(now / 1000 - Number(envelope.timestamp)) > 300) throw new Error("Invalid artifact authorization");
  const expected = createHmac("sha256", secret).update(`${envelope.timestamp}.${envelope.payload}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(envelope.signature.slice(7), "hex"))) throw new Error("Invalid artifact authorization");
  const request = JSON.parse(envelope.payload);
  keys(request, ["operation", "input"]);
  if (!OPERATIONS.includes(request.operation)) throw new Error("Invalid artifact operation");
  const input = request.input;
  const allowed = ["artifactId", "ref", "conversationId", ...(request.operation === "return" ? [] : ["revision", "state"]), ...(request.operation === "action" ? ["action"] : [])];
  keys(input, allowed);
  if (typeof input.artifactId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/:~-]{0,511}$/.test(input.artifactId)
      || (input.ref !== undefined && (typeof input.ref !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/:~-]{0,511}$/.test(input.ref)))
      || typeof input.conversationId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.conversationId)) throw new Error("Invalid artifact locator");
  if (request.operation !== "return" && (!Number.isSafeInteger(input.revision) || input.revision < 1 || !object(input.state))) throw new Error("Invalid artifact state");
  if (request.operation === "action" && (typeof input.action !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/:~-]{0,127}$/.test(input.action))) throw new Error("Invalid artifact action");
  return request;
}

export function artifactRequest(request, machine) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(machine || "")) throw new Error("Invalid configured agent machine");
  return { args: ["cloud", machine, "room-artifact"], body: { operation: request.operation, input: request.input } };
}

// Only exact, known pre-mutation CAS failures allow the caller to reconcile.
// Timeouts, process failures and backend errors can have committed side effects.
function revisionMismatch(detail) {
  return /^(?:artifact-action: artifact revision changed; reload and try again|artifact: artifact [A-Za-z0-9._/:~-]+ changed from revision \d+ to \d+; re-read before updating)\s*$/m.test(detail);
}

function resultView(code, stdout, stderr) {
  if (code !== 0) {
    const mismatch = revisionMismatch(`${stdout}\n${stderr}`);
    return { code: Number.isInteger(code) && code > 0 ? code : 1, output: mismatch ? "Artifact revision changed; reload and try again." : FAILURE, ...(mismatch ? { revisionMismatch: true } : {}) };
  }
  let output;
  try {
    const wire = JSON.parse(stdout);
    if (!object(wire) || Object.keys(wire).length !== 1 || !Object.hasOwn(wire, "roomArtifactResult") || !object(wire.roomArtifactResult)) throw new Error();
    output = JSON.stringify(wire.roomArtifactResult);
  } catch { return { code: 1, output: FAILURE }; }
  if (Buffer.byteLength(output) > OUTPUT_LIMIT) return { code: 1, output: FAILURE };
  return { code: 0, output };
}

export async function dispatchArtifact(raw, env = process.env, { timeoutMs = 18000 } = {}) {
  const request = verifyArtifactEnvelope(raw, env.CHAT_BOT_SIGNING_SECRET);
  if (!String(env.CLOUD_SYNC_TOKEN || "").trim()) throw new Error("Machine identity is required");
  const childEnv = { ...env, AUX4_NO_DAEMON: "1" };
  delete childEnv.AUX4_ACCESS_TOKEN;
  const transport = artifactRequest(request, configuredAgentMachine(childEnv));
  return new Promise(resolve => {
    const child = spawn("aux4", transport.args, { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0, finished = false;
    const finish = value => { if (!finished) { finished = true; clearTimeout(timer); resolve(value); } };
    const stop = () => { finish({ code: 1, output: FAILURE }); child.kill("SIGKILL"); };
    const timer = setTimeout(stop, Math.min(18000, Math.max(1, timeoutMs)));
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { bytes += Buffer.byteLength(chunk); if (bytes > 1048576) stop(); else stdout += chunk; });
    child.stderr.on("data", chunk => { if (Buffer.byteLength(stderr) < 16384) stderr += chunk.toString().slice(0, 16384); });
    child.once("error", () => finish({ code: 1, output: FAILURE }));
    child.once("close", code => finish(resultView(code, stdout, stderr)));
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(transport.body));
  });
}

async function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > INPUT_LIMIT) throw new Error("Invalid artifact request");
  }
  // `aux4 cloud` unwraps reserved output/body fields on both legacy /run and
  // raw Function URL responses. Keep the application result under its own key
  // so both transports preserve the same code/output contract for Chat.
  process.stdout.write(`${JSON.stringify({ artifactResult: await dispatchArtifact(raw) })}\n`);
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch(() => { process.stderr.write("Artifact request could not be processed\n"); process.exitCode = 1; });
}
