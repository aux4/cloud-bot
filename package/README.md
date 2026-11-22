# aux4/cloud-bot

Run a WhatsApp aux4 bot on one aux4.cloud command machine. The machine declares
`turso:database`, so bot state and the repository-backed queue share its own
Turso database through `db: cloud`.

## Installation

```bash
aux4 aux4 pkger install aux4/cloud-bot
```

The `whatsapp` command consumes the platform webhook's raw request envelope on
stdin, performs the bot's own Meta signature check, enqueues new messages, and
drains queued work with bounded retries before returning. Its default brain replies
`you said: <text>`.

Configure the `verifyToken` value when deploying and create the aux4-cloud
scope secret `whatsapp` with `token` and `appSecret` fields. The command uses
the `secret://aux4-cloud/whatsapp/...` references by default. On a VM, assigned
`WHATSAPP_TOKEN` and `WHATSAPP_APP_SECRET` fields are used directly, avoiding a
second secret-provider lookup. Explicit command parameters take precedence.

The platform webhook must pass an envelope containing `method`, `headers`,
`queryStringParameters`, `rawBody`, and `pathParameters` with `channel` and
`bot`. The command is intended to be bound to the platform's asynchronous
webhook runner.

## Inspecting the hosted bot

```bash
aux4 cloud whatsapp-bot cloud-bot status
aux4 cloud whatsapp-bot cloud-bot conversations
aux4 cloud whatsapp-bot cloud-bot messages 19095516812
```

Status shows the database URL and credential length without displaying credentials.
History commands use the same machine database as ingestion and work.

## Calls to other machines

`cloud-bot invoke` uses this machine's identity and explicit outbound command grants.
It is denied by default. For example, after an administrator grants the target's
`read` command:

```bash
aux4 cloud whatsapp-bot cloud-bot invoke --target repository --command read
```

Only commands allowed on both the source policy and target machine can run.

## Generic agent routing

The default command echoes incoming text. Set the bot VM's configuration to select a generic agent:

```yaml
config:
  bot:
    agentMachine: agent-pete
```

The bot reads its machine configuration from `/tmp/config.yaml`. Explicit command parameters and the VM-owned `CLOUD_BOT_AGENT_MACHINE` environment variable take precedence. The selected target must also have an explicit `ask` grant in the bot's machine access settings.

The bot sends an opaque request ID and conversation ID, then waits while the agent completes the turn. Queue visibility is renewed during that wait. The agent sends its result back through authenticated `cloud-bot complete`; it never receives channel credentials or chooses the recipient.

On the agent VM configure `AGENT_CALLBACK_MACHINE=whatsapp-bot` and `AGENT_CALLBACK_COMMAND=cloud-bot complete`. Grant only `ask` from the bot to the agent, and only `cloud-bot/complete` from the agent to the bot. The platform ingress still acknowledges the provider quickly and invokes the bot asynchronously. No child process is detached.

For a synchronous command instead, set `CLOUD_BOT_COMMAND` to a command that prints its reply. Configure either a command or an agent machine. This POC routes text; cross-VM attachments need an explicit shared artifact mechanism.

Use `aux4 cloud-bot work` on the machine to drain queued messages with the
same bot configuration. It returns a retry summary without creating an inbound
message.

The bot requires core queue leasing that distinguishes an empty queue from a
provider failure. Agent conversation history stays enabled and is selected by
the stable opaque conversation ID.

## Worker retries

A delivery passes its new enqueue count to `aux4 bot retry-work`, so an empty
first lease does not strand a new message. Worker failures use bounded backoff
while leases, stored attempt counts and agent/reply deduplication remain active.
Default retry delays are 1, 2, 4, 8 and 15 seconds (six consecutive attempts).
Successful work drains without a backoff delay.

Command flags: `retryAttempts` (6), `retryDelay` (1000 ms), `retryMaxDelay`
(15000 ms), `retryBudget` (240000 ms before starting more attempts), and
`retryMaxMessages` (100). Exhausted limits return an error. In-flight work keeps
its normal timeout; retries do not survive VM/process termination. No daemon,
scheduler or additional credentials are introduced.


The agent receives an optional channel-neutral `sender: { displayName }` alongside its turn. WhatsApp phone numbers, provider IDs, credentials and profile authority flags are not forwarded. The display name does not grant access.

## Cloud Chat participant

The optional `aux4/bot-chat` adapter shares this machine's repository queue and
Turso capability with WhatsApp. Set secret binding `CHAT_BOT_SIGNING_SECRET` and
static `CHAT_BOT_CALLBACK_URL` to the Chat deployment's `/api/apps/chat/bot-event`.
The configured `bot.agentMachine` remains the only allowed chat target.
Bind an asynchronous HMAC platform hook (timestamp header `X-Aux4-Chat-Timestamp`,
signed template `{timestamp}.{body}`) to `cloud-bot chat`. The command pins channel `chat` and bot `chat-bot`. This command re-verifies and ingests the signed envelope, then
awaits the bounded worker in the same invocation. It starts no background process.

Chat sender context carries the authenticated display name and a stable opaque user ID. It grants no roles or permissions and contains no phone number or credential.
