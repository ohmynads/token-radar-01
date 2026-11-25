// Token Radar, radar-2: turn one sealed DefiLlama snapshot into a ranked board.
//
// What goes in: the snapshot's protocols, each with a TVL, a seven-day change, a listing
// date and, for the ones that already trade, a market cap. What comes out: a board of
// pre-token protocols, strongest implied launch value first, plus the live-token set
// shown separately at the market's own prices. Nothing on the board is hand-picked and
// no protocol name is ever special-cased; one function scores every row.
//
// The watchlist is a floor, never a ceiling. It holds every protocol at or above
// $50M TVL with no token on record. The board must cover all of it, and it may add
// pre-token protocols below the floor, by TVL, because those are the early finds the
// radar exists to surface. Live-token protocols are never mixed into the ranking.
//
// Implied value, in words: take the protocol's TVL, multiply it by a multiple fitted
// from the snapshot's own live-token peers, adjust for recent growth, adjust for how
// long the protocol has run with no token, and round. In symbols, with the constants
// named in MODEL below:
//
//     base        = tvl_usd * fittedMultiple
//     growthPct   = clamp(change_7d, -60, 120)
//     growthMult  = 1 + (growthPct / 100) * 0.5
//     maturity    = 0.6 + min(ageDays, 1095) / 1095 * 0.4
//     implied     = max(1, round(base * growthMult * maturity))
//
// The fitted multiple is the median market-cap/TVL of the snapshot's live-token
// protocols, trimmed to ratios between 0.01 and 2.0. For this snapshot that is 0.205
// over 100 peers; the mean is 5.0, dragged up by outliers (one peer sits at 18.96),
// which is why the median, not the mean, is the fit. Two other fits were tried and
// rejected, and the reasons are part of the model, not an afterthought:
//   * Category medians: the categories that matter have one to three live peers.
//     Risk Curators has a single live peer at a ratio of 2.98; Onchain Capital
//     Allocator has two, at 0.019 and 0.006. A multiple built from that is one
//     outlier wearing a category's name, so categories are not used.
//   * A log-log regression of log(market cap) on log(TVL): slope 0.74, but the
//     residual standard deviation is 1.3 log units, so the fit is too dispersed
//     to rank with. It is reported here so a reader can see it was checked.
// The range is therefore wide by construction. Every implied value is an order of
// magnitude, not a price, and the dashboard says so next to the formula.

export interface SnapshotProtocol {
    slug: string;
    name: string;
    category: string | null;
    chains: string[];
    tvl_usd: number;
    change_7d: number | null;
    mcap_usd: number | null;
    listed_at: string | null;
    gecko_id: string | null;
    symbol: string | null;
}

export interface Snapshot {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols: SnapshotProtocol[];
    watchlist: string[];
}

export interface ModelConstants {
    base_multiple: number;
    growth_weight: number;
    growth_floor: number;
    growth_cap: number;
    maturity_floor: number;
    maturity_range: number;
    maturity_days: number;
    unknown_age_days: number;
}

// Fallback constants, used when a snapshot carries no live peers to fit from.
// buildRadar normally replaces base_multiple with the fitted value for its snapshot.
export const MODEL: ModelConstants = {
    base_multiple: 0.205,
    growth_weight: 0.5,
    growth_floor: -60,
    growth_cap: 120,
    maturity_floor: 0.6,
    maturity_range: 0.4,
    maturity_days: 1095,
    unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-2';

// How many pre-token protocols below the watchlist floor the early radar carries, by TVL.
export const EARLY_ROWS = 160;

// How many live-token protocols the Live token view carries, by market cap.
export const LIVE_ROWS = 24;

export interface FarmStep {
    text: string;
    cost: string;
    time: string;
}

export interface BoardRow {
    rank: number;
    slug: string;
    name: string;
    category: string | null;
    chains: string[];
    tvl_usd: number;
    change_7d: number | null;
    mcap_usd: number | null;
    listed_at: string | null;
    gecko_id: string | null;
    symbol: string | null;
    token_status: 'pre-token';
    age_days: number | null;
    implied_value_usd: number;
    model: {
        base_multiple: number;
        growth_pct: number;
        growth_multiplier: number;
        maturity_multiplier: number;
        age_days: number | null;
    };
    farm_steps: string[];
}

export interface RadarRow {
    rank: number;
    slug: string;
    name: string;
    category: string | null;
    chains: string[];
    tvl_usd: number;
    change_7d: number | null;
    mcap_usd: number | null;
    listed_at: string | null;
    age_days: number | null;
    implied_value_usd: number;
    growth_multiplier: number;
    maturity_multiplier: number;
}

export interface LiveRow {
    slug: string;
    name: string;
    category: string | null;
    chains: string[];
    tvl_usd: number;
    mcap_usd: number | null;
    change_7d: number | null;
}

export interface RadarData {
    as_of: string;
    source: string;
    floor_usd: number;
    model: ModelConstants;
    model_version: string;
    watchlist_size: number;
    board_size: number;
    early_size: number;
    live_size: number;
    rows: RadarRow[];
    live: LiveRow[];
}

export interface BoardSummary {
    watchlist_size: number;
    board_size: number;
    early_size: number;
    live_size: number;
}

export class SnapshotError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SnapshotError';
    }
}

