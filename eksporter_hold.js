// Samler de ideelle hold (mit guld- og sølvhold + alle venners anbefalede
// hold) for den nyeste runde, printer dem som markdown-tabeller, og
// gemmer dem alle i ét Excel-ark (et faneblad pr. hold).
//
// Køres efter opdater_runde.js, ideal_guldhold.js og ideal_solvhold.js.

const XLSX = require('xlsx');
const { computeGuldhold } = require('./ideal_guldhold');
const { computeSolvhold } = require('./ideal_solvhold');
const { computeVenAnbefalinger } = require('./ven_anbefalinger');
const { fmtKr } = require('./holdet_lib');

const POS_ORDER = { MV: 0, DEF: 1, MID: 2, ANG: 3 };
const POS_LABEL = { MV: 'Keeper', DEF: 'Forsvar', MID: 'Midtbane', ANG: 'Angreb' };

function squadRows(squad, vIdx, captainKey) {
  return squad
    .slice()
    .sort((a, b) => (POS_ORDER[a.pos] ?? 9) - (POS_ORDER[b.pos] ?? 9) || (b.vaekst[vIdx] || 0) - (a.vaekst[vIdx] || 0))
    .map(p => ({
      Position: POS_LABEL[p.pos] || p.pos,
      Navn: p.navn,
      Land: p.hold,
      Vækst: p.vaekst[vIdx] || 0,
      Kaptajn: p.key === captainKey ? 'Ja' : '',
    }));
}

function printMarkdownTable(title, rows) {
  console.log(`\n### ${title}\n`);
  console.log('| Position | Navn | Land | Vækst | Kaptajn |');
  console.log('|---|---|---|---|---|');
  for (const r of rows) {
    console.log(`| ${r.Position} | ${r.Navn} | ${r.Land} | ${fmtKr(r.Vækst)} | ${r.Kaptajn} |`);
  }
}

(async () => {
  const guld = computeGuldhold();
  const solv = computeSolvhold();
  const { friends, latestKnownRound, numRounds } = await computeVenAnbefalinger();

  const sheets = {}; // sheetName -> rows[]

  // --- Mit guldhold og sølvhold: seneste runde ---
  const guldLast = guld.rounds[guld.rounds.length - 1];
  const guldVIdx = guldLast.round - 1;
  const guldCaptain = guldLast.squad.reduce((a, p) => (p.vaekst[guldVIdx] || 0) > (a.vaekst[guldVIdx] || 0) ? p : a);
  const guldRows = squadRows(guldLast.squad, guldVIdx, guldCaptain.key);
  printMarkdownTable(`Mit GULDHOLD — Runde ${guldLast.round} (netto ${fmtKr(guld.cumulativeNetto)} over ${guld.numRounds} runder)`, guldRows);
  sheets['Mit Guldhold'] = guldRows;

  const solvLast = solv.rounds[solv.rounds.length - 1];
  const solvVIdx = solvLast.round - 1;
  const solvCaptain = solvLast.squad.reduce((a, p) => (p.vaekst[solvVIdx] || 0) > (a.vaekst[solvVIdx] || 0) ? p : a);
  const solvRows = squadRows(solvLast.squad, solvVIdx, solvCaptain.key);
  printMarkdownTable(`Mit SØLVHOLD — Runde ${solvLast.round} (netto ${fmtKr(solv.cumulativeNetto)} over ${solv.numRounds} runder)`, solvRows);
  sheets['Mit Sølvhold'] = solvRows;

  // --- Venners anbefalede hold: seneste runde ---
  for (const f of friends) {
    if (f.status !== 'ok') continue;
    const rec = f.recommendation;
    if (rec.swapsExhausted || !rec.rounds.length) continue;
    const last = rec.rounds[rec.rounds.length - 1];
    const vIdx = last.round - 1;
    const captain = last.squad.reduce((a, p) => (p.vaekst[vIdx] || 0) > (a.vaekst[vIdx] || 0) ? p : a);
    const rows = squadRows(last.squad, vIdx, captain.key);
    printMarkdownTable(`${f.navn} (${f.spil}) — anbefalet hold Runde ${last.round}`, rows);
    sheets[`${f.navn} (${f.spil})`] = rows;
  }

  // --- Skriv Excel-fil med ét faneblad pr. hold ---
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); // Excel-fanenavne maks 31 tegn
  }
  const outPath = `ideelle_hold_runde${Math.max(guldLast.round, solvLast.round)}.xlsx`;
  XLSX.writeFile(wb, outPath);
  console.log(`\nGemt: ${outPath} (${Object.keys(sheets).length} faneblade)`);
})().catch(e => { console.error('FEJL:', e.message); process.exit(1); });
