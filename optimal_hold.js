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

// --- Parse CSV ---
const raw = fs.readFileSync('holdet_runde1_stats.csv', 'utf8').replace(/^﻿/, '');
const lines = raw.split('\n').filter(l => l.trim());
const headers = lines[0].split(',');

function parseRow(line) {
  const vals = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { vals.push(cur); cur = ''; }
    else cur += ch;
  }
  vals.push(cur);
  const o = {};
  headers.forEach((h, i) => o[h.trim()] = (vals[i] ?? '').trim());
  return o;
}

const allPlayers = lines.slice(1).map(parseRow).map(p => ({
  navn: p.Navn,
  hold: p.Hold,
  pos: p.Position,
  pris: parseInt(p.Pris) || 0,
  vaekst: parseInt(p['Vækst Runde 1']) || 0,
})).filter(p => p.pris > 0 && p.navn && p.hold && ['MV','DEF','MID','ANG'].includes(p.pos));

const EXCLUDE_COUNTRIES = ['Schweiz', 'Bosnien-Hercegovina', 'Tjekkiet', 'Sydafrika'];

const byPos = { MV: [], DEF: [], MID: [], ANG: [] };
allPlayers.filter(p => !EXCLUDE_COUNTRIES.includes(p.hold)).forEach(p => byPos[p.pos].push(p));
Object.values(byPos).forEach(arr => arr.sort((a, b) => b.vaekst - a.vaekst));

console.log('Spillere per position:', Object.fromEntries(Object.entries(byPos).map(([k,v]) => [k, v.length])));

// Captain score: sum of all vaekst + captain's vaekst again (= doubled)
function teamScore(players) {
  const total = players.reduce((s, p) => s + p.vaekst, 0);
  const captainVaekst = Math.max(...players.map(p => p.vaekst));
  return total + captainVaekst;
}

// --- Optimizer: greedy + local search (objective: teamScore with captain bonus) ---
function optimize(formation) {
  const slots = [
    { pos: 'MV',  n: 1 },
    { pos: 'DEF', n: formation.def },
    { pos: 'MID', n: formation.mid },
    { pos: 'ANG', n: formation.ang },
  ];

  let best = null;

  function greedyRun(slotOrder) {
    const selected = [];
    const country = {};
    let spent = 0;

    for (const { pos, n } of slotOrder) {
      const excSet = new Set(selected.map(p => p.navn + p.hold));
      const candidates = byPos[pos].filter(p =>
        !excSet.has(p.navn + p.hold) &&
        (country[p.hold] || 0) < MAX_PER_COUNTRY
      );

      let picked = 0;
      for (const p of candidates) {
        if (picked >= n) break;
        const remainingSlots = slots.flatMap(s => {
          const alreadyPicked = selected.filter(x => x.pos === s.pos).length + (s.pos === pos ? picked + 1 : 0);
          return Array(Math.max(0, s.n - alreadyPicked)).fill(s.pos);
        });
        const minRemaining = remainingSlots.reduce((acc, rpos) => {
          const excR = new Set([...selected.map(x => x.navn + x.hold), p.navn + p.hold]);
          const cheapest = byPos[rpos].find(x => !excR.has(x.navn + x.hold));
          return acc + (cheapest?.pris ?? 9_999_999);
        }, 0);

        if (spent + p.pris + minRemaining <= BUDGET) {
          selected.push(p);
          country[p.hold] = (country[p.hold] || 0) + 1;
          spent += p.pris;
          picked++;
        }
      }
      if (picked < n) {
        const excSet2 = new Set(selected.map(p => p.navn + p.hold));
        const cheap = [...byPos[pos]]
          .filter(p => !excSet2.has(p.navn + p.hold) && (country[p.hold] || 0) < MAX_PER_COUNTRY)
          .sort((a,b) => a.pris - b.pris);
        for (const p of cheap) {
          if (picked >= n) break;
          if (spent + p.pris <= BUDGET) {
            selected.push(p);
            country[p.hold] = (country[p.hold] || 0) + 1;
            spent += p.pris;
            picked++;
          }
        }
      }
    }
    if (selected.length < 11) return null;
    const vaekst = selected.reduce((s, p) => s + p.vaekst, 0);
    return { selected, spent, vaekst, score: teamScore(selected) };
  }

  const perms = permutations(slots);
  for (const order of perms) {
    const res = greedyRun(order);
    if (res && (!best || res.score > best.score)) best = res;
  }

  // Local search: optimise by teamScore (captain bonus included)
  if (best) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < best.selected.length; i++) {
        const cur = best.selected[i];
        const rest = best.selected.filter((_, j) => j !== i);
        const restCountry = {};
        rest.forEach(p => restCountry[p.hold] = (restCountry[p.hold] || 0) + 1);
        const restSpent = rest.reduce((s, p) => s + p.pris, 0);
        const excSet = new Set(rest.map(p => p.navn + p.hold));
        const currentScore = teamScore(best.selected);

        for (const candidate of byPos[cur.pos]) {
          if (excSet.has(candidate.navn + candidate.hold)) continue;
          if ((restCountry[candidate.hold] || 0) >= MAX_PER_COUNTRY) continue;
          if (restSpent + candidate.pris > BUDGET) continue;
          const newTeam = [...rest, candidate];
          if (teamScore(newTeam) > currentScore) {
            best.selected[i] = candidate;
            best.vaekst = newTeam.reduce((s, p) => s + p.vaekst, 0);
            best.score = teamScore(newTeam);
            best.spent = restSpent + candidate.pris;
            improved = true;
            break;
          }
        }
      }
    }
  }

  if (!best) return null;
  const captain = best.selected.reduce((a, p) => p.vaekst > a.vaekst ? p : a);
  return { ...best, formation: formation.name, captain };
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((el, i) =>
    permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(p => [el, ...p])
  );
}

