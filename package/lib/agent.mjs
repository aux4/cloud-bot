import { spawn } from "node:child_process";

// The bot owns routing. Opaque correlation IDs, text, and an optional display
// name cross the agent boundary. The completion destination is VM configuration.
export function agentRequest(text, env = process.env) {
  const machine = env.CLOUD_BOT_AGENT_MACHINE || "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(machine)) throw new Error("Invalid configured agent machine");
  const structured = env.CLOUD_BOT_RESPONSE_FORMAT === "chat-turn";
  const requestId = (structured ? env.AUX4BOT_EVENT_ID : env.AUX4BOT_REQUEST_ID) || "";
  const conversationId = (structured ? env.AUX4BOT_CHAT_ID : env.AUX4BOT_CONVERSATION_ID) || "";
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(requestId) || !/^[a-zA-Z0-9._:-]{1,128}$/.test(conversationId)) {
    throw new Error("Missing bot correlation identifiers");
  }
  let sender;
  try {
    const profile = JSON.parse(env.AUX4BOT_SENDER || "{}");
    if (typeof profile?.displayName === "string" && profile.displayName.trim()) {
      sender = { displayName: profile.displayName.trim().slice(0, 200), ...(typeof profile.id === "string" && /^[a-f0-9]{64}$/.test(profile.id) ? {id:profile.id} : {}) };
    }
  } catch { /* Old/custom handlers may omit profile metadata. */ }
  return {
    args: ["cloud", machine, "ask", "--conversationId", conversationId],
    body: { question: text, ...(sender ? { sender } : {}), messageId: requestId, ...(structured ? {responseFormat:"chat-turn"} : {requestId, callback: { enabled: true }}) }
  };
}

export async function dispatchAgent(text, env = process.env) {
  const request = agentRequest(text, env);
  if (!String(env.CLOUD_SYNC_TOKEN || "").trim()) throw new Error("Machine identity is required for agent dispatch");
  // The cloud CLI chooses CLOUD_SYNC_TOKEN. A caller bearer must never replace
  // the bot VM's own identity for this outbound machine request.
  const childEnv = { ...env };
  delete childEnv.AUX4_ACCESS_TOKEN;
  const structured = env.CLOUD_BOT_RESPONSE_FORMAT === "chat-turn";
  return new Promise((resolve, reject) => {
    const child = spawn("aux4", request.args, { env: childEnv, stdio: ["pipe", structured ? "pipe" : "ignore", "ignore"] });
    let output="";
    if (structured) child.stdout.on("data",chunk=>{output+=chunk;if(Buffer.byteLength(output)>262144)child.kill();});
    child.once("error", () => reject(new Error("Agent invocation could not start")));
    child.once("close", code => {
      if(!structured) return code===0 ? resolve() : reject(new Error("Agent invocation failed"));
      const failedTurn = () => JSON.stringify({version:1,status:"failed",conversationId:request.args[4],messageId:request.body.messageId,reply:"Pete could not return a response. Please try again.",history:{messages:[]}});
      // A completed CLI failure may discard the agent's failed stdout. The
      // local request already owns correlation; no remote error is forwarded.
      if(Number.isInteger(code) && code>0) return resolve(failedTurn());
      if(code!==0) return reject(new Error("Agent invocation failed"));
      try {
        let result=JSON.parse(output);if(typeof result.output === "string")result=JSON.parse(result.output);
        if(result.version!==1 || !["completed","failed"].includes(result.status) || result.conversationId!==request.args[4] || result.messageId!==request.body.messageId || typeof result.reply!=="string")throw new Error();
        // A completed agent attempt can fail after its user-facing error was
        // recorded. Deliver a correlated safe reply so Chat does not remain
        // pending; never expose the failed transcript, artifacts or raw error.
        resolve(result.status==="failed" ? failedTurn() : JSON.stringify(result));
      } catch {reject(new Error("Agent did not return a completed turn"));}
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request.body));
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  process.stdin.resume();
  const structured = process.argv[2] === "--structured";
  const machine = process.argv[structured ? 3 : 2] || "";
  const question = process.argv[structured ? 4 : 3] || "";
  dispatchAgent(question, {...process.env, CLOUD_BOT_AGENT_MACHINE:machine, CLOUD_BOT_RESPONSE_FORMAT:structured ? "chat-turn" : ""}).then(output=>{
    if(structured)process.stdout.write(output);
  }).catch(() => {
    process.stderr.write("Configured agent invocation failed\n");
    process.exitCode = 1;
  });
}
