# cloud-bot chat-artifact

## rejects an unsigned request

```execute
printf '%s' '{}' | aux4 cloud-bot chat-artifact
```

```error:partial
Artifact request could not be processed
```

## verifies signed routing, identity and bounded execution

```execute
node --test --test-reporter=tap chat-artifact.mjs
```

```expect:partial
# fail 0
```
