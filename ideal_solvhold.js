// Ideal SØLVHOLD efter hver runde: maks. 3 spillerskift i alt over hele
// turneringen (8 runder), samme transfergebyr (1% af indskiftet spillers
// pris ved skiftets runde) og kaptajn-bonus som guldhold.
//
// Fordi skift er en knap ressource (kun 3 i alt), er den rigtige
// beslutning ikke nødvendigvis at skifte så snart en marginal forbedring
// findes (som guldhold gør) — et skift bør kun bruges, hvis den samlede
// gevinst over alle de runder, spilleren holdes resten af turneringen,
// opvejer gebyret. Da scriptet køres EFTER hver runde, har vi facit for
// alle spillede runder, så vi kan beregne dette med fuldt tilbageblik:
//
//   gevinst(A→B, skiftet i runde t) = Σ_{r=t..N} (B.vækst_r − A.vækst_r) − gebyr(B)
//
// Scriptet vælger grådigt den bedste af de op til 3 mulige skift (størst
// samlet gevinst), anvender det, og gentager — op til 3 gange i alt, eller
// til ingen flere skift giver positiv gevinst. Dette er en heuristik, ikke
// en garanteret global optimum (en fuldstændig søgning over alle
// kombinationer af tidspunkt + spiller for 3 skift er kombinatorisk for
// stor), men den fanger den centrale afvejning: store, tidlige, varige
// forbedringer prioriteres over små marginale skift.
//
// Køres efter hver opdatering af holdet_runde1_stats.csv.

const { BUDGET, MAX_PER_COUNTRY, loadPlayers, priceAtStartOfRound, optimizeSquad, fmtKr } = require('./holdet_lib');

const MAX_SWAPS = 3;

function computeSolvhold(csvPath = 'holdet_runde1_stats.csv') {
  const { players, numRounds } = loadPlayers(csvPath);
  if (numRounds === 0) throw new Error('Ingen "Vækst Runde N"-kolonner fundet i CSV-filen.');

  const round1 = optimizeSquad(players, 0, p => p.startpris, BUDGET);

  let timeline = [];
  for (let i = 0; i < numRounds; i++) timeline.push(round1.selected.slice());

  const swapLog = [];

  function cashTrajectory() {
    let cash = BUDGET - round1.spent;
    const trace = [];
    for (let r = 1; r <= numRounds; r++) {
      for (const sw of swapLog.filter(s => s.t === r)) {
        const priceOut = priceAtStartOfRound(sw.out, r);
        const priceIn = priceAtStartOfRound(sw.cand, r);
        cash += priceOut - priceIn - sw.fee;
      }
      cash *= 1.01;
      trace.push(cash);
    }
    return trace;
  }

  function findBestSwap() {
    const trace = cashTrajectory();
    let best = null;
    for (let t = 2; t <= numRounds; t++) {
      const tIdx = t - 1;
      const squadAtT = timeline[tIdx];
      const country = {};
      squadAtT.forEach(p => country[p.hold] = (country[p.hold] || 0) + 1);
      const cashAtT = trace[t - 2];

      for (const out of squadAtT) {
        const priceOut = priceAtStartOfRound(out, t);
        for (const cand of players) {
          if (cand.pos !== out.pos) continue;
          if (squadAtT.some(p => p.key === cand.key)) continue;
          const wouldBeCount = cand.hold === out.hold ? (country[cand.hold] || 0) : (country[cand.hold] || 0) + 1;
          if (wouldBeCount > MAX_PER_COUNTRY) continue;

          const priceIn = priceAtStartOfRound(cand, t);
          const fee = Math.round(priceIn * 0.01);
          const cashNeeded = priceIn + fee - priceOut;
          if (cashNeeded > cashAtT) continue;

          let benefit = -fee;
          for (let r = t; r <= numRounds; r++) {
            const rIdx = r - 1;
            benefit += (cand.vaekst[rIdx] || 0) - (out.vaekst[rIdx] || 0);
          }
          if (!best || benefit > best.benefit) {
            best = { t, out, cand, fee, benefit };
          }
        }
      }
    }
    return best;
  }

  while (swapLog.length < MAX_SWAPS) {
    const swap = findBestSwap();
    if (!swap || swap.benefit <= 0) break;
    for (let r = swap.t; r <= numRounds; r++) {
      timeline[r - 1] = timeline[r - 1].map(p => p.key === swap.out.key ? swap.cand : p);
    }
    swapLog.push(swap);
  }

  const finalCash = cashTrajectory();

  let cumulativeNetto = 0;
  let cumulativeFees = 0;
  const rounds = [];
  for (let r = 1; r <= numRounds; r++) {
    const vIdx = r - 1;
    const squad = timeline[vIdx];
    const feesThisRound = swapLog.filter(s => s.t === r).reduce((s, sw) => s + sw.fee, 0);
    const roundScore = squad.reduce((s, p) => s + (p.vaekst[vIdx] || 0), 0) + Math.max(...squad.map(p => p.vaekst[vIdx] || 0));
    const netto = roundScore - feesThisRound;
    cumulativeNetto += netto;
    cumulativeFees += feesThisRound;
    rounds.push({
      round: r, formation: r === 1 ? round1.formation : null, squad: squad.slice(),
      score: roundScore, fees: feesThisRound, swaps: swapLog.filter(s => s.t === r), cash: finalCash[vIdx],
    });
  }

  return { rounds, swapLog, cumulativeNetto, cumulativeFees, numRounds };
}

