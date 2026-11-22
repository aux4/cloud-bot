import fs from "node:fs";
import assert from "node:assert/strict";
import { agentRequest } from "../../lib/agent.mjs";
// Assert the real plugin -> queue -> worker environment -> agent envelope path
// on both the failed first attempt and retry, without making an inference call.
const request = agentRequest(process.argv[2] || "", {...process.env,CLOUD_BOT_AGENT_MACHINE:"fixture-agent",AUX4BOT_REQUEST_ID:"fixture-request",AUX4BOT_CONVERSATION_ID:"fixture-conversation"});
assert.deepEqual(request.body.sender,{displayName:"Ada"});
const file = "retry-brain-count";
const count = fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8")) + 1 : 1;
fs.writeFileSync(file, String(count));
if (count === 1) process.exitCode = 1;
else process.stdout.write(`you said: ${process.argv[2] || ""}`);
