# warpfetch

> neofetch got slow, so we wrote its obituary in rust.

**warpfetch** is a system information fetch tool in ~400 lines of rust.
zero config, zero dependencies, one static binary. it prints your os,
kernel, shell, cpu, memory and uptime before your terminal finishes
drawing the prompt.

## why it exists

we benchmarked every fetch tool we could find. the fastest one still
spent `38ms` *thinking about* your hostname. warpfetch does the whole
job in under **1.2ms** — which is not a feature, it's a refusal to
waste your frames.

## feature dump

- single static binary, ~90kb stripped
- auto-detects 40+ distros, *all* package managers
- ascii art rendered as compile-time string tables, not files
- themeable via one env var: `WARPFETCH_ACCENT=orange`
- `--json` mode for piping into waybar / tmux / your dashboard

## install

```bash
cargo install warpfetch
# or the chaotic way:
curl -fsSL https://fourtexec.dev/warpfetch.sh | sh
```

## usage

```bash
warpfetch              # pretty output
warpfetch --json       # machine food
warpfetch --bare       # no art, just facts
```

## the numbers

| tool       | cold start | binary size |
|------------|-----------|-------------|
| warpfetch  | 1.2 ms    | 90 kb       |
| neofetch   | 97 ms     | 120 kb*     |

*and 10,000 lines of bash. we counted. we regret counting.

## contrib

- [x] linux, macos, freebsd
- [x] waybar / tmux modules
- [ ] windows (accepting pain-tolerant volunteers)

License: MIT. File issues, send patches, break our benchmarks.
