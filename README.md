# VM Manager 2026 Optimizer

Scripts til at hente spillerdata fra holdet.dk's "VM Manager 2026" og beregne det optimale 11-mands hold ud fra et budget på 50.000.000 kr.

## Filer

- **`hent_spillere.js`** — Henter alle spillere (navn, hold, position, pris, vækst) fra holdet.dk's API og gemmer dem som `holdet_runde1_stats.csv`. Køres kun én gang ved turneringsstart.
- **`opdater_runde.js`** — Køres efter hver af de 8 runder. Henter den aktuelle Pris fra holdet.dk, opdaterer Pris-kolonnen og tilføjer en ny `Vækst Runde N`-kolonne (= ny Pris − gammel Pris). Runde-nummeret findes automatisk ud fra hvor mange `Vækst Runde X`-kolonner der allerede er i CSV-filen. Indeholder et kontroltjek: summen af alle runde-vækst-kolonner skal matche (Pris − Startpris) ifølge API'en — afvigelser printes som advarsler.
- **`holdet_runde1_stats.csv`** — Datasættet. Vokser med en ny `Vækst Runde N`-kolonne for hver gang `opdater_runde.js` køres.
- **`optimal_hold.js`** — Læser CSV-filen og finder det bedst mulige hold for hver tilladt formation (3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1, 5-3-2, 5-4-1) ud fra `Vækst Runde 1`, med maks. 4 spillere pr. land og en valgfri kaptajn-bonus (kaptajnens vækst tæller dobbelt).
- **`hent_statistik.js`** — Logger ind på holdet.dk (login/kodeord fra lokal `.env`-fil) og henter Navn/Position/Hold/Pris/Totalvækst/Vækst fra STATISTIK-siden, som kun rendres i browseren efter login og ikke er tilgængelig via det offentlige API. Gemmer som `holdet_statistik.csv`.
- **`holdet_lib.js`** — Fælles hjælpefunktioner (CSV-indlæsning, pris-ved-runde-start, enkelt-runde-optimering) brugt af `ideal_guldhold.js` og `ideal_solvhold.js`.
- **`ideal_guldhold.js`** — Beregner den ideelle trup runde for runde for et **guldhold** (ubegrænsede spillerskift). Hvert indskift koster 1% af spillerens pris ved skiftets runde i transfergebyr; et skift udføres kun hvis rundens ekstra vækst overstiger gebyret. Inkluderer kaptajn-bonus (højeste vækst tæller dobbelt) og 1% bankrente på ubrugte kontanter mellem runder.
- **`ideal_solvhold.js`** — Samme regelsæt, men for et **sølvhold**: maks. 3 spillerskift i alt over alle 8 runder. Da skift er en begrænset ressource, vurderes hvert muligt skift ud fra dets samlede gevinst resten af turneringen (med fuldt tilbageblik på allerede spillede runder), ikke kun den enkelte runde.
- **`ven_anbefalinger.js`** — Henter venneholdene fra et delt Google Sheet (kolonnerne Spiller, Spil, "Værdi efter Runde N", "Opstilling Runde N") og tjekker for hver runde om den valgte kaptajn var optimal, samt anbefaler skift fra den nyeste kendte opstilling og frem, ud fra om vennen spiller Guld eller Sølv. Arket skal være delt med "Alle med linket".

## Brug

```bash
node hent_spillere.js      # kør én gang ved start
node opdater_runde.js      # kør igen efter hver af de 8 runder
node optimal_hold.js
node ideal_guldhold.js     # kør efter opdater_runde.js, for hver runde
node ideal_solvhold.js     # kør efter opdater_runde.js, for hver runde
node ven_anbefalinger.js   # kør efter opdater_runde.js, for hver runde
node hent_statistik.js     # kræver .env med HOLDET_USERNAME/HOLDET_PASSWORD
```

Kræver Node.js 18+ (bruger indbygget `fetch`) samt `npm install` (Playwright + dotenv) for `hent_statistik.js`.

### Opsætning af `.env` til `hent_statistik.js`

Kopier `.env.example` til `.env` og udfyld dine egne login-oplysninger til holdet.dk:

```
HOLDET_USERNAME=din-email@example.com
HOLDET_PASSWORD=dit-kodeord
```

`.env` er i `.gitignore` og bliver aldrig committet eller sendt nogen steder — den læses kun lokalt af scriptet.