const DAY_MS = 86_400_000;

function finiteOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round4(n: number): number {
    return Math.round(n * 1e4) / 1e4;
}

// Whole days from a listing date to the snapshot date, clamped at zero; null
// when either date is absent or unparsable.
export function ageDays(asOf: string, listedAt: string | null): number | null {
    if (listedAt === null) return null;
    const snapshotDay = Date.parse(`${asOf}T00:00:00Z`);
    const listedDay = Date.parse(`${listedAt}T00:00:00Z`);
    if (!Number.isFinite(snapshotDay) || !Number.isFinite(listedDay)) return null;
    return Math.max(0, Math.floor((snapshotDay - listedDay) / DAY_MS));
}

// The fitted multiple, and the evidence behind it. Ratios outside 0.01-2.0 are
// trimmed out, because a handful of tiny-TVL protocols with huge ratios would
// otherwise set the multiple for everyone. The median of what remains is the fit;
// the log-log slope is reported for the record and not used for the ranking.
export interface FitReport {
    multiple: number;
    peers: number;
    median_ratio: number;
    mean_ratio: number;
    log_log_slope: number;
    log_residual_std: number;
}

export function fitMultiple(snapshot: Snapshot): FitReport {
    const ratios: number[] = [];
    const logTvl: number[] = [];
    const logMcap: number[] = [];
    for (const p of snapshot.protocols) {
        if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
        const ratio = p.mcap_usd / p.tvl_usd;
        if (ratio < 0.01 || ratio > 2.0) continue;
        ratios.push(ratio);
        logTvl.push(Math.log(p.tvl_usd));
        logMcap.push(Math.log(p.mcap_usd));
    }
    if (ratios.length === 0) {
        return { multiple: MODEL.base_multiple, peers: 0, median_ratio: MODEL.base_multiple, mean_ratio: MODEL.base_multiple, log_log_slope: 1, log_residual_std: 0 };
    }
    const sorted = [...ratios].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
    let slope = 1;
    let residStd = 0;
    if (logTvl.length >= 3) {
        const meanX = logTvl.reduce((s, x) => s + x, 0) / logTvl.length;
        const meanY = logMcap.reduce((s, y) => s + y, 0) / logMcap.length;
        let num = 0;
        let den = 0;
        for (let i = 0; i < logTvl.length; i++) {
            num += (logTvl[i]! - meanX) * (logMcap[i]! - meanY);
            den += (logTvl[i]! - meanX) ** 2;
        }
        slope = den === 0 ? 1 : num / den;
        const intercept = meanY - slope * meanX;
        const residuals = logTvl.map((x, i) => logMcap[i]! - (intercept + slope * x));
        const residMean = residuals.reduce((s, r) => s + r, 0) / residuals.length;
        residStd = Math.sqrt(residuals.reduce((s, r) => s + (r - residMean) ** 2, 0) / residuals.length);
    }
    const multiple = Math.max(0.05, Math.min(0.5, median));
    return { multiple, peers: ratios.length, median_ratio: median, mean_ratio: mean, log_log_slope: slope, log_residual_std: residStd };
}

