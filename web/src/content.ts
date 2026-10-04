/** Plain-English copy: what each fund is, what each regime means, and a short glossary. */

export const NAMES: Record<string, string> = {
  AGG: "US bonds (mixed)",
  BIL: "1–3 month T-bills (≈ cash)",
  TLT: "20+ yr Treasury bonds",
  SOXL: "Chip stocks 3×",
  TQQQ: "Nasdaq-100 3×",
  UPRO: "S&P 500 3×",
  TECL: "Tech stocks 3×",
  UUP: "US dollar",
  QID: "Nasdaq-100 −2× (inverse)",
  TBF: "Long Treasuries −1× (inverse)",
  UGL: "Gold 2×",
  TMF: "Long Treasuries 3×",
  BTAL: "Anti-beta (calm vs. jumpy stocks)",
  XLP: "Consumer staples",
  SPY: "S&P 500 (the market)",
};

export const DESC: Record<string, string> = {
  AGG: "A fund holding thousands of US bonds (loans to the government and companies). It falls in value when interest rates rise.",
  BIL: 'A fund of 1–3 month US government loans. It barely moves and earns roughly the interest rate, so treat it as "cash".',
  TLT: "US government bonds maturing in 20+ years. They react most to interest rates: when rates rise, TLT falls hard.",
  SOXL: "Moves about 3× the daily move of computer-chip companies like Nvidia and AMD. The most aggressive of the four.",
  TQQQ: "Moves about 3× the daily move of the Nasdaq-100 (Apple, Microsoft, Amazon…).",
  UPRO: "Moves about 3× the daily move of the S&P 500, the 500 largest US companies.",
  TECL: "Moves about 3× the daily move of US technology stocks.",
  UUP: "Rises when the US dollar strengthens against other major currencies, which tends to happen when US rates rise.",
  QID: "An inverse fund: moves about 2× the OPPOSITE of the Nasdaq-100 each day, so it makes money when tech stocks fall.",
  TBF: "An inverse fund: makes money when long-term bond prices fall, which happens when rates rise.",
  UGL: "Moves about 2× the daily move of gold, which often holds up when investors are scared.",
  TMF: "Moves about 3× the daily move of long-term US government bonds. It gains strongly when rates fall.",
  BTAL: "Owns calm, steady stocks and bets against jumpy ones. It tends to gain when the market panics.",
  XLP: "Companies selling everyday goods (food, soap, drinks). People keep buying these in recessions.",
  SPY: "A fund holding the 500 largest US companies, i.e. 'the stock market'. Used only as the benchmark to beat.",
};

export interface RegimeInfo {
  name: string;
  color: string;
  tip: string;
}

export const REGIMES: Record<string, RegimeInfo> = {
  risk_on: {
    name: "Risk on",
    color: "var(--on)",
    tip: '"Risk on" means taking risk on purpose because conditions look calm. The bot buys 3× stock funds: a 1% market rise becomes about +3%, a 1% fall about −3%.',
  },
  risk_off_rising: {
    name: "Risk off · rising rates",
    color: "var(--rising)",
    tip: '"Risk off" means stepping away from stocks to protect the money. With rates rising, the bot holds the US dollar plus a fund that profits when prices fall.',
  },
  risk_off_falling: {
    name: "Risk off · falling rates",
    color: "var(--falling)",
    tip: '"Risk off", in the version where rates are falling (usually a nervous or slowing economy). The bot holds safe havens: gold, long-term bonds, staples, and a fund that rises when risky stocks fall.',
  },
};

export const REGIME_ORDER = ["risk_on", "risk_off_rising", "risk_off_falling"] as const;

export const regime = (key: string): RegimeInfo =>
  REGIMES[key] ?? { name: key, color: "var(--faint)", tip: "" };

export const GLOSSARY = {
  cagr: ["Annual return", "Average growth per year, with gains compounding on earlier gains. Higher is better."],
  vol: ["Volatility", "How much the value swings in a typical year. 20% means landing 20 points above or below average is normal. Higher = bumpier ride."],
  sharpe: ["Sharpe ratio", "Return earned above cash per unit of bumpiness, like miles per gallon for investing. Rough guide: below 0.5 is weak, around 1 is good, above 1.5 is excellent (and suspicious in a backtest)."],
  mdd: ["Max drawdown", "The worst fall from a high point to a later low. −50% means $100 at the peak became $50 before recovering."],
  isS: ["Sharpe 2013–22", "Score on the years the rules could have been tuned on. A good score here is expected, so it proves little."],
  oosS: ["Sharpe 2023+", "Score on years kept aside as unseen data, the honest test. Much lower than the earlier number suggests overfitting."],
  reb: ["Trades / yr", "How many days per year the bot changes its holdings. More trading means more cost."],
} as const;

export const RSI_TIP =
  'RSI (relative strength index) scores how much a fund went up vs. down recently, 0–100. Below 30 = fell a lot lately ("oversold"); above 70 = rose a lot ("overbought"). The bot picks the lowest, betting beaten-down funds bounce back ("buying the dip").';

export const STEP_TIPS: Record<string, string> = {
  check_clock: "Ask the broker whether the market is open today. On holidays and weekends a real run stops here; a dry run carries on and only plans.",
  fetch_bars: "Download the latest completed daily prices for all 15 funds through the MarketData port, retrying if the source fails.",
  decide: "Call the pure strategy() function on those prices. The rows below show what it checked.",
  reconcile: "Compare the target with what the account actually holds, and work out the whole-share orders needed to close the gap. Gaps under 2 percentage points are ignored.",
  submit_orders: "Send orders to the broker (sells first, so their cash funds the buys) and wait for them to fill.",
};

export const sayCagr = (v: number, who: string) =>
  `${who} grew about ${(v * 100).toFixed(1)}% a year: $100 becomes about $${(100 * (1 + v)).toFixed(0)} after a typical year.`;
export const saySharpe = (v: number, who: string) =>
  `${who} scores ${v.toFixed(2)}${v < 0.5 ? ", which is weak" : v < 1 ? ", which is moderate" : ", which is good"}.`;
export const sayMdd = (v: number, who: string) =>
  `At its worst, $100 in ${who} fell to $${(100 * (1 + v)).toFixed(0)}.`;
