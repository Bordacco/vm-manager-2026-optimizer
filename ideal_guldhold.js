// Ideal GULDHOLD efter hver runde: ubegrænsede spillerskift mellem
// runder, men hvert indskiftet spiller koster et transfergebyr på 1% af
// spillerens pris ved starten af den runde, hvor skiftet sker. Da man kan
// skifte igen i den efterfølgende runde, er det altid optimalt at vurdere
// skift runde for runde (i modsætning til sølvhold, hvor skift er en
// begrænset ressource, der skal fordeles over hele turneringen).
//
// Beslutningsregel pr. mulig skift A → B i runde i:
//   gevinst = B.vækst_i − A.vækst_i − gebyr(B)   (gebyr = 1% af B's pris)
// Skiftet udføres kun hvis gevinsten er positiv og der er kontanter nok.
//
// Køres efter hver opdatering af holdet_runde1_stats.csv (dvs. efter
// opdater_runde.js er kørt for den nyeste runde).

const { BUDGET, MAX_PER_COUNTRY, loadPlayers, priceAtStartOfRound, optimizeSquad, fmtKr } = require('./holdet_lib');

function computeGuldhold(csvPath = 'holdet_runde1_stats.csv') {
  const { players, numRounds } = loadPlayers(csvPath);
  if (numRounds === 0) throw new Error('Ingen "Vækst Runde N"-kolonner fundet i CSV-filen.');

  const round1 = optimizeSquad(players, 0, p => p.startpris, BUDGET);
  let squad = round1.selected.slice();
  let cash = (BUDGET - round1.spent) * 1.01;
  let cumulativeNetto = round1.score;
  let cumulativeFees = 0;

  const rounds = [{
    round: 1, formation: round1.formation, squad: squad.slice(), spent: round1.spent,
    score: round1.score, fees: 0, swaps: [], cash,
  }];

  for (let i = 2; i <= numRounds; i++) {
    const vIdx = i - 1;
    const swapsThisRound = [];
    let feesThisRound = 0;

    let improved = true;
    while (improved) {
      improved = false;
      for (let s = 0; s < squad.length; s++) {
        const out = squad[s];
        const priceOut = priceAtStartOfRound(out, i);
        const usedKeys = new Set(squad.map(p => p.key));
        const country = {};
        squad.forEach(p => country[p.hold] = (country[p.hold] || 0) + 1);

        let best = null, bestGain = 0, bestCashNeeded = 0, bestFee = 0;
        for (const cand of players) {
          if (cand.pos !== out.pos || usedKeys.has(cand.key)) continue;
          const wouldBeCount = cand.hold === out.hold ? (country[cand.hold] || 0) : (country[cand.hold] || 0) + 1;
          if (wouldBeCount > MAX_PER_COUNTRY) continue;

          const priceIn = priceAtStartOfRound(cand, i);
          const fee = Math.round(priceIn * 0.01);
          const gain = (cand.vaekst[vIdx] || 0) - (out.vaekst[vIdx] || 0) - fee;
          const cashNeeded = priceIn + fee - priceOut;
          if (gain > bestGain && cashNeeded <= cash) {
            best = cand; bestGain = gain; bestCashNeeded = cashNeeded; bestFee = fee;
          }
        }

        if (best) {
          cash -= bestCashNeeded;
          feesThisRound += bestFee;
          swapsThisRound.push({ out, in: best, fee: bestFee });
          squad[s] = best;
          improved = true;
        }
      }
    }

    const roundScore = squad.reduce((s, p) => s + (p.vaekst[vIdx] || 0), 0) + Math.max(...squad.map(p => p.vaekst[vIdx] || 0));
    const netto = roundScore - feesThisRound;
    cumulativeNetto += netto;
    cumulativeFees += feesThisRound;
    cash *= 1.01;

    rounds.push({ round: i, squad: squad.slice(), score: roundScore, fees: feesThisRound, swaps: swapsThisRound, cash });
  }

  return { rounds, cumulativeNetto, cumulativeFees, numRounds };
}

function printReport({ rounds, cumulativeNetto, cumulativeFees, numRounds }) {
  console.log('═'.repeat(70));
  console.log('  GULDHOLD — ideal trup runde for runde (ubegrænsede skift)');
  console.log('═'.repeat(70));

  for (const r of rounds) {
    const vIdx = r.round - 1;
    const captain = r.squad.reduce((a, p) => (p.vaekst[vIdx] || 0) > (a.vaekst[vIdx] || 0) ? p : a);
    console.log(`\nRunde ${r.round}${r.formation ? ` (${r.formation})` : ''}:`);
    if (r.swaps.length) {
      for (const sw of r.swaps) {
        console.log(`  Skift: ${sw.out.navn} (${sw.out.hold}) → ${sw.in.navn} (${sw.in.hold})  [gebyr ${fmtKr(sw.fee)}]`);
      }
    } else if (r.round > 1) {
      console.log('  Ingen skift — eksisterende trup var stadig optimal.');
    }
    console.log(`  Kaptajn: ${captain.navn} (${captain.hold}) → ${fmtKr(captain.vaekst[vIdx] || 0)} ×2`);
    console.log(`  Rundescore: ${fmtKr(r.score)}   Gebyrer: ${fmtKr(r.fees)}   Netto: ${fmtKr(r.score - r.fees)}   Kontant: ${fmtKr(r.cash)}`);
    console.log('  Trup: ' + r.squad.map(p => `${p.navn} (${p.hold})`).join(', '));
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`Samlet netto-score over ${numRounds} runde(r): ${fmtKr(cumulativeNetto)}  (gebyrer i alt: ${fmtKr(cumulativeFees)})`);
  console.log('─'.repeat(70));
}

module.exports = { computeGuldhold };

if (require.main === module) {
  printReport(computeGuldhold());
}
