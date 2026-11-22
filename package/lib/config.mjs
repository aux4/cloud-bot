import { pathToFileURL } from "node:url";
import { configuredAgentMachine } from "./agent-config.mjs";

export function buildBotConfig([botId, phoneNumberId, verifyToken, token, appSecret, apiUrl, agentMachineArg, commandArg]) {

const agentMachine = agentMachineArg || process.env.CLOUD_BOT_AGENT_MACHINE || configuredAgentMachine();
const configuredCommand = commandArg || process.env.CLOUD_BOT_COMMAND || "";
if (agentMachine && configuredCommand) throw new Error("Configure an agent machine or a command, not both");
if (agentMachine && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(agentMachine)) throw new Error("Invalid configured agent machine");
const script = agentMachine ? "./agent.mjs" : "./echo.mjs";
const command = configuredCommand || `node '${new URL(script, import.meta.url).pathname}'${agentMachine ? ` ${agentMachine}` : ""}`;
const replyMode = agentMachine ? "callback" : "stdout";
const config = {
  channels: ["whatsapp"],
  bots: {
    [botId]: { channel: "whatsapp", phoneNumberId, verifyToken, token, appSecret, apiUrl, command, replyMode }
  },
  defaults: {}
};
  const chatSecret = process.env.CHAT_BOT_SIGNING_SECRET || "";
  const chatCallback = process.env.CHAT_BOT_CALLBACK_URL || "";
  const chatAgent = configuredAgentMachine();
  if (chatSecret || chatCallback) {
    if (chatSecret.length < 32 || !chatCallback || !chatAgent) throw new Error("Chat connection is incomplete");
    config.channels.push("chat");
    config.bots["chat-bot"] = {channel:"chat",signingSecret:chatSecret,callbackUrl:chatCallback,agentMachine:chatAgent,command:`node '${new URL("./agent.mjs", import.meta.url).pathname}' --structured ${chatAgent}`,history:false,sendIdempotent:true};
  }
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write(JSON.stringify(buildBotConfig(process.argv.slice(2))));
