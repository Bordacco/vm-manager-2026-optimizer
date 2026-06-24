// Ideal GULDHOLD efter hver runde: ubegrænsede spillerskift mellem
// runder, og formationen må ændre sig frit fra runde til runde (alle 7
// tilladte formationer genovervejes hver gang). Hvert indskiftet spiller
// koster et transfergebyr på 1% af spillerens pris ved starten af den
// runde, hvor skiftet sker — allerede ejede spillere kan beholdes uden
// gebyr. Da man kan skifte igen i den efterfølgende runde, er det altid
// optimalt at genoptimere truppen fuldt ud runde for runde (i modsætning
// til sølvhold, hvor skift er en begrænset ressource).
//
// Konkret: hver runde får man et "budget" = nuværende kontanter + den
// nuværende trups samlede værdi. optimizeSquad() finder så den bedst
// mulige sammensætning af gammelt (gratis) og nyt (pris + 1% gebyr)
// inden for det budget, over alle 7 formationer.
//
// Køres efter hver opdatering af holdet_runde1_stats.csv (dvs. efter
// opdater_runde.js er kørt for den nyeste runde).

const { BUDGET, loadPlayers, runGoldTrajectory, fmtKr } = require('./holdet_lib');

function computeGuldhold(csvPath = 'holdet_runde1_stats.csv') {
  const { players, numRounds } = loadPlayers(csvPath);
  if (numRounds === 0) throw new Error('Ingen "Vækst Runde N"-kolonner fundet i CSV-filen.');
  return runGoldTrajectory(players, numRounds, { fromRound: 1, baseSquad: [], startCash: BUDGET });
}

function printReport({ rounds, cumulativeNetto, cumulativeFees, numRounds }) {
  console.log('═'.repeat(70));
  console.log('  GULDHOLD — ideal trup runde for runde (ubegrænsede skift, fri formation)');
  console.log('═'.repeat(70));

  for (const r of rounds) {
    const vIdx = r.round - 1;
    const captain = r.squad.reduce((a, p) => (p.vaekst[vIdx] || 0) > (a.vaekst[vIdx] || 0) ? p : a);
    console.log(`\nRunde ${r.round} (${r.formation}):`);
    if (r.swapsIn.length) {
      for (const sw of r.swapsIn) {
        console.log(`  Ind: ${sw.player.navn} (${sw.player.hold}, ${sw.player.pos})  [gebyr ${fmtKr(sw.fee)}]`);
      }
      for (const out of r.swapsOut) {
        console.log(`  Ud:  ${out.navn} (${out.hold}, ${out.pos})`);
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
