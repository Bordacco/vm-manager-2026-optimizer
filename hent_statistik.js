// Henter Navn/Pris/Totalvækst/Vækst fra holdet.dk's STATISTIK-side, som
// kræver login og kun rendres i browseren (ikke tilgængelig via API).
// Login og kodeord læses fra en lokal .env-fil (se .env.example) og
// skrives aldrig til konsollen eller til en fil.

require('dotenv').config();
const fs = require('fs');
const { chromium } = require('playwright');

const USERNAME = process.env.HOLDET_USERNAME;
const PASSWORD = process.env.HOLDET_PASSWORD;
const GAME_URL = 'https://www.holdet.dk/da/fantasy/2026-world-manager';
const TEAM_FILTERS = process.argv.slice(2).length ? process.argv.slice(2) : ['Schweiz'];

if (!USERNAME || !PASSWORD) {
  console.error('FEJL: HOLDET_USERNAME og HOLDET_PASSWORD skal være sat i .env (kopier .env.example).');
  process.exit(1);
}

function csvEscape(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}

// Selve spillet rendres i et iframe på nexus-app-fantasy.holdet.dk, ikke i
// topframen (www.holdet.dk), som kun viser header/login.
async function waitForGameFrame(page, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const frame = page.frames().find(f => /nexus-app-fantasy\.holdet\.dk/.test(f.url()));
    if (frame) return frame;
    await page.waitForTimeout(300);
  }
  throw new Error('Fandt ikke game-iframet (nexus-app-fantasy.holdet.dk).');
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const page = await browser.newPage();

  try {
    await run(page);
  } catch (e) {
    await page.screenshot({ path: 'fejl_screenshot.png' }).catch(() => {});
    console.error('FEJL:', e.message, '— se fejl_screenshot.png');
    await browser.close();
    process.exit(1);
  }
  await browser.close();
})();

async function run(page) {
  console.log('Åbner VM Manager 2026...');
  await page.goto(GAME_URL, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // Luk cookie-samtykke hvis det vises
  const acceptBtn = page.locator('#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, button:has-text("Tillad alle"), button:has-text("Accepter alle")').first();
  if (await acceptBtn.count()) {
    await acceptBtn.click();
    await page.waitForTimeout(1000);
  }

  console.log('Logger ind...');
  const loginLink = page.locator('a, button').filter({ hasText: /^Log ind$/i }).first();
  await loginLink.click();
  await page.waitForTimeout(1500);

  const emailInput = page.locator('input[type="email"], #email').first();
  await emailInput.fill(USERNAME);
  await page.locator('button:has-text("Fortsæt")').first().click();
  await page.waitForTimeout(2000);

  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.waitFor({ timeout: 10000 });
  await passwordInput.fill(PASSWORD);

  const submitBtn = page.locator('button:visible:has-text("Log ind"), button:visible:has-text("Fortsæt")').last();
  await submitBtn.click();
  await page.waitForTimeout(3000);

  // Verificer at login lykkedes (login-linket bør være væk)
  const stillLoggedOut = await page.locator('a, button').filter({ hasText: /^Log ind$/i }).count();
  if (stillLoggedOut > 0) {
    throw new Error('Login lykkedes ikke (login-knappen er stadig synlig). Tjek brugernavn/kodeord i .env.');
  }
  console.log('Login OK.');

  console.log('Navigerer til Statistik...');
  // Selve spillet (faner, spillertabel) kører i et iframe på et andet
  // subdomæne (nexus-app-fantasy.holdet.dk), ikke i topframen.
  const gameFrame = await waitForGameFrame(page);

  const statLink = gameFrame.locator('text=/^statistik$/i').filter({ visible: true }).first();
  await statLink.waitFor({ timeout: 15000 });
  await statLink.click();
  await page.waitForTimeout(2500);

  console.log(`Filtrerer på hold: ${TEAM_FILTERS.join(', ')}...`);
  await gameFrame.locator('button:has-text("Hold")').first().click();
  await page.waitForTimeout(800);
  for (const team of TEAM_FILTERS) {
    await gameFrame.getByText(team, { exact: true }).first().click();
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);

  // --- Scrape tabellen (også inde i game-iframe'et) ---
  // Tabellen er en virtualiseret liste, ikke sideopdelt — nye rækker
  // indlæses ved at scrolle ned i selve tabel-containeren.
  const rowsLocator = gameFrame.locator('table tbody tr, [role="row"]');
  await rowsLocator.first().waitFor({ timeout: 15000 });

  function extractRows(trs) {
    return trs.map(tr => {
      const cells = Array.from(tr.querySelectorAll('td'));
      if (cells.length < 4) return null;
      const navnCell = cells[0];
      const subLines = navnCell.innerText.split('\n').map(s => s.trim()).filter(Boolean);
      const navn = subLines[0] ?? '';
      const holdPos = subLines[1] ?? '';
      const [hold, position] = holdPos.split('·').map(s => s.trim());
      return {
        Navn: navn,
        Position: position ?? '',
        Hold: hold ?? '',
        Pris: cells[1]?.innerText?.trim() ?? '',
        Totalvækst: cells[2]?.innerText?.trim() ?? '',
        Vækst: cells[3]?.innerText?.trim() ?? '',
      };
    }).filter(Boolean);
  }

  // Marker den faktiske virtualiserede scroll-container (den med størst
  // scrollHeight/clientHeight-forhold) med et data-attribut, så Playwright
  // entydigt kan målrette muse-scroll mod den (flere elementer matcher
  // ellers samme klassenavn).
  await gameFrame.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    let best = null, bestRatio = 1;
    for (const e of all) {
      const ratio = e.scrollHeight / Math.max(e.clientHeight, 1);
      if (e.clientHeight > 50 && ratio > bestRatio) { best = e; bestRatio = ratio; }
    }
    if (best) best.setAttribute('data-scroll-target', '1');
  });

  const seen = new Map();
  let stableRounds = 0;
  let scrollAttempt = 0;
  while (stableRounds < 3 && scrollAttempt < 100) {
    const rows = await gameFrame.locator('table tbody tr').evaluateAll(extractRows);
    const before = seen.size;
    for (const r of rows) seen.set(r.Navn + '|' + r.Hold, r);
    if (seen.size === before) stableRounds++; else stableRounds = 0;

    // Den virtuelle liste scroller en bestemt ramme (.bg-surface), ikke
    // hele siden eller selve <table>-elementet (som er en absolut
    // positioneret "spacer" på fuld virtuel højde). Brug containerens
    // EGEN boundingBox (som ikke flytter sig), ikke tabellens.
    const containerBox = await gameFrame.locator('[data-scroll-target="1"]').first().boundingBox();
    if (containerBox) {
      await page.mouse.move(containerBox.x + containerBox.width / 2, containerBox.y + containerBox.height / 2);
      await page.mouse.wheel(0, 500);
    }
    console.log(`  Scroll ${scrollAttempt + 1}: ${seen.size} unikke spillere fundet`);
    await page.waitForTimeout(900);
    scrollAttempt++;
  }

  const allRows = [...seen.values()];
  console.log(`Hentet ${allRows.length} spillere fra statistik-siden.`);

  const headers = ['Navn', 'Position', 'Hold', 'Pris', 'Totalvækst', 'Vækst'];
  const csv = [
    headers.join(','),
    ...allRows.map(r => headers.map(h => csvEscape(r[h])).join(','))
  ].join('\n');

  fs.writeFileSync('holdet_statistik.csv', '﻿' + csv, 'utf8');
  console.log('Gemt: holdet_statistik.csv');
}
