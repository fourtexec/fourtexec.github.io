# voidloop

> if you did it twice, it's already a pipeline.

**voidloop** is a headless automation daemon. you describe repetitive
work as declarative yaml, voidloop runs it forever — watching files,
webhooks, cron schedules and queues, then clicking the buttons so you
never have to.

## the pitch

zapier charges you per task. cron doesn't retry. github actions wants
your whole life in `.github/workflows`. voidloop is one daemon, one
config file, and a policy of *brutal simplicity*.

```yaml
- name: mirror-releases
  on: { webhook: github.release }
  run:
    - shell: ./sign-artifacts.sh {{ tag }}
    - http: POST https://irc.fourtexec.dev/broadcast
  retry: { attempts: 5, backoff: exponential }
```

## internals

- **go** single binary, ~8mb, embeds its own scheduler
- hot-reloads config on `SIGHUP` — zero downtime edits
- every run is journaled to sqlite; `voidloop log` is a time machine
- sandboxes shell steps with bubblewrap when available

## status: beta

it runs our infra, so it *works* — but the plugin api is still moving.
pin your version or enjoy the drift.

- [x] webhooks, cron, file watchers
- [x] sqlite journal + tui explorer
- [ ] cluster mode (leader election, etc.)
- [ ] a logo that isn't just a black square

## get it

```bash
go install fourtexec.dev/voidloop@latest
voidloop init   # writes a starter pipeline
voidloop up     # daemon mode
```

MIT licensed. Contributions welcome — especially cursed integrations.
