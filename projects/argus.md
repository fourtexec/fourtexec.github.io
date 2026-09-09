# argus

> uptime monitoring that assumes you have better things to do.

**argus** is a self-hosted uptime radar. it pings your fleet, watches
your certs and ports, and pages you *only* when it's actually your
fault — after retries, cross-checks from two regions, and a quick
vibe assessment of your last deploy.

## what makes it different

most monitors cry wolf. argus has **opinions**:

- flapping service? it waits, retries from another region, *then* pages
- alert storm? it collapses 400 alerts into one incident with a summary
- 3am page? includes the probable cause, not just «down»

## stack

written in **typescript** on bun, sqlite for storage, one docker
container for the whole thing. dashboard is server-rendered and fast
enough to open during an actual incident.

```bash
docker run -d -p 8462:8462 \
  -v argus-data:/data \
  fourtexec/argus:latest
```

## config taste

```yaml
targets:
  - name: api.prod
    url: https://api.fourtexec.dev/health
    expect: { status: 200, latency_under: 250ms }
    page: [telegram, webhook]
```

- [x] http / tcp / ping / cert expiry
- [x] telegram, webhook, email, ntfy channels
- [x] public status pages
- [ ] distributed probe agents (in progress)

## fine print

built because our 3am pages used to say «something is wrong maybe».
now they say what broke, when, and whose deploy did it. progress.

MIT. Status: **active** — it watches this very site.
