import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { artifactRequest, dispatchArtifact, verifyArtifactEnvelope } from "../lib/chat-artifact.mjs";

const secret = "local-artifact-fixture-key-".repeat(2);
const conversationId = "123e4567-e89b-42d3-a456-426614174000";
const base = { artifactId: "bot/agent/list", ref: "list:groceries", conversationId };
const request = operation => ({ operation, input: { ...base, ...(operation === "return" ? {} : { revision: 2, state: { text: "$(false); --target attacker" } }), ...(operation === "action" ? { action: "add" } : {}) } });
function signed(value, timestamp = String(Math.floor(Date.now() / 1000))) {
  const payload = JSON.stringify(value);
  return JSON.stringify({ version: 1, timestamp, payload, signature: `sha256=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}` });
}

test("signature binds exact payload and timestamp within five minutes", () => {
  assert.deepEqual(verifyArtifactEnvelope(signed(request("action")), secret), request("action"));
  for (const raw of ["{}", "bad", "null", "[]", signed(request("action"), String(Math.floor(Date.now() / 1000) - 301)), signed(request("action"), String(Math.floor(Date.now() / 1000) + 301))]) {
    assert.throws(() => verifyArtifactEnvelope(raw, secret));
  }
  const tampered = JSON.parse(signed(request("action")));
  for (const change of [{ payload: tampered.payload + " " }, { signature: "sha256=00" }, { timestamp: "999999999999" }, { version: 2 }, { target: "attacker" }]) {
    assert.throws(() => verifyArtifactEnvelope(JSON.stringify({ ...tampered, ...change }), secret));
  }
  assert.throws(() => verifyArtifactEnvelope(signed(request("action")), "wrong-key".repeat(5)));
  assert.throws(() => verifyArtifactEnvelope(signed(request("action")), ""));
  assert.throws(() => verifyArtifactEnvelope("x".repeat(65537), secret));
});

