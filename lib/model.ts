// Token launch radar model.
//
// The implied value of a protocol that records no token is derived only from
// the snapshot's own figures, in three transparent steps:
//
//   1. A price for TVL. Protocols in the snapshot that DO have a token give a
//      market-cap-to-TVL multiple for their category; the median of each
//      category (blended with the global median when a category is thin) is
//      the price of one dollar of TVL in that line of business.
//   2. A momentum adjustment from change_7d: TVL that is growing fast earns
//      a premium, TVL that is bleeding is discounted, clamped so one wild
//      week cannot dominate the board.
//   3. A track-record adjustment from listed_at: the longer a protocol has
//      run with no token, the closer it is priced to the full category
//      multiple; a protocol listed last month is priced at a discount.
//
// implied = TVL x category multiple x momentum factor x track-record factor.
//
// The board ranks every watchlist protocol plus the strongest pre-token
// protocols below the watchlist floor. Protocols whose token already trades
// are never ranked: they are the evidence base, not the quarry.

export interface Protocol {
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
  protocols: Protocol[];
  watchlist: string[];
}

export interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface Scored extends Row {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  multiple: number;
  momentum: number;
  track: number;
  days_listed: number | null;
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  total_protocols: number;
  watchlist_size: number;
  live_size: number;
  board_size: number;
  global_multiple: number;
  category_multiples: { category: string; multiple: number; samples: number }[];
  rows: Scored[];
}

/** Parse and lightly validate the sealed snapshot text. */
export function parseSnapshot(text: string): Snapshot {
  const snap = JSON.parse(text) as Snapshot;
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    throw new Error('snapshot is missing its protocols or watchlist arrays');
  }
  return snap;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Deterministic 32-bit FNV-1a hash of a slug, for stable phrasing choices. */
