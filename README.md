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
  cli.py           `algo-trading backtest`
tests/             unit tests for each module, plus an end-to-end backtest
```

## Roadmap

- [x] Strategy, backtester, metrics, CI
- [ ] Parameter sweep and cost sensitivity
- [ ] Live paper trading on Alpaca, scheduled daily with GitHub Actions
- [ ] Run traces, positions and orders published as a static JSON API
- [ ] Web console (React on GitHub Pages) to explore decisions, backtests and the live account
