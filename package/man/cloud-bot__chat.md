#### Description

Process a signed Cloud Chat delivery using the configured agent and shared repository queue.

#### Usage

```sh
aux4 cloud-bot chat < envelope.json
```

Internal webhook command. The static server configuration determines credentials, callback destination and agent; request input cannot override them.
