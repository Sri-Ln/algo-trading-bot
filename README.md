# algo-trading

[![CI](https://github.com/Sri-Ln/algo_trading/actions/workflows/ci.yml/badge.svg)](https://github.com/Sri-Ln/algo_trading/actions/workflows/ci.yml)

A rules-based ETF rotation strategy, implemented as a tested Python package with a
realistic backtester. Each day it reads two bond-market signals, picks one of three
portfolios, and holds it until the signals change.

> Paper trading only. Nothing here is investment advice.

## The strategy

Every trading day, using closing prices, the rules are checked in order and the first
one that holds sets the portfolio:

| # | Condition | Mode | Holdings |
|---|-----------|------|----------|
| 1 | Bonds (AGG) beat cash (BIL) over 60 days | Risk on | The 2 of SOXL, TQQQ, UPRO, TECL (3× equity funds) with the lowest 10-day RSI, 50% each |
| 2 | Long bonds (TLT) trail cash over 20 days | Risk off, rising rates | 50% UUP (US dollar) + 50% whichever of QID / TBF has the lower 20-day RSI |
| 3 | Otherwise | Risk off, falling rates | 25% each of UGL, TMF, BTAL, XLP |

The idea: bonds falling behind cash is an early sign of rising rates, which tends to
hurt stocks. The rules come from a public
[Composer strategy](https://app.composer.trade/symphony/xDsLkk2PAlXio3qTs1KY/details),
also traded by [jononon/algo-trading-schwab](https://github.com/jononon/algo-trading-schwab).
This repository reimplements and evaluates them independently.

## Backtest results

Daily, January 2013 to October 2026, 5 bps cost per dollar traded. The rules were
designed by someone who had seen past prices, so a good result on that history proves
little. **2023 onward is held out as an out-of-sample test**, a split fixed before running
any backtest.

| | Period | CAGR | Volatility | Sharpe | Max drawdown |
|---|---|---:|---:|---:|---:|
| Strategy | 2013–2026 | 42.7% | 51.6% | 0.92 | −68.7% |
| | 2013–2022 | 56.8% | 49.3% | 1.15 | −65.9% |
| | 2023–2026 | 10.9% | 57.2% | 0.39 | −68.7% |
| SPY | 2013–2026 | 14.8% | 16.7% | 0.81 | −33.7% |
| | 2013–2022 | 12.1% | 17.4% | 0.71 | −33.7% |
| | 2023–2026 | 22.3% | 14.9% | 1.12 | −18.8% |

The strategy trades about 95 days a year, costing about 4.6% a year at 5 bps.

**Takeaway:** the strong in-sample result does not hold up after 2023, when its
risk-adjusted return falls well below simply holding SPY. The large drawdowns come from
the 3× leveraged funds. Taxes are not modeled.

Reproduce with `uv run algo-trading backtest` (add `--cost-bps 10` to stress costs).

### Robustness

**Nearby settings.** The backtest re-run on a 5×5 grid around the published settings
(bond lookback 60 days, risk-on RSI window 10), Sharpe ratio at 5 bps:

| Bond lookback | 2013–2022, RSI 6 → 14 | 2023–2026, RSI 6 → 14 |
|---|---|---|
| 40 | 0.93 0.93 0.93 1.00 1.01 | −0.01 0.01 −0.01 −0.06 −0.00 |
| 50 | 1.02 1.02 1.03 1.10 1.12 | 0.08 0.12 0.07 0.05 0.12 |
| **60** | 1.13 1.15 **1.15** 1.23 1.25 | 0.36 0.41 **0.39** 0.37 0.44 |
| 70 | 1.26 1.29 1.28 1.35 1.37 | 0.01 0.07 0.04 0.03 0.10 |
| 80 | 1.20 1.22 1.21 1.27 1.30 | 0.22 0.28 0.25 0.26 0.34 |

Before 2023 the surface is smooth, and the published settings are not its peak, so they
do not look hand-picked. The RSI window barely matters; the bond lookback drives the
result. After 2023, though, 60 days is the only lookback with a clearly positive Sharpe:
its neighbors at 50 and 70 days are near zero. The holdout result depends on that one
setting, which is a sign of luck rather than a robust edge.

**Trading costs.** Every 5 bps of cost takes 6–7 points off CAGR and 0.09 off Sharpe,
because the strategy buys and sells about 90 times its own value each year. Above
11 bps per dollar traded, its full-period Sharpe falls below SPY's.

| Cost | CAGR 2013–2026 | Sharpe 2013–2026 | Sharpe 2023–2026 | Cost per year |
|---:|---:|---:|---:|---:|
| 0 bps | 49.4% | 1.01 | 0.48 | 0.0% |
| 5 bps | 42.7% | 0.92 | 0.39 | 4.6% |
| 10 bps | 36.3% | 0.83 | 0.30 | 9.2% |
| 25 bps | 18.8% | 0.56 | 0.04 | 22.9% |

Reproduce with `uv run algo-trading sweep`, which also writes the full results to
`data/backtest/` for the web console. Costs never change the weights, so the cost curve
re-prices one backtest's trades instead of re-running it, and a test checks that this
matches a full re-run.

## How it works

- **Pure strategy function.** `strategy(closes, params) -> Decision` takes prices and
  returns target weights *plus the reasoning*: each rule's inputs and outcome, and the
  RSI ranking. It has no I/O, so the backtest and a live runner call the same code.
- **Realistic timing.** Decisions use prices up to day *t*'s close and fill at day
  *t+1*'s open. Each simulated day has an overnight leg on the old holdings and an
  intraday leg on the new ones, so there is no look-ahead.
- **Costs and drift.** Trading costs are charged on every dollar bought or sold. Weights
  drift with prices, and the portfolio rebalances only when it is more than 2 percentage
  points (summed) away from target.
- **Reproducible indicators.** Wilder's RSI depends on how much history it sees, so it is
  always computed over a fixed 250-day window. Live and backtest decisions on the same
  day therefore match exactly.
- **Swappable data.** Prices come through a `MarketData` port. The Yahoo Finance adapter
  is wrapped in a Parquet cache so backtests run offline.

## Getting started

Requires [uv](https://docs.astral.sh/uv/) and Python 3.12.

```bash
uv sync
uv run algo-trading backtest            # downloads prices on first run, then uses the cache
uv run algo-trading sweep               # parameter sweep and cost curve, saved as JSON
uv run pytest -m "not network"          # tests
uv run ruff check && uv run mypy        # lint and strict type checks
```

## Project layout

```
src/algo_trading/
  universe.py      ETFs and their roles
  market_data.py   Bars, MarketData port, Yahoo Finance source, Parquet cache
  indicators.py    N-day return, RSI (Wilder and simple)
  strategy.py      the rules: prices -> Decision
  backtest.py      daily simulation with next-open fills and costs
  metrics.py       CAGR, volatility, Sharpe, drawdown
  sweep.py         parameter sweep and trading-cost sensitivity
  broker.py        Broker port and in-memory fake broker
  reconcile.py     target weights -> whole-share orders
  alpaca.py        Alpaca paper-trading adapter
  live.py          daily live run with a step-by-step trace
  store.py         JSON files for live runs and backtest results
  cli.py           `algo-trading backtest`, `sweep` and `live`
tests/             unit tests for each module, plus an end-to-end backtest
```

## Roadmap

- [x] Strategy, backtester, metrics, CI
- [x] Parameter sweep and cost sensitivity
- [x] Live paper trading on Alpaca, scheduled daily with GitHub Actions
- [ ] Run traces, positions and orders published as a static JSON API
- [ ] Web console (React on GitHub Pages) to explore decisions, backtests and the live account