function printTeam(result, rank) {
  const captainBonus = result.captain.vaekst;
  console.log('\n' + '═'.repeat(66));
  console.log(`  #${rank}  ${result.formation}   Vækst: +${result.vaekst.toLocaleString()} kr   Kaptajnscore: +${result.score.toLocaleString()} kr   ${(result.spent/1e6).toFixed(2)}M`);
  console.log('═'.repeat(66));

  const grouped = { MV: [], DEF: [], MID: [], ANG: [] };
  result.selected.forEach(p => grouped[p.pos].push(p));
  const posLabels = { MV: 'KEEPER', DEF: 'FORSVAR', MID: 'MIDTBANE', ANG: 'ANGREB' };

  for (const pos of ['MV', 'DEF', 'MID', 'ANG']) {
    if (!grouped[pos].length) continue;
    console.log(`\n  ${posLabels[pos]}`);
    grouped[pos].sort((a, b) => b.vaekst - a.vaekst).forEach(p => {
      const isCaptain = p.navn === result.captain.navn && p.hold === result.captain.hold;
      const tag = isCaptain ? ' (C)' : '    ';
      console.log(`    ${(p.navn + tag).padEnd(30)} ${p.hold.padEnd(14)} ${(p.pris/1e6).toFixed(2)}M   +${p.vaekst.toLocaleString().padStart(8)} kr`);
    });
  }

  console.log(`\n  Kaptajn: ${result.captain.navn} → +${captainBonus.toLocaleString()} kr × 2 = +${(captainBonus*2).toLocaleString()} kr`);

  const cc = {};
  result.selected.forEach(p => cc[p.hold] = (cc[p.hold] || 0) + 1);
  const multi = Object.entries(cc).filter(([,v]) => v > 1).map(([k,v]) => `${k}: ${v}`).join(', ');
  if (multi) console.log(`  Hold med flere spillere: ${multi}`);
}

// --- Run ---
console.log('\nOptimerer for alle formationer (med kaptajnscore)...');
const allResults = [];

for (const f of FORMATIONS) {
  const result = optimize(f);
  if (result) {
    allResults.push(result);
    console.log(`  ${f.name}: vækst +${result.vaekst.toLocaleString()}   kaptajnscore +${result.score.toLocaleString()}`);
  }
}

allResults.sort((a, b) => b.score - a.score);

console.log('\n--- Alle formationer sorteret efter kaptajnscore ---');
allResults.forEach((r, i) =>
  console.log(`  ${String(i+1).padStart(2)}. ${r.formation.padEnd(6)}  kaptajnscore: +${r.score.toLocaleString().padStart(9)} kr  (vækst: +${r.vaekst.toLocaleString().padStart(9)} kr, kaptajn: ${r.captain.navn})`)
);

console.log('\nTop 2 opstillinger:');
allResults.slice(0, 2).forEach((r, i) => printTeam(r, i + 1));
