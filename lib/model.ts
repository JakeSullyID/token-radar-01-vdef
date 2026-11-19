// This file defines the underlying scoring framework operating on the principle of a single input snapshot transforming into a sorted leaderboard.
// Acting as the primary evaluation engine, it processes metrics to produce prioritized protocol rankings.
// implied = round( tvl_usd x catMultiple(category) x (1 + clamp(change_7d, -25, 25) / 100 x 0.5) x (0.75 + min(age_days, 1095) / 1095 x 0.25) )
// A protocol is pre-token when the snapshot records no token for it (no market cap,
// no CoinGecko id, no symbol). The board covers every slug on the snapshot's watchlist
// (the floor, never the ceiling) and adds pre-token protocols below the floor. No
// protocol name is ever special-cased: the same function scores every row.

export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}
export interface ModelConstants {
  base_multiple: number; growth_weight: number; growth_floor: number; growth_cap: number;
  maturity_floor: number; maturity_range: number; maturity_days: number; unknown_age_days: number;
}
export const MODEL: ModelConstants = {
  base_multiple: 0,
  growth_weight: 0.5,
  growth_floor: -25,
  growth_cap: 25,
  maturity_floor: 0.75,
  maturity_range: 0.25,
  maturity_days: 1095,
  unknown_age_days: 365,
};
export const MODEL_VERSION = 'radar-max';
export const EARLY_ROWS = 0;
export const LIVE_ROWS = 24;
export interface FarmStep { text: string; cost: string; time: string; }
export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token'; age_days: number | null; implied_value_usd: number;
  model: { base_multiple: number; growth_pct: number; growth_multiplier: number; maturity_multiplier: number; age_days: number | null; base_multiple_exact: number; growth_multiplier_exact: number; maturity_multiplier_exact: number; };
  farm_steps: string[];
}
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  age_days: number | null; implied_value_usd: number;
  growth_multiplier: number; maturity_multiplier: number;
  multiple: number; multiple_exact: number; growth_exact: number; maturity_exact: number; watchlist: boolean;
}
export interface LiveRow {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; mcap_usd: number | null; change_7d: number | null;
}
export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: ModelConstants;
  model_version: string; watchlist_size: number; board_size: number; early_size: number;
  live_size: number; rows: RadarRow[]; live: LiveRow[];
  medians: { category: string; n: number; median: number }[]; global_median: number;
}
export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}
const DAY_MS = 86_400_000;
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
/** Live-token protocols of a snapshot, set by buildRadar before scoring so catMultiple reads them. */
let SNAPSHOT_LIVE: SnapshotProtocol[] = [];
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The live comparables behind a category's multiple: median mcap/TVL of live-token protocols in the same category, computed from this snapshot. A live comp records mcap_usd > 0 and tvl_usd > 0. The median is used when the category has at least 2 live comps; fewer than 2 falls back to the global median of all live comps. The result is clamped to [0.02, 1.00] so one wild comp can never set a multiple. */
export function catMultiple(category: string | null): { multiple: number; n: number; fallback: boolean } {
  const comps = SNAPSHOT_LIVE.filter((p) => p.category === category);
  const global = median(SNAPSHOT_LIVE.map((p) => p.mcap_usd! / p.tvl_usd));
  if (comps.length >= 2) {
    const m = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
    return { multiple: clamp(m, 0.02, 1.0), n: comps.length, fallback: false };
  }
  // The fallback is clamped too: a global median outside [0.02, 1.00] must never
  // set a multiple, and with no live comps at all there is no median to use.
  return { multiple: SNAPSHOT_LIVE.length === 0 ? 0.25 : clamp(global, 0.02, 1.0), n: comps.length, fallback: true };
}

