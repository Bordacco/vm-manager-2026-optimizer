// Fælles hjælpefunktioner til de runde-baserede optimerings-scripts
// (ideal_guldhold.js og ideal_solvhold.js). Læser holdet_runde1_stats.csv
// og giver adgang til hver spillers vækst pr. runde samt deres pris ved
// starten af en given runde (Startpris + sum af tidligere runders vækst).

const fs = require('fs');

const BUDGET = 50_000_000;
const MAX_PER_COUNTRY = 4;

const FORMATIONS = [
  { name: '3-4-3', def: 3, mid: 4, ang: 3 },
  { name: '3-5-2', def: 3, mid: 5, ang: 2 },
  { name: '4-3-3', def: 4, mid: 3, ang: 3 },
  { name: '4-4-2', def: 4, mid: 4, ang: 2 },
  { name: '4-5-1', def: 4, mid: 5, ang: 1 },
  { name: '5-3-2', def: 5, mid: 3, ang: 2 },
  { name: '5-4-1', def: 5, mid: 4, ang: 1 },
];

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

function loadPlayers(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
  const lines = raw.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',');
  const roundCols = headers
    .filter(h => /^Vækst Runde \d+$/.test(h))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));

  const players = lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const o = {};
    headers.forEach((h, i) => o[h] = (vals[i] ?? '').trim());
    const vaekst = roundCols.map(c => parseInt(o[c]) || 0);
    return {
      navn: o.Navn,
      hold: o.Hold,
      pos: o.Position,
      startpris: parseInt(o.Startpris) || 0,
      vaekst, // vaekst[0] = Runde 1, vaekst[1] = Runde 2, osv.
      key: o.Navn + '|' + o.Hold,
    };
  }).filter(p => p.navn && p.hold && p.startpris > 0 && ['MV', 'DEF', 'MID', 'ANG'].includes(p.pos));

  return { players, numRounds: roundCols.length };
}

// Spillerens pris ved starten af `round` (1-baseret), dvs. inden den
// runde selv har lagt vækst til. Runde 1 = Startpris.
function priceAtStartOfRound(p, round) {
  let price = p.startpris;
  for (let k = 0; k < round - 1; k++) price += (p.vaekst[k] || 0);
  return price;
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((el, i) =>
    permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(p => [el, ...p])
  );
}

// Finder det bedst mulige hold (alle 7 formationer + lokalsøgning) for én
// given runde (vIdx, 0-baseret) ud fra en angivet prisfunktion og budget.
// Bruges til at sætte det første hold (Runde 1, hvor der ikke er
// transfergebyrer eller en eksisterende trup at tage højde for).
//
// `valueFn(p)` styrer hvilken værdi spillerne udvælges efter (default:
// rundens egen vækst). ideal_guldhold.js bruger en "lookahead"-værdi her,
// så runde 1 også tager højde for gebyret ved evt. skift i senere runder
// — men selve rapporteringen af rundens score skal stadig ske ud fra den
// RIGTIGE vækst for den runde, ikke lookahead-værdien (det er kaldérens
// ansvar at genberegne den efter valget).
function optimizeSquad(players, vIdx, priceFn, budget, valueFn) {
  const value = valueFn || (p => p.vaekst[vIdx] || 0);
  const byPos = { MV: [], DEF: [], MID: [], ANG: [] };
  players.forEach(p => byPos[p.pos].push(p));
  Object.values(byPos).forEach(arr => arr.sort((a, b) => value(b) - value(a)));

  function teamScore(sel) {
    const total = sel.reduce((s, p) => s + value(p), 0);
    const cap = Math.max(...sel.map(p => value(p)));
    return total + cap;
  }

  let best = null;
  for (const formation of FORMATIONS) {
    const slots = [
      { pos: 'MV', n: 1 }, { pos: 'DEF', n: formation.def },
      { pos: 'MID', n: formation.mid }, { pos: 'ANG', n: formation.ang },
    ];
    for (const order of permutations(slots)) {
      const selected = []; const country = {}; let spent = 0;
      for (const { pos, n } of order) {
        const excSet = new Set(selected.map(p => p.key));
        const candidates = byPos[pos].filter(p => !excSet.has(p.key) && (country[p.hold] || 0) < MAX_PER_COUNTRY);
        let picked = 0;
        for (const p of candidates) {
          if (picked >= n) break;
          const price = priceFn(p);
          if (spent + price <= budget) {
            selected.push(p); country[p.hold] = (country[p.hold] || 0) + 1; spent += price; picked++;
          }
        }
        if (picked < n) {
          const excSet2 = new Set(selected.map(p => p.key));
          const cheap = [...byPos[pos]]
            .filter(p => !excSet2.has(p.key) && (country[p.hold] || 0) < MAX_PER_COUNTRY)
            .sort((a, b) => priceFn(a) - priceFn(b));
          for (const p of cheap) {
            if (picked >= n) break;
            const price = priceFn(p);
            if (spent + price <= budget) {
              selected.push(p); country[p.hold] = (country[p.hold] || 0) + 1; spent += price; picked++;
            }
          }
        }
      }
      if (selected.length === 11) {
        const score = teamScore(selected);
        if (!best || score > best.score) best = { selected, spent, score, formation: formation.name };
      }
    }
  }

  if (best) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < best.selected.length; i++) {
        const cur = best.selected[i];
        const rest = best.selected.filter((_, j) => j !== i);
        const restCountry = {}; rest.forEach(p => restCountry[p.hold] = (restCountry[p.hold] || 0) + 1);
        const restSpent = rest.reduce((s, p) => s + priceFn(p), 0);
        const excSet = new Set(rest.map(p => p.key));
        const currentScore = teamScore(best.selected);
        for (const cand of byPos[cur.pos]) {
          if (excSet.has(cand.key)) continue;
          if ((restCountry[cand.hold] || 0) >= MAX_PER_COUNTRY) continue;
          const price = priceFn(cand);
          if (restSpent + price > budget) continue;
          const newTeam = [...rest, cand];
          if (teamScore(newTeam) > currentScore) {
            best.selected[i] = cand; best.spent = restSpent + price; best.score = teamScore(newTeam);
            improved = true; break;
          }
        }
      }
    }
  }
  return best;
}

