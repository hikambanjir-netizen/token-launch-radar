// Token launch radar — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, prices every pre-token protocol with the model
// in lib/model.ts, and writes the entry's outputs:
//   board.json    the ranked board the gate scores
//   data.js       the same board, as the dashboard's data file
//   dashboard/    the page (copied from this repository)
//   screenshots/  three renders of the page (copied from this repository)
//   dossier.json  buildDossier's summary of the dashboard and screenshots
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;

/** Value of --name in argv (either "--name v" or "--name=v"), else fallback. */
function argValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && args[at + 1] !== undefined) return args[at + 1]!;
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`radar: ${message}\n`);
  process.exit(1);
}

const inputArg = argValue('input', '/input');
const inputPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputPath)) fail(`no snapshot at ${inputPath} — pass --input <snapshot.json|dir>`);
const outDir = argValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model produced a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory tree of regular files, skipping dot-names at every level. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    const st = statSync(src);
    if (st.isDirectory()) copied.push(...copyTree(src, join(to, name)));
    else if (st.isFile()) {
      copyFileSync(src, join(to, name));
      copied.push(name);
    }
  }
  return copied;
}

const dashFiles = copyTree(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyTree(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (dashFiles.length === 0) fail('dashboard/ is empty — the page is part of the entry');
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images — hand in 3: board, detail, filtered`);
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
for (const name of shots) if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: not a plain file name`);

const dossier = buildDossier(outDir, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

process.stdout.write(
  `radar: ${snapshot.protocols.length} protocols (${radar.live_size} already tokenised, set aside), ` +
    `${snapshot.watchlist.length} watchlist, board of ${board.length} rows\n` +
    `radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length}), dossier.json (${dossier.length} bytes)\n`,
);
