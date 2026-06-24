// Henter venneholdene fra et delt Google Sheet (offentligt tilgængeligt
// via "Alle med linket"-deling) og vurderer:
//   1) Om den valgte kaptajn i hver runde var den optimale (højeste vækst)
//   2) Hvilke spillerskift der burde have været foretaget for at komme
//      videre til den nyeste runde, ud fra om vennen spiller Guld
//      (ubegrænsede skift) eller Sølv (maks. 3 skift i alt).
//
// Arket forventes at have kolonnerne: Spiller, Spil, "Værdi efter Runde N"
// og "Opstilling Runde N" (for det højeste N vennen selv har udfyldt).
// Når en ny "Opstilling Runde N+1"-kolonne tilføjes med deres faktiske
// valg, bruges den automatisk som ny baseline, og evt. skift foretaget
// i virkeligheden meelm de to kendte opstillinger trækkes fra sølv-holdets
// resterende skift-budget.
//
// Køres efter hver opdatering af holdet_runde1_stats.csv.

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { MAX_PER_COUNTRY, loadPlayers, priceAtStartOfRound, fmtKr } = require('./holdet_lib');

const SHEET_ID = '1UIv0pgPzvA-jqG1ojHAxX_vWm_K5M8jJM-AGTVFdIlA';
const GID = '1401507306'; // fanen "Ark5"
const MAX_SWAPS_SOLV = 3;

const POS_MAP = { Keeper: 'MV', Forsvar: 'DEF', Midtbane: 'MID', Angreb: 'ANG' };

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

function parseDanishNum(v) {
  const s = String(v).trim();
  if (s === '0') return 0;
  return parseInt(s.replace(/\./g, ''), 10) || 0;
}

// En opstillings-celle er en lang tekststreng uden mellemrum eller andre
// skilletegn mellem spillere eller mellem efternavn og land, fx:
// "Orlando MosqueraPanama·Keeper-4.000Marc CucurellaSpanien·Forsvar+72.000".
// "·" optræder kun mellem land og position, og hver værdi (".000"-tal)
// går direkte over i næste spillers fornavn (stort begyndelsesbogstav).
// Det udnyttes til at finde hver entry, og landenavnet splittes fra
// efternavnet vha. en kendt liste over lande (fra spillerdatasættet).
function parseOpstilling(cellText, countries) {
  const re = /([A-ZÀ-ÝÆØÅ][^·]*?)·(Keeper|Forsvar|Midtbane|Angreb)(Kaptajn2X)?([+-]?[\d.]+?)(?=[A-ZÀ-ÝÆØÅ]|$)/g;
  const entries = [];
  let m;
  while ((m = re.exec(cellText)) !== null) {
    const [, blob, posWord, isCaptain, valueStr] = m;
    const trimmedBlob = blob.trim();
    const country = countries.find(c => trimmedBlob.endsWith(c));
    const navn = country ? trimmedBlob.slice(0, trimmedBlob.length - country.length).trim() : trimmedBlob;
    entries.push({ navn, hold: country || '', pos: POS_MAP[posWord] || posWord, isCaptain: !!isCaptain, sheetValue: parseDanishNum(valueStr) });
  }
  return entries;
}

function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

function findPlayer(playersByHold, navn, hold) {
  const pool = playersByHold[hold] || [];
  const exact = pool.find(p => p.navn === navn);
  if (exact) return exact;
  const n1 = normalize(navn);
  let best = null, bestDiff = Infinity;
  for (const p of pool) {
    const n2 = normalize(p.navn);
    if (n2.startsWith(n1) || n1.startsWith(n2)) {
      const diff = Math.abs(n2.length - n1.length);
      if (diff < bestDiff) { best = p; bestDiff = diff; }
    }
  }
  return bestDiff <= 3 ? best : null;
}

