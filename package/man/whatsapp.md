#### Description

Verify a signed WhatsApp webhook envelope from stdin, enqueue its messages, and process one queued message. State and queue use the machine's own Turso database. The default brain replies `you said: <text>`.

#### Usage

```bash
aux4 whatsapp < delivery.json
```

The platform webhook must use asynchronous execution with the envelope payload format. Set the `whatsapp` scope secret's `token` and `appSecret` fields before deployment. `--db` defaults to `cloud`; `--phoneNumberId` selects the Meta number. `--apiUrl` overrides the Graph API endpoint for testing.

#### Example

```bash
aux4 whatsapp --phoneNumberId 1450110568185980 < delivery.json
```

```text
{"ok":true}
```

#### Agent routing

Set `--agentMachine agent-pete` (or VM environment variable `CLOUD_BOT_AGENT_MACHINE`) to use a generic agent with an authenticated completion callback. Set `AGENT_CALLBACK_MACHINE=whatsapp-bot` and `AGENT_CALLBACK_COMMAND=cloud-bot complete` on the agent, with exact VM command grants in both directions.

Use `--brainCommand` / `CLOUD_BOT_COMMAND` for a synchronous command that prints a reply. Configure either an agent machine or a command. Text travels on stdin to the cloud transport; it never becomes a remote command path.

After ingestion, queued work uses bounded retries. The new enqueue count
protects against an unexpectedly empty lease. Flags `retryAttempts`,
`retryDelay`, `retryMaxDelay`, `retryBudget` and `retryMaxMessages` control
limits; exhausted work returns failure.
