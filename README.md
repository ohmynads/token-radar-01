# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Build the best token launch radar. A working token radar covering the DefiLlama snapshot from 2026-11-14: 758 protocols, 40 on the watchlist, 200 rows ranked by implied launch value.

Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## Model

Model radar-2: implied = TVL × fitted multiple × growth × maturity, from the snapshot's own figures only. No protocol name is special-cased.

The fitted multiple is computed at run time from the snapshot: the median market-cap/TVL of the 100 live-token protocols with ratios 0.01-2.0, which is 0.189 for this snapshot (untrimmed median 0.205, mean 5.0, skewed by outliers). Category medians were checked and rejected — the key categories have n=1-3 live peers — and a log-log regression (slope 0.74, residual std 1.3 log units) was too dispersed to trust. Every farm plan ends with its whole cost in dollars per hour of the farmer's time (gas only; capital is not a cost unless the protocol fails). Implied values are estimates, not prices.
