// Ideal SØLVHOLD efter hver runde: maks. 3 spillerskift i alt over hele
// turneringen (8 runder), samme transfergebyr som guldhold. Et skift kan
// ændre formation (fx forsvar → midtbane), så længe truppen efter
// skiftet stadig matcher en af de 7 tilladte formationer.
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
// en garanteret global optimum, men den fanger den centrale afvejning:
// store, tidlige, varige forbedringer prioriteres over små marginale skift.
//
// Køres efter hver opdatering af holdet_runde1_stats.csv.

const { BUDGET, loadPlayers, fmtKr, runSilverTrajectory } = require('./holdet_lib');

const MAX_SWAPS = 3;

function computeSolvhold(csvPath = 'holdet_runde1_stats.csv') {
  const { players, numRounds } = loadPlayers(csvPath);
  if (numRounds === 0) throw new Error('Ingen "Vækst Runde N"-kolonner fundet i CSV-filen.');
  return runSilverTrajectory(players, numRounds, { fromRound: 1, baseSquad: [], swapsAllowed: MAX_SWAPS, startCash: BUDGET });
}

function printReport({ rounds, swapLog, cumulativeNetto, cumulativeFees, numRounds }) {
  console.log('═'.repeat(70));
  console.log(`  SØLVHOLD — ideal trup runde for runde (maks. ${MAX_SWAPS} skift i alt, fri formation)`);
  console.log('═'.repeat(70));

  console.log(`\nValgte skift (${swapLog.length} af ${MAX_SWAPS} brugt):`);
  if (!swapLog.length) {
    console.log('  Ingen skift var fordelagtige — start-truppen er stadig bedst.');
  }
  for (const sw of swapLog) {
    console.log(`  Runde ${sw.t}: ${sw.out.navn} (${sw.out.hold}, ${sw.out.pos}) → ${sw.cand.navn} (${sw.cand.hold}, ${sw.cand.pos})  [gebyr ${fmtKr(sw.fee)}, samlet gevinst resten af turneringen: ${fmtKr(sw.benefit)}]`);
  }

  for (const r of rounds) {
    const vIdx = r.round - 1;
    const captain = r.squad.reduce((a, p) => (p.vaekst[vIdx] || 0) > (a.vaekst[vIdx] || 0) ? p : a);
    console.log(`\nRunde ${r.round}:`);
    for (const sw of r.swaps) {
      console.log(`  Skift: ${sw.out.navn} (${sw.out.hold}, ${sw.out.pos}) → ${sw.cand.navn} (${sw.cand.hold}, ${sw.cand.pos})  [gebyr ${fmtKr(sw.fee)}]`);
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
