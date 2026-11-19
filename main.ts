// This module drives the primary analysis pipeline by parsing the frozen input bundle,
// computing valuations for tokenless protocols, and exporting the sorted leaderboard, UI bundle, and snapshot previews.
// The resulting directory structure supplies complete artifacts for review and evaluation.
// and concludes by compiling the final verification dossier.
// Operating entirely deterministically, calculation timestamps derive strictly from the snapshot
// rather than system clocks, ensuring identical output across repeated evaluations.
// This engine processes the locked snapshot file, evaluates every protocol using the scoring model, and generates the leaderboard, dashboard assets, visual captures, and verification report using the frozen date instead of the system time.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';
const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf('--' + name);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith('--' + name + '='));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}
const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write('token radar: no snapshot at ' + inputFile + ': pass --input <snapshot.json|directory> or mount the sealed /input\n');
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write('token radar: the model wrote a board the gate refuses: ' + issue + '\n');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), JSON.stringify({ rows: board }) + '\n');
writeFileSync(join(out, 'data.js'), dataScript(radar));
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}
copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));

// This summarized leaderboard dataset is dynamically reconstructed from the current execution output,
// preventing stale references whenever underlying snapshot parameters evolve over time.
// It shares the identical structural array schema defined within the interface data-rows module.
// The compact table data is freshly rebuilt directly from the board generated in this execution cycle,
// ensuring the output copy remains completely fresh and synchronizes instantly whenever snapshot inputs change.
function dataRowsText(board: BoardRow[]): string {
  const lines: string[] = [];
  lines.push('// Token Radar - compact board data. Mirrors board.json row for row:');
  lines.push('// [rank, slug, tvl_usd, multiple, implied_value_usd, age_days, change_7d].');
  lines.push('// Multiple is at full precision, so every implied value recomputes from this file alone:');
  lines.push('// implied = round( tvl_usd x multiple x (1 + clamp(change_7d, ' + MODEL.growth_floor + ', ' + MODEL.growth_cap + ') / 100 x 0.5) x (' + MODEL.maturity_floor + ' + min(age_days, 1095) / 1095 x ' + MODEL.maturity_range + ') )');
  lines.push('// age_days = days since DefiLlama first tracked the protocol (listed_at);');
  lines.push('// unknown listed_at counts as 365 days; unknown change_7d counts as 0.');
  lines.push('// Farm steps live in board.json; they cannot fit the dossier text cap, so they are not here.');
  lines.push('window.BOARD_ROWS=[');
  for (const r of board) {
    lines.push('[' + r.rank + ',"' + r.slug + '",' + r.tvl_usd + ',' + r.model.base_multiple_exact + ',' + r.implied_value_usd + ',' + (r.age_days === null ? 'null' : r.age_days) + ',' + (r.change_7d === null ? 'null' : r.change_7d) + '],');
  }
  lines.push('];');
  return lines.join('\n') + '\n';
}
writeFileSync(join(out, 'dashboard', 'data-rows.js'), dataRowsText(board));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write('token radar: screenshots/ holds ' + shots.length + ' images: hand in 3, the board, a detail view and a filtered view\n');
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write('token radar: screenshots/' + name + ': a name is letters, digits and . _ -, 1 to 128 characters\n');
    process.exit(1);
  }
}
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));
process.stdout.write(
  'token radar: ' + snapshot.protocols.length + ' protocols, ' + snapshot.watchlist.length + ' on the watchlist, ' + board.length + ' rows scored (' + radar.early_size + ' early, ' + radar.live_size + ' live set aside)\n' +
  'token radar: wrote ' + join(out, 'board.json') + ', ' + join(out, 'data.js') + ', dashboard, screenshots (' + shots.length + ' images) and dossier.json\n',
);
