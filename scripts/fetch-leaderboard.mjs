#!/usr/bin/env node
/**
 * Pulls the Rainbet affiliate wager totals for the current competition cycle,
 * masks the usernames, and writes the static JSON the site reads.
 *
 * Endpoint: GET /v1/external/affiliates?start_at=YYYY-MM-DD&end_at=YYYY-MM-DD&key=...
 * Response: { affiliates: [{ username, id, wagered_amount }], cache_updated_at }
 * The API already returns rows sorted by wagered_amount descending; we sort
 * anyway rather than depend on it.
 *
 * GENERATED FILE. The constants below are written by new-creator.mjs from
 * creators/wozbets.json, which also writes CYCLE_MODE, CYCLE_START_DAY and TZ
 * into assets/app.js. Change the config and regenerate — editing one file alone
 * makes the countdown disagree with the data.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, access, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = 'https://services.rainbet.com/v1/external/affiliates';

/* --8<-- pure logic: constants, the cycle model and the board builder.
   test/run-tests.mjs extracts everything between these fences verbatim and
   table-tests it, so the code under test is the code that ships. --8<-- */
const TZ = 'Europe/London';
/** 'monthly' = 1st to the last day of the month. 'offset' = day N to day N-1 of the next month. */
const CYCLE_MODE = 'monthly';
const CYCLE_START_DAY = 1;
/** Highest first. Index i is the prize for rank i+1; everyone past the end gets 0. */
const PRIZES = [100,60,40,30,20];
/** Rows rendered before the "show all" toggle. Every player is still shipped so search can find them. */
const BOARD_SIZE = 25;
/**
 * The first cycle this competition ran, as a cycle id, or '' for no limit.
 * Rainbet data exists for months before the leaderboard launched, and archiving
 * one of those would publish a "winners" table for a month in which nobody was
 * competing and no prizes were paid. Earlier cycles are never archived.
 */
const FIRST_CYCLE = '2026-09-01';

/** Today's date in the leaderboard timezone, as { year, month, day }. */
function todayInTz() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

const pad = (n) => String(n).padStart(2, '0');

function previousMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function nextMonth(year, month) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** Day count of a month. Date.UTC(y, m, 0) is the last day of month m (1-based). */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The cycle opening in the given month.
 *
 * monthly: the 1st to the month's real last day, so February and 31-day months
 * both come out right.
 *
 * offset: opens on day N and closes on day N-1 of the following month. N is
 * constrained to 2-28, so both the start day and the end day (N-1, landing in
 * 1-27) exist in every month including a non-leap February. 29 is not safe even
 * though its end day is: a cycle opening on the 29th has no start date in a
 * 28-day February. Consecutive cycles tile the timeline with no gap and no
 * overlap.
 */
