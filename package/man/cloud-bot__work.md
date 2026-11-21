#### Description

Drain queued messages with bounded retries using the bot VM configuration.
Queue leases and reply/agent deduplication remain active. Exhausted limits
return failure rather than silently reporting success.

#### Usage

```bash
aux4 cloud-bot work --expected 0 --retryAttempts 6 --retryDelay 1000 --retryMaxDelay 15000 --retryBudget 240000 --retryMaxMessages 100
```

The normal bot configuration options match `whatsapp`. `expected` is the number
of newly enqueued messages expected before an empty lease is final. The time
budget stops new attempts; it does not cancel in-flight work or schedule
recovery after VM termination.

#### Example

```bash
aux4 cloud whatsapp-bot cloud-bot work
```

```json
{"processed":0,"attempts":1,"retries":0,"failed":0,"exhausted":false,"reason":"empty"}
```