function isValidComposition(squad) {
  const counts = { MV: 0, DEF: 0, MID: 0, ANG: 0 };
  squad.forEach(p => counts[p.pos] = (counts[p.pos] || 0) + 1);
  if (counts.MV !== 1 || squad.length !== 11) return false;
  return FORMATIONS.some(f => f.def === counts.DEF && f.mid === counts.MID && f.ang === counts.ANG);
}

// GULDHOLD med fri formation: hver runde genoptimeres truppen fuldt ud
// (alle 7 formationer prøves igen), men spillere der allerede ejes kan
// beholdes uden gebyr, mens nye spillere koster pris × 1,01 (pris +
// 1%-gebyr). Det betyder reelt at man "låner" hele sin nuværende
// trups værdi + kontanter som budget for runden, og optimizeSquad finder
// den bedst mulige sammensætning af gammelt og nyt inden for det budget.
// fromRound/baseSquad/startCash lader funktionen fortsætte fra en
// allerede kendt trup (bruges af ven_anbefalinger.js).
function runGoldTrajectory(players, numRounds, { fromRound = 1, baseSquad = [], startCash = BUDGET } = {}) {
  let prevSquad = baseSquad.slice();
  let cash = startCash;
  const rounds = [];
  let cumulativeNetto = 0;
  let cumulativeFees = 0;

  for (let i = fromRound; i <= numRounds; i++) {
    const vIdx = i - 1;
    const isInitialPurchase = prevSquad.length === 0;
    const prevKeys = new Set(prevSquad.map(p => p.key));
    const prevValueSum = prevSquad.reduce((s, p) => s + priceAtStartOfRound(p, i), 0);
    const roundBudget = cash + prevValueSum;
    const priceFn = p => (isInitialPurchase || prevKeys.has(p.key))
      ? priceAtStartOfRound(p, i)
      : priceAtStartOfRound(p, i) * 1.01;
    // Værdien til selve udvælgelsen skal trække gebyret fra for NYE
    // spillere (ellers vil optimeringen frit "købe" bedre spillere uden
    // at det rigtige gebyr-tab indgår i sammenligningen — kun i
    // budgetcheck'et). Allerede ejede spillere har intet gebyr at trække fra.
    const valueFn = p => (p.vaekst[vIdx] || 0) - ((isInitialPurchase || prevKeys.has(p.key)) ? 0 : Math.round(priceAtStartOfRound(p, i) * 0.01));

    const result = optimizeSquad(players, vIdx, priceFn, roundBudget, valueFn);
    const newSquad = result.selected;

    const swapsOut = prevSquad.filter(p => !newSquad.some(q => q.key === p.key));
    const swapsIn = newSquad.filter(p => !prevKeys.has(p.key)).map(p => ({
      player: p, fee: isInitialPurchase ? 0 : Math.round(priceAtStartOfRound(p, i) * 0.01),
    }));
    const feesThisRound = swapsIn.reduce((s, sw) => s + sw.fee, 0);

    const spentEffective = newSquad.reduce((s, p) => s + priceFn(p), 0);
    cash = (roundBudget - spentEffective) * 1.01;

    const roundScore = newSquad.reduce((s, p) => s + (p.vaekst[vIdx] || 0), 0) + Math.max(...newSquad.map(p => p.vaekst[vIdx] || 0));
    const netto = roundScore - feesThisRound;
    cumulativeNetto += netto;
    cumulativeFees += feesThisRound;

    rounds.push({ round: i, formation: result.formation, squad: newSquad.slice(), score: roundScore, fees: feesThisRound, swapsOut, swapsIn, cash });
    prevSquad = newSquad;
  }

  return { rounds, cumulativeNetto, cumulativeFees, numRounds };
}

