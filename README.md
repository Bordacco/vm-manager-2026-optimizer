# VM Manager 2026 Optimizer

Scripts til at hente spillerdata fra holdet.dk's "VM Manager 2026" og beregne det optimale 11-mands hold ud fra et budget på 50.000.000 kr.

## Filer

- **`hent_spillere.js`** — Henter alle spillere (navn, hold, position, pris, vækst) fra holdet.dk's API og gemmer dem som `holdet_runde1_stats.csv`.
- **`holdet_runde1_stats.csv`** — Det hentede datasæt.
- **`optimal_hold.js`** — Læser CSV-filen og finder det bedst mulige hold for hver tilladt formation (3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1, 5-3-2, 5-4-1) ud fra Totalvækst, med maks. 4 spillere pr. land og en valgfri kaptajn-bonus (kaptajnens vækst tæller dobbelt).

## Brug

```bash
node hent_spillere.js
node optimal_hold.js
```

Kræver Node.js 18+ (bruger indbygget `fetch`).
