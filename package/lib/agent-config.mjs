import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

export function configuredAgentMachine(env = process.env) {
  if (env.CLOUD_BOT_AGENT_MACHINE) return env.CLOUD_BOT_AGENT_MACHINE;
  const file = env.CLOUD_BOT_CONFIG_FILE || "/tmp/config.yaml";
  if (!existsSync(file)) return "";
  // Only the non-secret agent target comes from config. Runtime credentials and
  // command execution remain VM-owned; dispatch also requires a machine grant.
  const result = spawnSync("aux4", ["config", "get", "--file", file, "bot/agentMachine"], {
    env, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.status !== 0) throw new Error("Unable to read the bot's VM configuration");
  const machine = String(result.stdout || "").trim();
  if (machine && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(machine)) throw new Error("Invalid configured agent machine");
  return machine;
}