function printReport({ rounds, swapLog, cumulativeNetto, cumulativeFees, numRounds }) {
  console.log('═'.repeat(70));
  console.log(`  SØLVHOLD — ideal trup runde for runde (maks. ${MAX_SWAPS} skift i alt)`);
  console.log('═'.repeat(70));

  console.log(`\nValgte skift (${swapLog.length} af ${MAX_SWAPS} brugt):`);
  if (!swapLog.length) {
    console.log('  Ingen skift var fordelagtige — start-truppen er stadig bedst.');
  }
  for (const sw of swapLog) {
    console.log(`  Runde ${sw.t}: ${sw.out.navn} (${sw.out.hold}) → ${sw.cand.navn} (${sw.cand.hold})  [gebyr ${fmtKr(sw.fee)}, samlet gevinst resten af turneringen: ${fmtKr(sw.benefit)}]`);
  }

  for (const r of rounds) {
    const vIdx = r.round - 1;
    const captain = r.squad.reduce((a, p) => (p.vaekst[vIdx] || 0) > (a.vaekst[vIdx] || 0) ? p : a);
    console.log(`\nRunde ${r.round}${r.formation ? ` (${r.formation})` : ''}:`);
    for (const sw of r.swaps) {
      console.log(`  Skift: ${sw.out.navn} (${sw.out.hold}) → ${sw.cand.navn} (${sw.cand.hold})  [gebyr ${fmtKr(sw.fee)}]`);
    }
    console.log(`  Kaptajn: ${captain.navn} (${captain.hold}) → ${fmtKr(captain.vaekst[vIdx] || 0)} ×2`);
    console.log(`  Rundescore: ${fmtKr(r.score)}   Gebyrer: ${fmtKr(r.fees)}   Netto: ${fmtKr(r.score - r.fees)}   Kontant: ${fmtKr(r.cash)}`);
    console.log('  Trup: ' + r.squad.map(p => `${p.navn} (${p.hold})`).join(', '));
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`Samlet netto-score over ${numRounds} runde(r): ${fmtKr(cumulativeNetto)}  (gebyrer i alt: ${fmtKr(cumulativeFees)})`);
  console.log('─'.repeat(70));
}

module.exports = { computeSolvhold };

if (require.main === module) {
  printReport(computeSolvhold());
}