async function fetchSheetRows() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kunne ikke hente Google Sheet (HTTP ${res.status}). Tjek at arket er delt med "Alle med linket".`);
  const raw = await res.text();
  const lines = raw.split('\n').filter(l => l.trim());
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const o = {};
    headers.forEach((h, i) => o[h] = (vals[i] ?? '').trim());
    return o;
  }).filter(r => r.Spiller);
}

// Guld: vurder skift runde for runde (samme regel som ideal_guldhold.js),
// men startende fra vennens FAKTISKE trup i stedet for et nyt optimalt hold.
function recommendGuld(startSquad, fromRound, numRounds, allPlayers) {
  let squad = startSquad.slice();
  const rounds = [];
  for (let i = fromRound + 1; i <= numRounds; i++) {
    const vIdx = i - 1;
    const swaps = [];
    let improved = true;
    while (improved) {
      improved = false;
      for (let s = 0; s < squad.length; s++) {
        const out = squad[s];
        const usedKeys = new Set(squad.map(p => p.key));
        const country = {};
        squad.forEach(p => country[p.hold] = (country[p.hold] || 0) + 1);
        let best = null, bestGain = 0;
        for (const cand of allPlayers) {
          if (cand.pos !== out.pos || usedKeys.has(cand.key)) continue;
          const wouldBeCount = cand.hold === out.hold ? (country[cand.hold] || 0) : (country[cand.hold] || 0) + 1;
          if (wouldBeCount > MAX_PER_COUNTRY) continue;
          const priceIn = priceAtStartOfRound(cand, i);
          const fee = Math.round(priceIn * 0.01);
          const gain = (cand.vaekst[vIdx] || 0) - (out.vaekst[vIdx] || 0) - fee;
          if (gain > bestGain) { best = cand; bestGain = gain; }
        }
        if (best) { swaps.push({ out, in: best, fee: Math.round(priceAtStartOfRound(best, i) * 0.01) }); squad[s] = best; improved = true; }
      }
    }
    const captain = squad.reduce((a, p) => (p.vaekst[vIdx] || 0) > (a.vaekst[vIdx] || 0) ? p : a);
    rounds.push({ round: i, swaps, captain, squad: squad.slice() });
  }
  return rounds;
}

// Sølv: maks. `swapsRemaining` skift tilbage. Vurder ud fra samlet gevinst
// resten af de kendte runder (samme tilgang som ideal_solvhold.js), men
// startende fra vennens faktiske trup.
function recommendSolv(startSquad, fromRound, numRounds, allPlayers, swapsRemaining) {
  if (swapsRemaining <= 0) return { swapsExhausted: true, rounds: [] };

  let timeline = [];
  for (let i = fromRound + 1; i <= numRounds; i++) timeline.push(startSquad.slice());
  const swapLog = [];

  function findBestSwap() {
    let best = null;
    for (let t = fromRound + 1; t <= numRounds; t++) {
      const tIdx = t - fromRound - 1;
      const squadAtT = timeline[tIdx];
      const country = {};
      squadAtT.forEach(p => country[p.hold] = (country[p.hold] || 0) + 1);
      for (const out of squadAtT) {
        for (const cand of allPlayers) {
          if (cand.pos !== out.pos) continue;
          if (squadAtT.some(p => p.key === cand.key)) continue;
          const wouldBeCount = cand.hold === out.hold ? (country[cand.hold] || 0) : (country[cand.hold] || 0) + 1;
          if (wouldBeCount > MAX_PER_COUNTRY) continue;
          const priceIn = priceAtStartOfRound(cand, t);
          const fee = Math.round(priceIn * 0.01);
          let benefit = -fee;
          for (let r = t; r <= numRounds; r++) benefit += (cand.vaekst[r - 1] || 0) - (out.vaekst[r - 1] || 0);
          if (!best || benefit > best.benefit) best = { t, out, cand, fee, benefit };
        }
      }
    }
    return best;
  }

  while (swapLog.length < swapsRemaining) {
    const swap = findBestSwap();
    if (!swap || swap.benefit <= 0) break;
    for (let r = swap.t; r <= numRounds; r++) {
      const idx = r - fromRound - 1;
      timeline[idx] = timeline[idx].map(p => p.key === swap.out.key ? swap.cand : p);
    }
    swapLog.push(swap);
  }

  const rounds = [];
  for (let i = fromRound + 1; i <= numRounds; i++) {
    const vIdx = i - 1;
    const squad = timeline[i - fromRound - 1];
    const captain = squad.reduce((a, p) => (p.vaekst[vIdx] || 0) > (a.vaekst[vIdx] || 0) ? p : a);
    rounds.push({ round: i, swaps: swapLog.filter(s => s.t === i), captain, squad: squad.slice() });
  }
  return { swapsExhausted: false, swapLog, rounds, swapsRemaining };
}

async function computeVenAnbefalinger(csvPath = 'holdet_runde1_stats.csv') {
  const sheetRows = await fetchSheetRows();
  const { players, numRounds } = loadPlayers(csvPath);

  const playersByHold = {};
  for (const p of players) (playersByHold[p.hold] ??= []).push(p);
  const countries = [...new Set(players.map(p => p.hold))].sort((a, b) => b.length - a.length);

  const headerSample = sheetRows[0] ? Object.keys(sheetRows[0]) : [];
  const knownRounds = headerSample
    .map(h => h.match(/^Opstilling Runde (\d+)$/))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10))
    .sort((a, b) => a - b);

  if (!knownRounds.length) throw new Error('Fandt ingen "Opstilling Runde N"-kolonner i arket.');
  const latestKnownRound = knownRounds[knownRounds.length - 1];

  const friends = [];

  for (const row of sheetRows) {
    const navn = row.Spiller;
    const spil = row.Spil;
    const friend = { navn, spil, captainChecks: [], unresolved: [], usedSwapTransitions: [], recommendation: null };

    const knownSquads = {};
    for (const r of knownRounds) {
      const cell = row[`Opstilling Runde ${r}`];
      if (!cell) continue;
      const entries = parseOpstilling(cell, countries);
      const squad = entries.map(e => {
        const p = findPlayer(playersByHold, e.navn, e.hold);
        if (!p) friend.unresolved.push(`${e.navn} (${e.hold})`);
        return { ...e, ref: p };
      });
      knownSquads[r] = squad;
    }

    for (const r of knownRounds) {
      const squad = knownSquads[r].filter(e => e.ref);
      if (!squad.length) continue;
      const vIdx = r - 1;
      const chosenCaptain = squad.find(e => e.isCaptain);
      const bestCaptain = squad.reduce((a, e) => (e.ref.vaekst[vIdx] || 0) > (a.ref.vaekst[vIdx] || 0) ? e : a);
      const bestVaekst = bestCaptain.ref.vaekst[vIdx] || 0;
      const ok = chosenCaptain && chosenCaptain.ref.key === bestCaptain.ref.key;
      friend.captainChecks.push({
        round: r, ok,
        chosen: chosenCaptain ? chosenCaptain.ref : null,
        chosenVaekst: chosenCaptain ? (chosenCaptain.ref.vaekst[vIdx] || 0) : null,
        best: bestCaptain.ref, bestVaekst,
      });
    }

    let solvSwapsUsedSoFar = 0;
    for (let i = 1; i < knownRounds.length; i++) {
      const prevR = knownRounds[i - 1], curR = knownRounds[i];
      const prevKeys = new Set(knownSquads[prevR].filter(e => e.ref).map(e => e.ref.key));
      const curKeys = new Set(knownSquads[curR].filter(e => e.ref).map(e => e.ref.key));
      const swappedOut = [...prevKeys].filter(k => !curKeys.has(k)).length;
      if (swappedOut) friend.usedSwapTransitions.push({ from: prevR, to: curR, count: swappedOut });
      solvSwapsUsedSoFar += swappedOut;
    }

    const baseSquad = knownSquads[latestKnownRound].filter(e => e.ref).map(e => e.ref);
    friend.latestKnownRound = latestKnownRound;
    friend.numRounds = numRounds;

    if (latestKnownRound >= numRounds) {
      friend.status = 'waiting';
    } else if (baseSquad.length < 11) {
      friend.status = 'incomplete';
    } else if (spil === 'Guld') {
      friend.status = 'ok';
      friend.recommendation = { type: 'Guld', rounds: recommendGuld(baseSquad, latestKnownRound, numRounds, players) };
    } else {
      friend.status = 'ok';
      friend.recommendation = { type: 'Sølv', ...recommendSolv(baseSquad, latestKnownRound, numRounds, players, Math.max(0, MAX_SWAPS_SOLV - solvSwapsUsedSoFar)) };
    }

    friends.push(friend);
  }

  return { friends, latestKnownRound, numRounds };
}

function printReport({ friends, latestKnownRound }) {
  console.log('═'.repeat(74));
  console.log(`  VEN-ANBEFALINGER — baseret på jeres faktiske hold (kendt t.o.m. runde ${latestKnownRound})`);
  console.log('═'.repeat(74));

  for (const f of friends) {
    console.log(`\n${'─'.repeat(74)}\n${f.navn} (${f.spil})`);
    for (const u of f.unresolved) console.log(`  ⚠ Kunne ikke matche "${u}" til datasættet.`);
    if (f.unresolved.length) console.log('  (Disse spillere er udeladt af analysen nedenfor.)');

    for (const c of f.captainChecks) {
      if (c.ok) {
        console.log(`  Runde ${c.round}: Kaptajn-valg OK — ${c.chosen.navn} havde højeste vækst (${fmtKr(c.bestVaekst)}).`);
      } else if (c.chosen) {
        console.log(`  Runde ${c.round}: Kaptajn burde have været ${c.best.navn} (${fmtKr(c.bestVaekst)}) i stedet for ${c.chosen.navn} (${fmtKr(c.chosenVaekst)}) — tabt bonus: ${fmtKr(c.bestVaekst - c.chosenVaekst)}.`);
      } else {
        console.log(`  Runde ${c.round}: Ingen kaptajn fundet i data. Højeste vækst havde ${c.best.navn} (${fmtKr(c.bestVaekst)}).`);
      }
    }
    for (const t of f.usedSwapTransitions) console.log(`  (${t.count} skift registreret mellem runde ${t.from} og ${t.to}.)`);

    if (f.status === 'waiting') {
      console.log(`  Ingen nyere rundedata end runde ${f.latestKnownRound} tilgængelig endnu — afventer "opdater_runde.js".`);
      continue;
    }
    if (f.status === 'incomplete') {
      console.log('  Springer skifte-anbefalinger over (mangler spiller-match i ovenstående trup).');
      continue;
    }

    const rec = f.recommendation;
    if (rec.type === 'Guld') {
      for (const r of rec.rounds) {
        console.log(`  Runde ${r.round} (Guld-anbefaling):`);
        if (r.swaps.length) {
          r.swaps.forEach(sw => console.log(`    Skift ind: ${sw.in.navn} (${sw.in.hold}) ud med ${sw.out.navn} (${sw.out.hold})  [gebyr ${fmtKr(sw.fee)}]`));
        } else {
          console.log('    Ingen skift nødvendige — trup stadig optimal.');
        }
        console.log(`    Kaptajn bør være: ${r.captain.navn} (${r.captain.hold}) → ${fmtKr(r.captain.vaekst[r.round - 1] || 0)}`);
        console.log('    Trup: ' + r.squad.map(p => `${p.navn} (${p.hold})`).join(', '));
      }
    } else {
      if (rec.swapsExhausted) {
        console.log('  Sølv-budget på 3 skift er allerede brugt — ingen yderligere skift kan anbefales.');
        continue;
      }
      if (!rec.swapLog.length) console.log(`  Ingen skift var fordelagtige nok (${rec.swapsRemaining} skift tilbage af ${MAX_SWAPS_SOLV}).`);
      for (const sw of rec.swapLog) {
        console.log(`  Runde ${sw.t} (Sølv-anbefaling): Skift ind ${sw.cand.navn} (${sw.cand.hold}) ud med ${sw.out.navn} (${sw.out.hold})  [gebyr ${fmtKr(sw.fee)}, samlet gevinst: ${fmtKr(sw.benefit)}]`);
      }
      for (const r of rec.rounds) {
        console.log(`    Runde ${r.round}: kaptajn bør være ${r.captain.navn} (${r.captain.hold}) → ${fmtKr(r.captain.vaekst[r.round - 1] || 0)}`);
        console.log('    Trup: ' + r.squad.map(p => `${p.navn} (${p.hold})`).join(', '));
      }
    }
  }
}

module.exports = { computeVenAnbefalinger };

if (require.main === module) {
  computeVenAnbefalinger().then(printReport).catch(e => { console.error('FEJL:', e.message); process.exit(1); });
}