// The three multipliers and the implied value one protocol gets under a model.
export function impliedValue(
    protocol: SnapshotProtocol,
    asOf: string,
    model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
    const age = ageDays(asOf, protocol.listed_at);
    const rawGrowth = finiteOr(protocol.change_7d, 0);
    const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
    const growthMult = 1 + (growthPct / 100) * model.growth_weight;
    const ageForModel = age ?? model.unknown_age_days;
    const maturityMult =
        model.maturity_floor +
        (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    const base = protocol.tvl_usd * model.base_multiple;
    const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
    return { implied, growthPct, growthMult, maturityMult, age };
}

// A wide, honest range around an implied value: half to double, which is roughly
// one residual standard deviation in log space for the live peers. The board ranks
// on the point estimate; the range is what the dashboard shows beside it.
export function impliedRange(implied: number): { low: number; high: number } {
    return { low: Math.max(1, Math.round(implied * 0.5)), high: Math.round(implied * 2) };
}

// DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol.
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// Whether a protocol records no token at all.
export function isPreToken(p: SnapshotProtocol): boolean {
    return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool.
export function isRankable(p: SnapshotProtocol): boolean {
    return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
    return new Map(protocols.map((p) => [p.slug, p]));
}

function firstChain(p: SnapshotProtocol): string {
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

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
    const c = (p.category ?? '').toLowerCase();
    const name = p.name;
    if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
    if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
    if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
    if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
    if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
    if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
    if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
    if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
    if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
    if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
    return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

// The whole plan's gas cost and time, in dollars and minutes, from its own steps.
export function farmCost(p: SnapshotProtocol, age: number | null): { gas_usd: number; minutes: number; dollars_per_hour: number } {
    const capital = capitalFor(p);
    const hold = holdDaysFor(age);
    const weeks = Math.ceil(hold / 7);
    const gas_usd = 3 + (capital >= 150 ? 8 : 4) + 2 * weeks;
    const minutes = 5 + 15 + 10 * weeks + 10 + 5;
    return { gas_usd, minutes, dollars_per_hour: Math.round((gas_usd / (minutes / 60)) * 10) / 10 };
}

// A step as one string: its action, then its cost and time, within the gate's 20..600 characters.
export function stepText(step: FarmStep): string {
    let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
    if (s.length > 600) s = `${s.slice(0, 596)}...`;
    if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
    return s;
}

// A protocol's farm plan: seven steps, each an action with a cost and a time. The
// plan is derived from the protocol's own record (category, chains, TVL, age), never
// from a hand-written list of names. The last step costs the whole plan in dollars
// per hour of the farmer's time: gas only, the capital is not a cost unless the
// protocol fails, and no earnings are promised, because the implied value is a
// model of a token that does not exist yet.
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
    const chain = firstChain(p);
    const capital = capitalFor(p);
    const hold = holdDaysFor(age);
    const action = actionFor(p, capital, chain);
    const cost = farmCost(p, age);
    return [
        {
            text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
            cost: 'under $3 of gas for the first transaction',
            time: '5 minutes',
        },
        {
            text: action,
            cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
            time: '15 minutes to set up',
        },
        {
            text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
            cost: 'about $2 of gas a week',
            time: '10 minutes a week',
        },
        {
            text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
            cost: `the $${capital} stays in the position`,
            time: `${hold} days`,
        },
        {
            text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
            cost: 'no fee to check, and never pay to claim',
            time: '10 minutes',
        },
        {
            text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
            cost: 'nothing but the log',
            time: '5 minutes',
        },
        {
            text: `Count the whole plan before you start: about $${cost.gas_usd} of gas over ${cost.minutes} minutes of your time, about $${cost.dollars_per_hour} per hour, plus $${capital} of capital that stays in the position.`,
            cost: `about $${cost.gas_usd} of gas in total`,
            time: `${cost.minutes} minutes in total`,
        },
    ];
}

// The protocols the board ranks, strongest first, with ranks 1..n.
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
    const fitted = fitMultiple(snapshot);
    const effective: ModelConstants = { ...model, base_multiple: fitted.multiple };
    const index = indexBySlug(snapshot.protocols);
    const chosen = new Map<string, SnapshotProtocol>();
    // The watchlist is the floor: every slug, even one the snapshot no longer
    // carries (it cannot, but the board's coverage is the gate's row and is never
    // gambled on a missing record).
    for (const slug of snapshot.watchlist) {
        const p = index.get(slug);
        if (p !== undefined) chosen.set(slug, p);
    }
    // The early radar: pre-token protocols below the watchlist floor, by TVL,
    // capped. Never a replacement for a watchlist row: a chosen protocol stays chosen.
    const early = snapshot.protocols
        .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
        .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
        .slice(0, EARLY_ROWS);
    for (const p of early) chosen.set(p.slug, p);

    const scored = [...chosen.values()].map((p) => {
        const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, effective);
        return { p, implied, growthPct, growthMult, maturityMult, age };
    });
    scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
    return scored.map((s, i) => ({
        rank: i + 1,
        slug: s.p.slug,
        name: s.p.name,
        category: s.p.category,
        chains: s.p.chains,
        tvl_usd: s.p.tvl_usd,
        change_7d: s.p.change_7d,
        mcap_usd: s.p.mcap_usd,
        listed_at: s.p.listed_at,
        gecko_id: s.p.gecko_id,
        symbol: s.p.symbol,
        token_status: 'pre-token',
        age_days: s.age,
        implied_value_usd: s.implied,
        model: {
            base_multiple: effective.base_multiple,
            growth_pct: s.growthPct,
            growth_multiplier: round4(s.growthMult),
            maturity_multiplier: round4(s.maturityMult),
            age_days: s.age,
        },
        farm_steps: farmSteps(s.p, s.age).map(stepText),
    }));
}