function slugHash(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Whole days between the protocol's listing day and the snapshot's as_of day. */
function daysListed(snap: Snapshot, p: Protocol): number | null {
  if (p.listed_at === null) return null;
  const start = Date.parse(`${p.listed_at}T00:00:00Z`);
  const end = Date.parse(`${snap.as_of}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** Momentum factor from the seven-day TVL change (per cent), clamped hard. */
function momentumFactor(change: number | null): number {
  if (change === null) return 1;
  return 1 + clamp(change, -60, 150) * 0.0022;
}

/** Track-record factor: ramps from 0.72 for a brand-new listing toward 1.10. */
function trackFactor(days: number | null): number {
  if (days === null) return 0.92;
  return 0.72 + 0.38 * (1 - Math.exp(-days / 620));
}

interface Multiples {
  global: number;
  byCategory: Map<string, { multiple: number; samples: number }>;
}

/** Category mcap/TVL medians from the protocols whose token already trades. */
function computeMultiples(snap: Snapshot): Multiples {
  const all: number[] = [];
  const buckets = new Map<string, number[]>();
  for (const p of snap.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(ratio);
    else buckets.set(key, [ratio]);
  }
  const global = all.length > 0 ? median(all) : 0.2;
  const byCategory = new Map<string, { multiple: number; samples: number }>();
  for (const [key, values] of buckets) {
    const med = median(values);
    // Shrinkage: a category's median is weighted by its sample count
    // against the global median, so a thin category (one tokenised
    // protocol at 400x TVL) cannot price a whole line of business.
    const shrunk = (values.length * med + 4 * global) / (values.length + 4);
    // Winsorised: no category prices TVL above 10x or below a fifth of
    // the global rate, whatever its own outliers say.
    const multiple = clamp(shrunk, global / 5, global * 10);
    byCategory.set(key, { multiple, samples: values.length });
  }
  return { global, byCategory };
}

function multipleFor(mults: Multiples, category: string | null): { multiple: number; samples: number } {
  const hit = mults.byCategory.get(category ?? 'Uncategorised');
  return hit ?? { multiple: mults.global, samples: 0 };
}

/** Compact dollar formatting used inside farm steps, e.g. $2.5k, $1.2M. */
function money(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}k`;
  return `$${Math.round(value)}`;
}

/** A position size scaled to the protocol's TVL, so steps stay plausible. */
function stakeFor(p: Protocol): number {
  if (p.tvl_usd >= 1e9) return 5000;
  if (p.tvl_usd >= 1e8) return 2500;
  if (p.tvl_usd >= 2e7) return 1000;
  return 500;
}

const CADENCE = [
  'Repeat weekly for 8-12 weeks; steady, varied activity reads as a real user, not a burst.',
  'Keep the routine running 2-3 months; consistency across snapshots matters more than one big week.',
  'Spread the actions over at least 6 weeks and vary amounts and times of day.',
];

/**
 * Concrete farm plan for one protocol, generated from its category and
 * chains. Every step names an action, an indicative cost and a time frame;
 * the wording rotates by slug hash so no two categories read alike.
 */
export function farmSteps(p: Protocol): string[] {
  const h = slugHash(p.slug);
  const chain = p.chains[0] ?? 'Ethereum';
  const chainNote = p.chains.length > 1
    ? `It runs on ${p.chains.length} chains (${p.chains.slice(0, 3).join(', ')}${p.chains.length > 3 ? ', …' : ''}); pick the cheapest one for fees`
    : `It runs on ${chain}; budget gas there`;
  const stake = money(stakeFor(p));
  const cat = p.category ?? 'DeFi';
  const cadence = CADENCE[h % CADENCE.length]!;
  const open = `Open ${p.name} on ${chain} and connect a fresh wallet you control end to end. ${chainNote}. Cost: gas only, about $1-5; time: 10 minutes.`;
  const track = `Keep a simple log of every ${p.name} action (date, amount, tx hash) from day one; if a snapshot or eligibility check is ever announced you can prove the history in minutes. Cost: $0; time: 5 minutes a week.`;
  const community = `Join the ${p.name} Discord and forum, vote in any governance polls and finish any published testnet or quest tasks. Cost: $0; time: 30-45 minutes a week.`;

  let core: string[];
  switch (cat) {
    case 'Lending':
      core = [
        `Supply ${stake} of a blue-chip asset (ETH or a major stablecoin) as collateral on ${p.name} and leave it supplied; supplied balances are the balance most lending launches reward. Cost: ${stake} capital plus ~$2-8 gas; time: 15 minutes.`,
        `Borrow 30-40% against the collateral and repay within the week, twice a month, so the wallet shows both sides of the market without risking liquidation. Cost: interest of a few dollars; time: 10 minutes per cycle.`,
      ];
      break;
    case 'Dexs':
      core = [
        `Swap ${stake} across 3-4 pairs on ${p.name} each week, mixing majors and long-tail pairs; aim for $5k-15k of cumulative volume over the season. Cost: swap fees plus ~$1-4 gas per swap; time: 15 minutes a week.`,
        `Add ${stake} to a tight liquidity pool for 2-3 weeks, then move it to a second pool; LPs who stay through volatility are the wallets a DEX launch usually favours. Cost: ${stake} capital, impermanent-loss risk; time: 20 minutes to set up.`,
      ];
      break;
    case 'CDP':
      core = [
        `Deposit ${stake} of ETH or LST collateral on ${p.name} and mint its stablecoin at a conservative 40-50% loan-to-value. Cost: ${stake} capital plus ~$3-10 gas; time: 20 minutes.`,
        `Hold or spend the minted stablecoin inside the ecosystem (LP it or lend it) and adjust collateral monthly so the position survives a 30% drawdown. Cost: stability fees; time: 10 minutes a month.`,
      ];
      break;
    case 'Derivatives':
      core = [
        `Deposit ${stake} as margin on ${p.name} and open small hedged trades (long one venue, short another) so volume accrues without directional risk. Cost: ${stake} capital plus trading fees; time: 30 minutes a week.`,
        `Provide liquidity to its vault or insurance pool if it offers one, and keep the position for a full quarter. Cost: ${stake} capital; time: 15 minutes to set up.`,
      ];
      break;
    case 'Bridge':
    case 'Cross Chain Bridge':
    case 'Canonical Bridge':
      core = [
        `Bridge ${stake} to a chain you actually use via ${p.name}, then bridge a different asset back a week later; round trips on distinct routes count more than one big hop. Cost: bridge fees of roughly 0.05-0.3% plus gas; time: 15 minutes per hop.`,
        `Repeat with a second wallet pair of chains each month and keep the bridged funds working at the destination for at least a few days. Cost: gas on both ends; time: 20 minutes a month.`,
      ];
      break;
    case 'Liquid Staking':
    case 'Liquid Restaking':
    case 'Restaking':
    case 'Staking Pool':
      core = [
        `Stake ${stake} of ETH (or the accepted LST) through ${p.name} and hold the receipt token in the same wallet; unstaked-before-snapshot wallets are the classic miss. Cost: ${stake} capital; time: 10 minutes.`,
        `Put the receipt token to work in one integrated money market or LP so the wallet shows both staking and DeFi activity. Cost: gas only; time: 15 minutes.`,
      ];
      break;
    case 'RWA':
      core = [
        `Complete onboarding/KYC on ${p.name} early if its assets require it, then buy the smallest lot of its flagship real-world asset (often ${stake} or less). Cost: lot price plus onboarding time of 1-3 days.`,
        `Hold the position through at least two distribution or reporting cycles and vote in any holder polls. Cost: $0 beyond the position; time: 10 minutes a month.`,
      ];
      break;
    case 'Launchpad':
      core = [
        `Register on ${p.name}, complete its KYC tier and stake or hold its access asset if it uses one, sized near ${stake}. Cost: stake plus ~$5 gas; time: 30 minutes including KYC.`,
        `Take part in at least two sales or allocations, even small ones, and claim every refund/allocation on time. Cost: sale minimums; time: 20 minutes per sale.`,
      ];
      break;
    case 'Chain':
      core = [
        `Bridge ${stake} to the ${p.name} network and make it your wallet's home for a month: swaps, one lending position and one NFT mint. Cost: bridge fee plus cheap local gas; time: 1 hour to set up.`,
        `Use 3-4 native dApps weekly and pay gas in the chain's own asset; chain launches reward wallets whose activity is on-chain and recent. Cost: a few dollars of gas a week.`,
      ];
      break;
    default:
      core = [
        `Deposit or stake ${stake} in ${p.name}'s flagship ${cat} product on ${chain} and leave the position open; open positions at snapshot time are what most launches count. Cost: ${stake} capital plus ~$2-8 gas; time: 15 minutes.`,
        `Use a second feature of ${p.name} (a different pool, vault or market) with a smaller amount so the wallet is not a one-click visitor. Cost: ~$250-500 capital; time: 15 minutes.`,
      ];
      break;
  }
  return [open, ...core, cadenceStep(cadence, p), track, community].slice(0, 6);
}

function cadenceStep(cadence: string, p: Protocol): string {
  return `${cadence} On ${p.name} that means touching the position at least twice a month and never letting it sit fully idle for a whole quarter.`;
}

/** How many board rows to aim for, watchlist included. */
const BOARD_TARGET = 240;

/** Build the ranked board and the dashboard's data from the snapshot. */
export function buildRadar(snap: Snapshot): { board: Row[]; radar: Radar } {
  const mults = computeMultiples(snap);
  const watch = new Set(snap.watchlist);
  const scored: Scored[] = [];
  let live = 0;
  for (const p of snap.protocols) {
    if (p.mcap_usd !== null) {
      live++;
      continue;
    }
    const { multiple } = multipleFor(mults, p.category);
    const momentum = momentumFactor(p.change_7d);
    const days = daysListed(snap, p);
    const track = trackFactor(days);
    const raw = p.tvl_usd * multiple * momentum * track;
    scored.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: Math.max(1, Math.round(raw)),
      farm_steps: [],
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      watchlist: watch.has(p.slug),
      multiple,
      momentum,
      track,
      days_listed: days,
    });
  }
  scored.sort((a, b) =>
    b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1),
  );
  const chosen = scored.slice(0, BOARD_TARGET);
  // The watchlist is a floor: any watchlist protocol the cut missed comes in
  // and the weakest non-watchlist row makes room.
  const chosenSlugs = new Set(chosen.map((r) => r.slug));
  for (const s of scored) {
    if (s.watchlist && !chosenSlugs.has(s.slug)) {
      chosen.push(s);
      chosenSlugs.add(s.slug);
    }
  }
  while (chosen.length > BOARD_TARGET) {
    const idx = [...chosen].reverse().findIndex((r) => !r.watchlist);
    if (idx < 0) break;
    chosen.splice(chosen.length - 1 - idx, 1);
  }
  chosen.sort((a, b) =>
    b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1),
  );
  // Enforce the gate's shape: ranks 1..N, values never rising with rank.
  let prev = Number.POSITIVE_INFINITY;
  chosen.forEach((row, i) => {
    row.rank = i + 1;
    row.implied_value_usd = Math.max(1, Math.min(row.implied_value_usd, prev));
    prev = row.implied_value_usd;
  });
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  for (const row of chosen) row.farm_steps = farmSteps(bySlug.get(row.slug)!);
  const board: Row[] = chosen.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));
  const category_multiples = [...mults.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: Math.round(v.multiple * 1000) / 1000, samples: v.samples }))
    .sort((a, b) => b.samples - a.samples || (a.category < b.category ? -1 : 1));
  const radar: Radar = {
    as_of: snap.as_of,
    floor_usd: snap.floor_usd,
    total_protocols: snap.protocols.length,
    watchlist_size: snap.watchlist.length,
    live_size: live,
    board_size: board.length,
    global_multiple: Math.round(mults.global * 1000) / 1000,
    category_multiples,
    rows: chosen,
  };
  return { board, radar };
}

/** The dashboard's data file: one assignment the page's script reads. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** First reason the gate would refuse this board, or null when it is clean. */
export function boardIssue(board: Row[], snap: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows`;
  const slugs = new Set(board.map((r) => r.slug));
  for (const slug of snap.watchlist) if (!slugs.has(slug)) return `watchlist slug ${slug} is missing`;
  const known = new Set(snap.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!known.has(r.slug)) return `row names unknown slug ${r.slug}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const n = s.trim().length;
      if (n < 20 || n > 600) return `${r.slug} has a farm step of ${n} characters`;
    }
  }
  const sorted = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i]!.rank !== i + 1) return `ranks are not exactly 1..N at ${i}`;
    if (i > 0 && sorted[i]!.implied_value_usd > sorted[i - 1]!.implied_value_usd) return `value rises at rank ${i + 1}`;
  }
  if (board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) return 'all implied values are equal';
  return null;
}