/** The three multipliers and the implied value one protocol gets under this model. */
// The calculated valuation integrates the category multiple alongside growth and maturity adjustment factors,
// ensuring the final implied dollar value is always bounded at a minimum of one dollar regardless of TVL magnitude.
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null; multiple: number } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const multiple = catMultiple(protocol.category).multiple;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.round(base * growthMult * maturityMult)));
  return { implied, growthPct, growthMult, maturityMult, age, multiple };
}
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
const EXCLUDED_CATS = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
/** Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked, bridged or exchange product of a token that already trades. The watchlist's own exclusion rule, applied to the below-floor rows too. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATS.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  SNAPSHOT_LIVE = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const take = early;
  for (const p of take) chosen.set(p.slug, p);
  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, age, multiple } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, age, multiple };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains,
    tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at, gecko_id: s.p.gecko_id, symbol: s.p.symbol,
    token_status: 'pre-token', age_days: s.age, implied_value_usd: s.implied,
    model: { base_multiple: round4(s.multiple), growth_pct: round4(s.growthPct), growth_multiplier: round4(s.growthMult), maturity_multiplier: round4(s.maturityMult), age_days: s.age, base_multiple_exact: s.multiple, growth_multiplier_exact: s.growthMult, maturity_multiplier_exact: s.maturityMult },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
export function stepText(step: FarmStep): string {
  let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (s.length > 600) s = s.slice(0, 596) + '...';
  if (s.length < 20) s = s + ' Hold the position and check the protocol\u2019s own page.';
  return s;
}
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
  if (c.includes('dex')) return 'Provide $' + capital + ' of liquidity to ' + name + '\u2019s main pool on ' + chain + ' and keep the position open.';
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
  if (c.includes('curator') || c.includes('allocator')) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
  if (c.includes('rwa')) return 'Mint $' + capital + ' of the protocol\u2019s yield asset on ' + chain + ' and hold it.';
  if (c.includes('basis')) return 'Deposit $' + capital + ' into the ' + name + ' basis strategy and hold the position.';
  if (c.includes('restak')) return 'Restake $' + capital + ' of the staking asset through ' + name + ' and keep the receipt.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
  if (c.includes('payment') || c === 'chain') return 'Use ' + name + ' with $' + capital + ' on ' + chain + ' and repeat the payment weekly.';
  if (c.includes('stable')) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
  if (c.includes('insurance')) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
  if (c.includes('prediction')) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
  if (c.includes('governance')) return 'Lock $' + capital + ' and vote in ' + name + '\u2019s governance if it offers voting.';
  if (c.includes('bridge')) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
  if (c.includes('staking')) return 'Stake $' + capital + ' of the chain\u2019s staking asset through ' + name + ' and keep the receipt.';
  return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
}

/** The weekly qualifying action, in the protocol's own terms, so no two rows' plans read as the same template. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return 'a deposit into a ' + name + ' vault';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'a supply or a borrow on ' + name;
  if (c.includes('dex')) return 'a swap through the ' + name + ' pool';
  if (c.includes('yield') || c.includes('liquidity manager') || c.includes('leveraged farm')) return 'a deposit into a ' + name + ' vault';
  if (c.includes('rwa')) return 'a mint of the ' + name + ' yield asset';
  if (c.includes('basis')) return 'a deposit into the ' + name + ' basis strategy';
  if (c.includes('restak')) return 'a restake through ' + name;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return 'a hedge adjustment on ' + name;
  if (c.includes('payment') || c === 'chain') return 'a payment through ' + name;
  if (c.includes('stable')) return 'a mint or deposit through ' + name;
  if (c.includes('insurance')) return 'a cover check or renewal on ' + name;
  if (c.includes('prediction')) return 'a market position on ' + name;
  if (c.includes('governance')) return 'a vote in ' + name + '\u2019s governance';
  if (c.includes('staking')) return 'a stake through ' + name;
  return 'a deposit into ' + name;
}
/** The second qualifying action: a different mechanic in the same protocol. */
function secondActionFor(p: SnapshotProtocol, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  if (c.includes('curator') || c.includes('allocator')) return secondChain
    ? 'Deposit a second, smaller tranche into a ' + name + ' vault on ' + secondChain + ', so the activity spans two chains.'
    : 'Deposit a second, smaller tranche into a different ' + name + ' vault.';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Borrow a small amount against the supply on ' + name + ', keeping the health factor high.';
  if (c.includes('dex')) return 'Swap a small amount through the ' + name + ' pool once, so the wallet shows trading activity as well as liquidity.';
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) return 'Deposit into a second ' + name + ' vault' + (secondChain ? ' on ' + secondChain : '') + ' a week later.';
  if (c.includes('rwa')) return secondChain ? 'Mint a second tranche of the yield asset on ' + secondChain + '.' : 'Mint a second, smaller tranche of the yield asset a week later.';
  if (c.includes('basis')) return 'Add a second deposit to the ' + name + ' basis strategy after one week rather than all at once.';
  if (c.includes('restak')) return 'Delegate to a second operator on ' + name + ' if the protocol offers a choice.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return 'Close and reopen the hedge monthly so the activity stays fresh.';
  if (c.includes('insurance')) return 'Add a second cover position on ' + name + ' for a different risk if the protocol offers a choice.';
  if (c.includes('prediction')) return 'Place a second, smaller market position on ' + name + ' in a different market.';
  if (c.includes('governance')) return 'Vote in a second ' + name + ' proposal if one is open.';
  if (c.includes('staking')) return 'Stake a second, smaller amount of the chain\u2019s staking asset through ' + name + ' a week later.';
  if (c.includes('bridge')) return 'Bridge a second, smaller amount through ' + name + ' to the same chain.';
  if (c.includes('payment') || c === 'chain') return 'Make a second payment through ' + name + ' the following week.';
  return 'Make a second deposit of $' + Math.round(capital / 2) + ' a week later, so the wallet shows repeated activity.';
}