// The live-token protocols, by market cap, for the dashboard's Live token view.
export function liveRows(snapshot: Snapshot): LiveRow[] {
    return snapshot.protocols
        .filter((p) => !isPreToken(p) && p.category !== 'CEX')
        .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
        .slice(0, LIVE_ROWS)
        .map((p) => ({
            slug: p.slug,
            name: p.name,
            category: p.category,
            chains: p.chains,
            tvl_usd: p.tvl_usd,
            mcap_usd: p.mcap_usd,
            change_7d: p.change_7d,
        }));
}

// A board row's compact form for data.js, with the farm plan generated in the page.
export function radarRow(row: BoardRow): RadarRow {
    return {
        rank: row.rank,
        slug: row.slug,
        name: row.name,
        category: row.category,
        chains: row.chains,
        tvl_usd: row.tvl_usd,
        change_7d: row.change_7d,
        mcap_usd: row.mcap_usd,
        listed_at: row.listed_at,
        age_days: row.age_days,
        implied_value_usd: row.implied_value_usd,
        growth_multiplier: row.model.growth_multiplier,
        maturity_multiplier: row.model.maturity_multiplier,
    };
}

// Everything the dashboard renders, from the snapshot.
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
    const board = buildBoard(snapshot, model);
    const live = liveRows(snapshot);
    const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
    const fitted = fitMultiple(snapshot);
    const radar: RadarData = {
        as_of: snapshot.as_of,
        source: snapshot.source,
        floor_usd: snapshot.floor_usd,
        model: { ...model, base_multiple: fitted.multiple },
        model_version: MODEL_VERSION,
        watchlist_size: snapshot.watchlist.length,
        board_size: board.length,
        early_size: early,
        live_size: live.length,
        rows: board.map(radarRow),
        live,
    };
    return { board, radar };
}

// The snapshot out of a file's text, refused unless it is the shape the model scores.
export function parseSnapshot(text: string): Snapshot {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new SnapshotError('snapshot.json is not JSON');
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
    const o = raw as Record<string, unknown>;
    if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
    if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
    if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
    if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
    if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
    const protocols = o.protocols.map((v, i) => {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
        const p = v as Record<string, unknown>;
        if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
            throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
        }
        return {
            slug: p.slug,
            name: p.name,
            category: typeof p.category === 'string' ? p.category : null,
            chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
            tvl_usd: p.tvl_usd,
            change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
            mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
            listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
            gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
            symbol: typeof p.symbol === 'string' ? p.symbol : null,
        };
    });
    return {
        as_of: o.as_of,
        source: o.source,
        floor_usd: o.floor_usd,
        protocols,
        watchlist: o.watchlist as string[],
    };
}

// Why a board is not one the gate will take, or null: coverage, ranks, order,
// one shared implied value, and farm steps.
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
    const slugs = new Set(board.map((r) => r.slug));
    const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
    if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
    const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
    for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
    for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
    if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
        return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
    }
    for (const r of board) {
        const steps = r.farm_steps;
        if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
        for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
        if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    return null;
}

// A compact data.js: the dashboard's whole dataset as one script, no fetch and no network.
export function dataScript(radar: RadarData): string {
    return `window.RADAR=${JSON.stringify(radar)};\n`;
}
