# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Build the best token launch radar. A working token radar covering the DefiLlama snapshot from 2026-11-14: 758 protocols, 40 on the watchlist, 200 rows ranked by implied launch value.

Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## Model

Starter model radar-1: implied = TVL × 0.25 × growth × maturity, from the snapshot's own figures only. No protocol name is special-cased.
