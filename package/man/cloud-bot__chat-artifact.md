#### Description

Process one signed Cloud Chat artifact operation on the configured agent machine.
The bot verifies its existing `CHAT_BOT_SIGNING_SECRET`, requires its machine
identity, and removes a caller bearer before invoking the agent. The caller cannot
select the machine, command, credentials, or configuration.

#### Usage

```bash
aux4 cloud-bot chat-artifact < signed-artifact.json
```

#### Example

The Chat server signs a version 1 envelope with a decimal epoch-seconds `timestamp`,
JSON string `payload`, and `signature` equal to `sha256=` followed by the hex HMAC
SHA-256 of `timestamp.payload`. Requests must be within five minutes and at most
64 KiB including the envelope. The parsed payload is:

```json
{
  "operation": "update",
  "input": {
    "artifactId": "bot/agent/list",
    "ref": "list:groceries",
    "revision": 2,
    "state": {
      "items": []
    },
    "conversationId": "123e4567-e89b-42d3-a456-426614174000"
  }
}
```

Every operation invokes only the configured agent's fixed `room-artifact` command.
The verified `operation` and `input`, including the conversation UUID, cross as
JSON stdin. The agent wrapper uses that UUID to isolate each room's artifact
catalog and backend state. Action adds the declared `action` name; return accepts
only the locator and conversation. The agent must return its successful result
inside `roomArtifactResult`, which the bot validates and unwraps. This preserves
application fields named `output`, `body`, or `code` through the Cloud CLI.
Command stdout returns an `artifactResult`
object containing `{code, output}`, preserving the same result through raw and
legacy Cloud transports. Output contains at most 128 KiB of command JSON.
Failures return generic text; only a definite revision
conflict adds `revisionMismatch: true`. Execution stops after 18 seconds, plus up
to five seconds for configured target lookup. There is no automatic mutation retry.
The outbound CLI runs directly with `AUX4_NO_DAEMON=1` so its cleaned machine
environment cannot inherit a resident daemon's caller bearer.