test("only fixed operations and allowlisted typed input pass authorization", () => {
  const value = request("action");
  const invalid = [
    { ...value, target: "attacker" }, { ...value, command: "ask" }, { ...value, secret }, { ...value, operation: "toString" },
    ...[{ target: "attacker" }, { command: "ask" }, { token: "caller" }, { agentMachine: "attacker" }, { conversationId: "room:not-a-uuid" }, { revision: "2" }, { revision: 0 }, { state: [] }, { action: "--raw" }, { artifactId: "$(false)" }].map(patch => ({ ...value, input: { ...value.input, ...patch } })),
    { operation: "return", input: { ...base, state: {} } }, { operation: "update", input: { ...value.input } }
  ];
  for (const item of invalid) assert.throws(() => verifyArtifactEnvelope(signed(item), secret), JSON.stringify(item));
  for (const operation of ["action", "update", "return"]) {
    const input = request(operation);
    const verified = verifyArtifactEnvelope(signed(input), secret);
    const transport = artifactRequest(verified, "agent-pete");
    assert.deepEqual(transport.args, ["cloud", "agent-pete", "room-artifact"]);
    assert.deepEqual(transport.body, input);
    assert.equal(transport.body.input.conversationId, conversationId);
  }
  assert.throws(() => artifactRequest(value, "agent-pete --raw"));
});

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chat-artifact-"));
  const capture = path.join(root, "capture.json");
  await fs.writeFile(path.join(root, "aux4"), `#!/usr/bin/env node
const fs=require('node:fs');let raw='';process.stdin.on('data',x=>raw+=x);process.stdin.on('end',()=>{
 fs.writeFileSync(process.env.TEST_CAPTURE,JSON.stringify({args:process.argv.slice(2),body:JSON.parse(raw),hasBearer:Object.hasOwn(process.env,'AUX4_ACCESS_TOKEN'),machine:process.env.CLOUD_SYNC_TOKEN}));
 if(process.env.TEST_WAIT)return setTimeout(()=>{},2000);
 process.stdout.write(process.env.TEST_SIZE ? JSON.stringify({code:0,output:JSON.stringify({value:'x'.repeat(Number(process.env.TEST_SIZE))})}) : process.env.TEST_OUTPUT||JSON.stringify({code:0,output:JSON.stringify({artifact:{id:'bot/agent/list'},revision:3})}));
 process.stderr.write(process.env.TEST_ERROR||'');process.exitCode=Number(process.env.TEST_CODE||0);
});
`, { mode: 0o755 });
  try {
    await run({ ...process.env, PATH: root + path.delimiter + process.env.PATH, TEST_CAPTURE: capture, CHAT_BOT_SIGNING_SECRET: secret, CLOUD_SYNC_TOKEN: "local-machine-identity", AUX4_ACCESS_TOKEN: "viewer-must-never-cross", CLOUD_BOT_AGENT_MACHINE: "agent-pete" }, capture);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test("dispatch pins actual command, JSON stdin and bot identity for every operation", () => fixture(async (env, capture) => {
  for (const patch of [{ command: "ask" }, { target: "attacker" }, { operation: "room-artifact" }]) {
    await assert.rejects(dispatchArtifact(signed({ ...request("action"), ...patch }), env));
  }
  await assert.rejects(fs.access(capture));
  for (const operation of ["action", "update", "return"]) {
    const result = await dispatchArtifact(signed(request(operation)), env);
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.output).revision, 3);
    const sent = JSON.parse(await fs.readFile(capture, "utf8"));
    assert.deepEqual(sent.args, ["cloud", "agent-pete", "room-artifact"]);
    assert.deepEqual(sent.body, request(operation));
    assert.equal(sent.hasBearer, false);
    assert.equal(sent.machine, "local-machine-identity");
  }
  await assert.rejects(dispatchArtifact(signed(request("action")), { ...env, CLOUD_SYNC_TOKEN: "" }), /Machine identity/);
  await assert.rejects(dispatchArtifact(signed(request("action")), { ...env, CLOUD_BOT_AGENT_MACHINE: "attacker --raw" }), /configured agent/);
}));

test("failures are safe and only definite revision conflicts permit reconciliation", () => fixture(async env => {
  const raw = signed(request("update"));
  for (const error of ["artifact-action: artifact revision changed; reload and try again\n", "artifact: artifact bot/agent/list changed from revision 2 to 3; re-read before updating\n"]) {
    const result = await dispatchArtifact(raw, { ...env, TEST_CODE: "1", TEST_OUTPUT: " ", TEST_ERROR: error });
    assert.equal(result.revisionMismatch, true);
    assert.equal(result.code, 1);
  }
  for (const patch of [
    { TEST_CODE: "1", TEST_OUTPUT: "raw-secret", TEST_ERROR: "token=private revision mismatch" },
    { TEST_OUTPUT: JSON.stringify({ code: 1, output: "credentials=private backend failed" }) },
    { TEST_OUTPUT: "invalid output includes private" }, { TEST_WAIT: "1" }
  ]) {
    const result = await dispatchArtifact(raw, { ...env, ...patch }, { timeoutMs: 100 });
    assert.equal(result.code, 1);
    assert.equal(result.revisionMismatch, undefined);
    assert.equal(/private|raw-secret/.test(result.output), false);
  }
}));

test("128 KiB actual command JSON output survives wrapping; overflow fails safely", () => fixture(async env => {
  const output = JSON.stringify({ value: "x".repeat(131050) });
  const raw = signed(request("return"));
  const result = await dispatchArtifact(raw, { ...env, TEST_SIZE: "131050" });
  assert.deepEqual(result, { code: 0, output });
  const overflow = await dispatchArtifact(raw, { ...env, TEST_SIZE: "131072" });
  assert.equal(overflow.code, 1);
  assert.equal(overflow.revisionMismatch, undefined);
}));
