process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs');

const GAME_ID = 616;
const API = 'https://nexus-app-fantasy-fargate.holdet.dk/api';
const CONCURRENCY = 40;

async function fetchJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function batchFetch(ids, fn, size) {
  const results = [];
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    results.push(...await Promise.all(chunk.map(fn)));
    process.stdout.write(`\r  ${Math.min(i + size, ids.length)}/${ids.length}`);
  }
  console.log();
  return results;
}

// Danish position title → short code
const titleMap = {
  'Målmand': 'MV', 'goalkeeper': 'MV',
  'Forsvar': 'DEF', 'defense': 'DEF',
  'Midtbane': 'MID', 'midfield': 'MID',
  'Angreb': 'ANG', 'attack': 'ANG', 'forward': 'ANG',
};

(async () => {
  console.log('Henter spillerliste...');
  const list = await fetchJson(`${API}/games/${GAME_ID}/players`);
  const priceMap = Object.fromEntries(list.items.map(p => [p.id, p]));
  console.log(`  ${list.items.length} spillere`);

  console.log('Henter detaljer (navn, hold, position)...');
  const details = await batchFetch(list.items.map(p => p.id), async (id) => {
    try { return await fetchJson(`${API}/games/${GAME_ID}/players/${id}`); }
    catch { return { id, person: { firstName: '?', lastName: '?' }, team: { name: '?' }, position: { title: '?', name: '?' } }; }
  }, CONCURRENCY);

  const rows = details.map(d => {
    const base = priceMap[d.id] || {};
    const pos = titleMap[d.position?.title] ?? titleMap[d.position?.name] ?? d.position?.title ?? '?';
    const vækst = (d.price ?? base.price ?? 0) - (d.startPrice ?? base.startPrice ?? 0);
    return {
      Navn: `${d.person?.firstName ?? ''} ${d.person?.lastName ?? ''}`.trim(),
      Hold: d.team?.name ?? '',
      Position: pos,
      Pris: d.price ?? base.price ?? 0,
      Startpris: d.startPrice ?? base.startPrice ?? 0,
      Totalvækst: vækst,
      'Vækst%': base.startPrice ? ((vækst / base.startPrice) * 100).toFixed(2) : '0.00',
      'Runde1-points': base.points ?? 0,
      'Popularitet%': ((base.popularity ?? 0) * 100).toFixed(2),
      UdeAfSpil: d.isOutOfGame ? 'Ja' : 'Nej',
      Skadet: d.isInjured ? 'Ja' : 'Nej',
    };
  });

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => {
      const v = String(r[h] ?? '');
      return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(','))
  ].join('\n');

  const outPath = 'holdet_runde1_stats.csv';
  fs.writeFileSync(outPath, '﻿' + csv, 'utf8');

  const posCount = {};
  rows.forEach(r => posCount[r.Position] = (posCount[r.Position] || 0) + 1);
  console.log(`\nGemt: ${outPath}`);
  console.log(`Spillere: ${rows.length} | Positioner:`, posCount);
})().catch(e => { console.error('FEJL:', e.message); process.exit(1); });
