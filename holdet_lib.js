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
function optimizeSquad(players, vIdx, priceFn, budget) {
  const byPos = { MV: [], DEF: [], MID: [], ANG: [] };
  players.forEach(p => byPos[p.pos].push(p));
  Object.values(byPos).forEach(arr => arr.sort((a, b) => (b.vaekst[vIdx] || 0) - (a.vaekst[vIdx] || 0)));

  function teamScore(sel) {
    const total = sel.reduce((s, p) => s + (p.vaekst[vIdx] || 0), 0);
    const cap = Math.max(...sel.map(p => p.vaekst[vIdx] || 0));
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

function fmtKr(n) {
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return (n === 0 ? '0' : sign + Math.abs(Math.round(n)).toLocaleString('da-DK')) + ' kr';
}

module.exports = {
  BUDGET, MAX_PER_COUNTRY, FORMATIONS,
  loadPlayers, priceAtStartOfRound, optimizeSquad, fmtKr,
};
