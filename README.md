# VM Manager 2026 Optimizer

Scripts til at hente spillerdata fra holdet.dk's "VM Manager 2026" og beregne det optimale 11-mands hold ud fra et budget på 50.000.000 kr.

## Filer

- **`hent_spillere.js`** — Henter alle spillere (navn, hold, position, pris, vækst) fra holdet.dk's API og gemmer dem som `holdet_runde1_stats.csv`. Køres kun én gang ved turneringsstart.
- **`opdater_runde.js`** — Køres efter hver af de 8 runder. Henter den aktuelle Pris fra holdet.dk, opdaterer Pris-kolonnen og tilføjer en ny `Vækst Runde N`-kolonne (= ny Pris − gammel Pris). Runde-nummeret findes automatisk ud fra hvor mange `Vækst Runde X`-kolonner der allerede er i CSV-filen. Indeholder et kontroltjek: summen af alle runde-vækst-kolonner skal matche (Pris − Startpris) ifølge API'en — afvigelser printes som advarsler.
- **`holdet_runde1_stats.csv`** — Datasættet. Vokser med en ny `Vækst Runde N`-kolonne for hver gang `opdater_runde.js` køres.
- **`optimal_hold.js`** — Læser CSV-filen og finder det bedst mulige hold for hver tilladt formation (3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1, 5-3-2, 5-4-1) ud fra `Vækst Runde 1`, med maks. 4 spillere pr. land og en valgfri kaptajn-bonus (kaptajnens vækst tæller dobbelt).

## Brug

```bash
node hent_spillere.js      # kør én gang ved start
node opdater_runde.js      # kør igen efter hver af de 8 runder
node optimal_hold.js
```

Kræver Node.js 18+ (bruger indbygget `fetch`).