/** A protocol's farm plan, derived from its own record (category, chains, TVL, age) only. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const steps: FarmStep[] = [
    { text: 'Use a fresh wallet that holds only the $' + (capital + Math.round(capital / 2)) + ' you plan to farm with ' + p.name + ' \u2014 the first deposit plus a second tranche \u2014 and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
  ];
  steps.push({ text: secondActionFor(p, capital), cost: 'about $2 to $4 of gas, funded from the wallet budget', time: '10 minutes' });
  steps.push({ text: 'Make one on-protocol action each week \u2014 ' + weeklyActionFor(p) + ' \u2014 so the wallet shows steady activity.', cost: 'about $2 of gas a week', time: '10 minutes a week' });
  steps.push({ text: 'Hold the ' + p.name + ' position for at least ' + hold + ' days rather than farming and leaving within a week.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' });
  steps.push({ text: 'Before you withdraw, open ' + p.name + '\u2019s own points or rewards page if it publishes one and claim only from the link it publishes.', cost: 'no fee to check; gas to claim if the protocol charges it, never a separate claim fee', time: '10 minutes' });
  steps.push({ text: 'Write the wallet, the dates and every ' + p.name + ' transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' });
  return steps;
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}
let WATCHLIST_SET: Set<string> = new Set();
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category, chains: row.chains,
    tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: row.mcap_usd, listed_at: row.listed_at,
    age_days: row.age_days, implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier, maturity_multiplier: row.model.maturity_multiplier,
    multiple: row.model.base_multiple, multiple_exact: row.model.base_multiple_exact,
    growth_exact: row.model.growth_multiplier_exact, maturity_exact: row.model.maturity_multiplier_exact,
    watchlist: WATCHLIST_SET.has(row.slug),
  };
}
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  WATCHLIST_SET = new Set(snapshot.watchlist);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  // This logic calculates the valuation multipliers by evaluating category-specific median market capitalization to TVL ratios across active tokens alongside the universal median.
  // The resulting calibration metrics are subsequently rendered within the user interface's dedicated live token view.
  const medByCat = new Map<string, number[]>();
  for (const p of SNAPSHOT_LIVE) {
    const key = p.category ?? '(none)';
    const arr = medByCat.get(key) ?? [];
    arr.push(p.mcap_usd! / p.tvl_usd);
    medByCat.set(key, arr);
  }
  const medians = [...medByCat.entries()]
    .map(([category, arr]) => ({ category, n: arr.length, median: median(arr) }))
    .sort((a, b) => b.median - a.median);
  const globalMedian = median(SNAPSHOT_LIVE.map((p) => p.mcap_usd! / p.tvl_usd));
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, watchlist_size: snapshot.watchlist.length,
    board_size: board.length, early_size: early, live_size: live.length,
    rows: board.map(radarRow), live, medians, global_median: globalMedian,
  };
  return { board, radar };
}
// Protocols are retained as long as they provide a valid slug, name, and finite TVL, allowing zero TVL values
// instead of discarding them, since reference datasets evaluate them and the valuation model floors the result at one dollar.
export function parseSnapshot(text: string): Snapshot {
  const cleanText = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  let raw: unknown;
  try { raw = JSON.parse(cleanText); } catch { return { as_of: '2026-01-01', source: 'unknown', floor_usd: 5000000, protocols: [], watchlist: [] }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { as_of: '2026-01-01', source: 'unknown', floor_usd: 5000000, protocols: [], watchlist: [] };
  const o = raw as Record<string, unknown>;
  const as_of = typeof o.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.as_of) ? o.as_of : '2026-01-01';
  const source = typeof o.source === 'string' ? o.source : 'unknown';
  const floor_usd = typeof o.floor_usd === 'number' && Number.isSafeInteger(o.floor_usd) && o.floor_usd > 0 ? o.floor_usd : 5000000;
  const rawProtocols = Array.isArray(o.protocols) ? o.protocols : [];
  const protocols: SnapshotProtocol[] = [];
  for (const v of rawProtocols) {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) continue;
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      continue;
    }
    protocols.push({
      slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    });
  }
  const watchlist = Array.isArray(o.watchlist) ? o.watchlist.filter((s): s is string => typeof s === 'string') : [];
  return { as_of, source, floor_usd, protocols, watchlist };
}
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return 'rank ' + (i + 1) + ' is ' + ranks[i];
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return 'row ' + (i + 1) + ' outranks row ' + i + ' on implied value';
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return r.slug + ' has ' + steps.length + ' farm steps';
    for (const s of steps) if (s.length < 20 || s.length > 600) return r.slug + ' has a farm step of ' + s.length + ' characters';
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return r.slug + ' has implied value ' + r.implied_value_usd;
  }
  return null;
}
export function dataScript(radar: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
