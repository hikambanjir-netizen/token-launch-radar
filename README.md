# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hikambanjir-netizen/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hikambanjir-netizen/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

This entry is a token launch radar that ranks pre-token DeFi protocols by an implied value derived entirely from the sealed snapshot's own figures. It covers all 40 watchlist protocols plus 200 more pre-token protocols below the floor, and gives every row a concrete farm plan with indicative costs and time. The dashboard is sortable and filterable, with a per-protocol detail view that shows the model's full arithmetic behind each ranking.

## The model

The implied value starts from per-category market-cap-to-TVL multiples, computed as medians from the tokenised protocols in the same snapshot and shrunk toward the global median when a category has few samples. Each pre-token protocol's TVL is then priced with its category multiple and adjusted by two transparent factors: a momentum factor from its seven-day TVL change, and a track-record factor from how long DefiLlama has tracked it. No protocol names are hardcoded — the ranking follows only from the snapshot's figures.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

---
<sub>Entered on [make.fun](https://make.fun/?ref=dfkzjsa3&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