// SØLVHOLD med fri formation: maks. `swapsAllowed` enkeltspillerskift i
// alt (uanset position — et skift fra forsvar til midtbane er stadig ét
// skift, men kun gyldigt hvis truppen efter skiftet matcher en af de 7
// tilladte formationer). Hvert skift vurderes ud fra dets samlede
// gevinst resten af den kendte horisont (fuldt tilbageblik), ligesom før,
// men søgningen er nu ikke begrænset til samme position.
function runSilverTrajectory(players, numRounds, { fromRound = 1, baseSquad = [], swapsAllowed = 3, startCash = BUDGET } = {}) {
  let initialSquad = baseSquad;
  let initialSpent = 0;
  const hasBase = baseSquad.length > 0;
  if (!hasBase) {
    const r1 = optimizeSquad(players, fromRound - 1, p => priceAtStartOfRound(p, fromRound), startCash);
    initialSquad = r1.selected;
    initialSpent = r1.spent;
  }
  // Skift kan først ske fra runden EFTER det udgangspunkt vi allerede har
  // (enten et selvvalgt køb i fromRound, eller en kendt faktisk trup).
  const swapStartRound = fromRound + 1;

  // timeline dækker fromRound..numRounds; runde `fromRound` selv er altid
  // initialSquad (intet skift er sket endnu der).
  let timeline = [];
  for (let i = fromRound; i <= numRounds; i++) timeline.push(initialSquad.slice());
  const swapLog = [];

  function cashTrajectory() {
    // trace[r - fromRound] = kontant EFTER runde r's bankrente.
    let cash = startCash - initialSpent;
    const trace = [];
    for (let r = fromRound; r <= numRounds; r++) {
      for (const sw of swapLog.filter(s => s.t === r)) {
        cash += priceAtStartOfRound(sw.out, r) - priceAtStartOfRound(sw.cand, r) - sw.fee;
      }
      cash *= 1.01;
      trace.push(cash);
    }
    return trace;
  }

  function findBestSwap() {
    const trace = cashTrajectory();
    let best = null;
    for (let t = swapStartRound; t <= numRounds; t++) {
      const squadAtT = timeline[t - fromRound];
      const cashAtT = trace[t - fromRound - 1]; // kontant efter forrige rundes rente

      for (const out of squadAtT) {
        const priceOut = priceAtStartOfRound(out, t);
        for (const cand of players) {
          if (squadAtT.some(p => p.key === cand.key)) continue;
          const hypothetical = squadAtT.map(p => p.key === out.key ? cand : p);
          if (!isValidComposition(hypothetical)) continue;
          const country = {};
          squadAtT.forEach(p => { if (p.key !== out.key) country[p.hold] = (country[p.hold] || 0) + 1; });
          if ((country[cand.hold] || 0) >= MAX_PER_COUNTRY) continue;

          const priceIn = priceAtStartOfRound(cand, t);
          const fee = Math.round(priceIn * 0.01);
          const cashNeeded = priceIn + fee - priceOut;
          if (cashNeeded > cashAtT) continue;

          let benefit = -fee;
          for (let r = t; r <= numRounds; r++) benefit += (cand.vaekst[r - 1] || 0) - (out.vaekst[r - 1] || 0);
          if (!best || benefit > best.benefit) best = { t, out, cand, fee, benefit };
        }
      }
    }
    return best;
  }

  while (swapLog.length < swapsAllowed) {
    const swap = findBestSwap();
    if (!swap || swap.benefit <= 0) break;
    for (let r = swap.t; r <= numRounds; r++) {
      const idx = r - fromRound;
      timeline[idx] = timeline[idx].map(p => p.key === swap.out.key ? swap.cand : p);
    }
    swapLog.push(swap);
  }

  const finalCash = cashTrajectory();
  const rounds = [];
  let cumulativeNetto = 0;
  let cumulativeFees = 0;
  for (let r = fromRound; r <= numRounds; r++) {
    const vIdx = r - 1;
    const squad = timeline[r - fromRound];
    const feesThisRound = swapLog.filter(s => s.t === r).reduce((s, sw) => s + sw.fee, 0);
    const roundScore = squad.reduce((s, p) => s + (p.vaekst[vIdx] || 0), 0) + Math.max(...squad.map(p => p.vaekst[vIdx] || 0));
    const netto = roundScore - feesThisRound;
    cumulativeNetto += netto;
    cumulativeFees += feesThisRound;
    rounds.push({
      round: r, squad: squad.slice(), score: roundScore, fees: feesThisRound,
      swaps: swapLog.filter(s => s.t === r), cash: finalCash[r - fromRound],
    });
  }

  return { rounds, swapLog, cumulativeNetto, cumulativeFees, numRounds };
}

function fmtKr(n) {
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return (n === 0 ? '0' : sign + Math.abs(Math.round(n)).toLocaleString('da-DK')) + ' kr';
}

module.exports = {
  BUDGET, MAX_PER_COUNTRY, FORMATIONS,
  loadPlayers, priceAtStartOfRound, optimizeSquad, fmtKr,
  isValidComposition, runGoldTrajectory, runSilverTrajectory,
};