function cycleStartingIn(year, month) {
  if (CYCLE_MODE === 'monthly') {
    const start = `${year}-${pad(month)}-01`;
    return { id: start, start, end: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}` };
  }
  const end = nextMonth(year, month);
  const start = `${year}-${pad(month)}-${pad(CYCLE_START_DAY)}`;
  return {
    id: start,
    start,
    end: `${end.year}-${pad(end.month)}-${pad(CYCLE_START_DAY - 1)}`,
  };
}

/** The cycle a given date falls inside. */
function cycleContaining({ year, month, day }) {
  if (CYCLE_MODE === 'monthly') return cycleStartingIn(year, month);
  if (day < CYCLE_START_DAY) {
    const prev = previousMonth(year, month);
    return cycleStartingIn(prev.year, prev.month);
  }
  return cycleStartingIn(year, month);
}

/** The cycle that closed immediately before the given one. */
function cycleBefore(cycle) {
  const [y, m] = cycle.start.split('-').map(Number);
  const prev = previousMonth(y, m);
  return cycleStartingIn(prev.year, prev.month);
}

/**
 * Masks the middle of a username so players can still recognise their own row
 * without the board publishing anyone's full handle.
 */
function maskUsername(name) {
  const chars = [...name];
  if (chars.length <= 2) return `${chars[0] ?? '*'}**`;
  if (chars.length <= 5) return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars.at(-1)}`;
  return `${chars.slice(0, 2).join('')}${'*'.repeat(chars.length - 4)}${chars.slice(-2).join('')}`;
}

/** Search token: the site hashes what the player types and compares locally. */
function searchHash(name) {
  return createHash('sha256').update(name.trim().toLowerCase()).digest('hex').slice(0, 16);
}

function buildBoard(payload, cycle) {
  const rows = payload.affiliates
    .map((a) => ({ username: String(a.username ?? ''), wagered: Number(a.wagered_amount) }))
    .filter((a) => a.username && Number.isFinite(a.wagered) && a.wagered > 0)
    .sort((a, b) => b.wagered - a.wagered);

  const entries = rows.map((row, i) => ({
    rank: i + 1,
    masked: maskUsername(row.username),
    hash: searchHash(row.username),
    wagered: Number(row.wagered.toFixed(2)),
    prize: PRIZES[i] ?? 0,
  }));

  return {
    cycle: cycle.id,
    periodStart: cycle.start,
    periodEnd: cycle.end,
    cycleMode: CYCLE_MODE,
    cycleStartDay: CYCLE_START_DAY,
    timezone: TZ,
    prizePool: PRIZES.reduce((a, b) => a + b, 0),
    prizes: PRIZES,
    boardSize: BOARD_SIZE,
    totalWagered: Number(rows.reduce((sum, r) => sum + r.wagered, 0).toFixed(2)),
    playerCount: rows.length,
    cacheUpdatedAt: payload.cache_updated_at ?? null,
    updatedAt: new Date().toISOString(),
    entries,
  };
}

/* --8<-- end of extracted region --8<-- */

const KEY = process.env.RAINBET_API_KEY;
if (!KEY) {
  console.error('RAINBET_API_KEY is not set.');
  process.exit(1);
}

async function fetchCycle({ start, end }) {
  const url = `${ENDPOINT}?start_at=${start}&end_at=${end}&key=${encodeURIComponent(KEY)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const body = await res.text();
  if (!res.ok) throw new Error(`Rainbet API ${res.status}: ${body.slice(0, 200)}`);

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(`Rainbet API returned non-JSON: ${body.slice(0, 200)}`);
  }
  if (!Array.isArray(json.affiliates)) throw new Error(`Unexpected payload: ${body.slice(0, 200)}`);
  return json;
}

const exists = (p) => access(p).then(() => true, () => false);

async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote ${path}`);
}

const current = cycleContaining(todayInTz());
const board = buildBoard(await fetchCycle(current), current);
await writeJson(join(ROOT, 'data', 'leaderboard.json'), board);
console.log(`${current.start}..${current.end}: ${board.playerCount} players, $${board.totalWagered} wagered`);

// Archive the cycle that just closed so the site can show its winners. Once a
// cycle is over its totals are final, so an existing archive is never refetched.
const previous = cycleBefore(current);
const archivePath = join(ROOT, 'data', 'history', `${previous.id}.json`);
if (FIRST_CYCLE && previous.id < FIRST_CYCLE) {
  console.log(`${previous.id} is before the first cycle (${FIRST_CYCLE}) — not archiving`);
} else if (await exists(archivePath)) {
  console.log(`${previous.id} already archived`);
} else {
  try {
    const previousBoard = buildBoard(await fetchCycle(previous), previous);
    if (previousBoard.playerCount > 0) {
      await writeJson(archivePath, previousBoard);
    } else {
      console.log(`${previous.start}..${previous.end} has no wagers, nothing to archive`);
    }
  } catch (err) {
    console.warn(`could not archive ${previous.id}: ${err.message}`);
  }
}

// Index of closed cycles, newest first, so the site can list past winners.
// Rebuilt from disk each run so adding or removing an archive by hand stays consistent.
const historyDir = join(ROOT, 'data', 'history');
// A brand-new site whose first archive attempt found no wagers has no history
// directory yet, and readdir would throw before the index could be written.
await mkdir(historyDir, { recursive: true });
const cycles = (await readdir(historyDir))
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .map((f) => f.replace('.json', ''))
  .sort()
  .reverse()
  .map((id) => {
    const [y, m] = id.split('-').map(Number);
    const { start, end } = cycleStartingIn(y, m);
    return { id, start, end };
  });
await writeJson(join(historyDir, 'index.json'), { cycles });
