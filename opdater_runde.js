// Køres EFTER hver runde er slut. Henter aktuel Pris fra holdet.dk,
// opdaterer Pris-kolonnen og tilføjer en ny "Vækst Runde N"-kolonne
// med differencen mellem ny og gammel Pris. Runde-nummeret findes
// automatisk ud fra hvor mange "Vækst Runde X"-kolonner der allerede
// findes i CSV-filen, så scriptet bare skal køres igen og igen efter
// hver af de 8 runder.

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');

const GAME_ID = 616;
const API = 'https://nexus-app-fantasy-fargate.holdet.dk/api';
const CONCURRENCY = 40;
const CSV_PATH = 'holdet_runde1_stats.csv';
const TOTAL_ROUNDS = 8;

// Disse fire holds Pris/Vækst Runde 1 indeholder allerede vækst fra både
// runde 1 og 2 (deres runde 2-kampe var spillet, før det oprindelige
// datasæt blev hentet). De springes derfor over ved netop runde 2-
// opdateringen, så de ikke får runde 2-væksten talt med to gange.
// Fra runde 3 og frem er deres Pris igen et korrekt udgangspunkt, og de
// opdateres normalt som alle andre hold.
const SKIP_FOR_ROUND = {
  round: 2,
  countries: ['Schweiz', 'Tjekkiet', 'Sydafrika', 'Bosnien-Hercegovina'],
};

async function fetchJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function batchFetch(ids, fn, size) {
  const results = [];
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    results.push(...await Promise.all(chunk.map(fn)));
    process.stdout.write(`\r  ${Math.min(i + size, ids.length)}/${ids.length}`);
  }
  console.log();
  return results;
}

function parseCsvLine(line) {
  const vals = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { vals.push(cur); cur = ''; }
    else cur += ch;
  }
  vals.push(cur);
  return vals;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

(async () => {
  // --- Læs eksisterende CSV ---
  const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
  const lines = raw.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const o = {};
    headers.forEach((h, i) => o[h] = (vals[i] ?? '').trim());
    return o;
  });

  const existingRoundCols = headers.filter(h => /^Vækst Runde \d+$/.test(h));
  const nextRound = existingRoundCols.length + 1;

  if (nextRound > TOTAL_ROUNDS) {
    console.log(`Alle ${TOTAL_ROUNDS} runder er allerede registreret i CSV-filen. Intet at opdatere.`);
    return;
  }

  console.log(`Opdaterer til runde ${nextRound} af ${TOTAL_ROUNDS}...`);
  const newCol = `Vækst Runde ${nextRound}`;

  // --- Hent aktuelle priser fra holdet.dk ---
  console.log('Henter aktuel spillerliste fra holdet.dk...');
  const list = await fetchJson(`${API}/games/${GAME_ID}/players`);
  console.log(`  ${list.items.length} spillere`);

  console.log('Henter detaljer (navn, hold, pris)...');
  const details = await batchFetch(list.items.map(p => p.id), async (id) => {
    try { return await fetchJson(`${API}/games/${GAME_ID}/players/${id}`); }
    catch { return null; }
  }, CONCURRENCY);

  // --- Lookup ny data pr. spiller (Navn + Hold som nøgle) ---
  const fresh = new Map();
  for (const d of details) {
    if (!d) continue;
    const navn = `${d.person?.firstName ?? ''} ${d.person?.lastName ?? ''}`.trim();
    const hold = d.team?.name ?? '';
    fresh.set(navn + '|' + hold, { price: d.price ?? 0, startPrice: d.startPrice ?? 0 });
  }

  // --- Opdater hver række ---
  let updated = 0;
  let missing = 0;
  let skipped = 0;
  const mismatches = [];
  const matchedKeys = new Set();
  const skipThisRound = nextRound === SKIP_FOR_ROUND.round;

  for (const row of rows) {
    if (skipThisRound && SKIP_FOR_ROUND.countries.includes(row.Hold)) {
      skipped++;
      row[newCol] = row['Vækst Runde 1'];
      continue;
    }

    const key = row.Navn + '|' + row.Hold;
    const f = fresh.get(key);
    if (!f) {
      missing++;
      row[newCol] = '';
      continue;
    }
    matchedKeys.add(key);

    const oldPris = parseInt(row.Pris) || 0;
    const startpris = parseInt(row.Startpris) || 0;
    const roundVaekst = f.price - oldPris;

    // Kontrol: summen af alle runde-vækst-kolonner skal matche (ny pris - startpris)
    const sumPriorRounds = existingRoundCols.reduce((s, c) => s + (parseInt(row[c]) || 0), 0);
    const expectedCumulative = sumPriorRounds + roundVaekst;
    const actualCumulative = f.price - startpris;

    if (expectedCumulative !== actualCumulative) {
      mismatches.push(`${row.Navn} (${row.Hold}): beregnet kumulativ ${expectedCumulative}, API kumulativ ${actualCumulative}`);
    }

    row.Pris = f.price;
    row[newCol] = roundVaekst;
    row['Vækst%'] = startpris ? ((actualCumulative / startpris) * 100).toFixed(2) : '0.00';
    updated++;
  }

  const newPlayers = [...fresh.keys()].filter(k => !matchedKeys.has(k) && !rows.some(r => r.Navn + '|' + r.Hold === k));

  // --- Skriv opdateret CSV (ny kolonne indsættes lige før "Vækst%") ---
  const newHeaders = [...headers];
  const insertAt = newHeaders.indexOf('Vækst%');
  newHeaders.splice(insertAt === -1 ? newHeaders.length : insertAt, 0, newCol);

  const csv = [
    newHeaders.join(','),
    ...rows.map(r => newHeaders.map(h => csvEscape(r[h])).join(','))
  ].join('\n');

  fs.writeFileSync(CSV_PATH, '﻿' + csv, 'utf8');

  console.log(`\nOpdateret: ${updated} spillere`);
  console.log(`Ikke fundet i ny data (ude af spillet/omdøbt): ${missing} spillere`);
  if (skipped) {
    console.log(`Sprunget over (${SKIP_FOR_ROUND.countries.join(', ')}) pga. runde 1+2-sammenblanding: ${skipped} spillere`);
  }
  if (newPlayers.length) {
    console.log(`Nye spillere i API'en uden match i CSV: ${newPlayers.length} (tilføjes ikke automatisk)`);
  }

  if (mismatches.length) {
    console.log(`\n⚠ ${mismatches.length} kontrol-advarsler (vækst stemmer ikke med kumulativ pris):`);
    mismatches.slice(0, 20).forEach(m => console.log('  ' + m));
  } else {
    console.log('\nKontrol OK: alle spilleres samlede runde-vækst stemmer med (Pris - Startpris) fra API.');
  }

  console.log(`\nGemt: ${CSV_PATH} med ny kolonne "${newCol}"`);
})().catch(e => { console.error('FEJL:', e.message); process.exit(1); });
