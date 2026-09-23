/* Webmap de l'Initiative Fleuve Sénégal – démonstration
 * Toutes les données sont lues dans le dossier data/ :
 *   projets.csv (format d'export Kobo), unites_admin.csv, organisations.csv,
 *   thematiques.csv, historique_traverses50.csv, contexte.json, villes.json, geo/*.geojson
 * Remplacer data/projets.csv suffit à mettre la carte à jour.
 */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ');
const fmtEur = n => n >= 1e6 ? (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M€' : fmt(n / 1000) + ' k€';
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const params = new URLSearchParams(location.search);
const EMBED = params.get('embed') === '1';
if (EMBED) document.body.classList.add('embed');

const YMIN = 2021, YMAX = 2026, ANNEE_REF = 2026;
const PAYS = ['Sénégal', 'Mauritanie', 'Mali', 'Guinée'];
const IND = [['projets', 'Projets'], ['membres', 'Membres IFS'], ['partenaires', 'Partenaires'], ['bailleurs', 'Bailleurs'], ['benef', 'Bénéficiaires']];
const COLONNES = ['id_projet', 'intitule', 'organisation', 'co_porteurs', 'thematiques', 'odd', 'etat', 'annee_debut', 'annee_fin', 'zones', 'beneficiaires_par_zone', 'partenaires', 'bailleurs', 'budget_eur', 'resume'];

let UNITS = {}, REG = {}, ORG = {}, TH = {}, THL = [], CTX = {}, HIST = {}, P = [], QA = { errors: [], warnings: [], total: 0, kept: 0 }, G = {}, VILLES = [];
let allParts = [], allBailleurs = [];

const S = { q: '', pays: new Set(), region: '', unit: '', org: new Set(), theme: new Set(), bailleur: '', part: '', etat: '', y1: YMIN, y2: YMAX,
  ind: 'projets', scale: 'auto', sel: null, view: 'synth', fiche: null };

/* ---------- chargement ---------- */
const getText = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' (' + r.status + ')'); return r.text(); });
const getJSON = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' (' + r.status + ')'); return r.json(); });
const csvRows = t => Papa.parse(t.replace(/^﻿/, ''), { header: true, delimiter: ';', skipEmptyLines: true, transformHeader: h => h.trim() });

Promise.all([
  getText('data/projets.csv'), getText('data/unites_admin.csv'), getText('data/organisations.csv'), getText('data/thematiques.csv'),
  getText('data/historique_traverses50.csv'), getJSON('data/contexte.json'), getJSON('data/villes.json'),
  getJSON('data/geo/pays.geojson'), getJSON('data/geo/regions.geojson'), getJSON('data/geo/unites_admin2.geojson'),
  getJSON('data/geo/cours_eau.geojson'), getJSON('data/geo/ouvrages_omvs.geojson')
]).then(([proj, un, org, th, hist, ctx, villes, g0, g1, g2, gr, go]) => {
  csvRows(un).data.forEach(r => { UNITS[r.code] = r; REG[r.code_region] = { code: r.code_region, nom: r.region, pays: r.pays }; });
  csvRows(org).data.forEach(r => ORG[r.code] = r);
  THL = csvRows(th).data; THL.forEach(r => TH[r.code] = r);
  csvRows(hist).data.forEach(r => HIST[r.code_unite] = +r.nb_projets_2010_2020);
  CTX = ctx; VILLES = villes.villes; G = { a0: g0, a1: g1, a2: g2, riv: gr, omvs: go };
  validate(csvRows(proj));
  start();
}).catch(err => {
  const l = $('#loading'); l.classList.add('err');
  l.innerHTML = `<div style="max-width:420px;padding:16px;text-align:center">Les données n’ont pas pu être chargées (${esc(err.message)}).<br>Si vous ouvrez le fichier directement depuis votre ordinateur, lancez plutôt un petit serveur local (voir le README).</div>`;
});

/* ---------- contrôle qualité (mêmes règles que scripts/valider_donnees.py) ---------- */
function validate(parsed) {
  const cols = parsed.meta.fields || [];
  const missing = COLONNES.filter(c => !cols.includes(c));
  if (missing.length) QA.errors.push({ ligne: '–', id: '–', champ: missing.join(', '), msg: 'Colonnes absentes du fichier. Aucun projet n’a pu être lu.' });
  const seen = new Set(); QA.total = parsed.data.length;
  parsed.data.forEach((r, i) => {
    const ligne = i + 2, id = (r.id_projet || '').trim(), errs = [], warns = [];
    const split = v => (v || '').trim().split(/\s+/).filter(Boolean);
    const list = v => (v || '').split('|').map(s => s.trim()).filter(Boolean);
    if (!id) errs.push(['id_projet', 'Identifiant manquant.']);
    else if (seen.has(id)) errs.push(['id_projet', `Identifiant ${id} en double.`]);
    seen.add(id);
    if (!(r.intitule || '').trim()) errs.push(['intitule', 'Intitulé manquant.']);
    if (!ORG[r.organisation]) errs.push(['organisation', `Organisation « ${r.organisation || ''} » inconnue (voir organisations.csv).`]);
    const co = split(r.co_porteurs); co.filter(c => !ORG[c]).forEach(c => errs.push(['co_porteurs', `Co-porteur « ${c} » inconnu.`]));
    const th = split(r.thematiques); if (!th.length) errs.push(['thematiques', 'Aucune thématique renseignée.']);
    th.filter(t => !TH[t]).forEach(t => errs.push(['thematiques', `Thématique « ${t} » inconnue (voir thematiques.csv).`]));
    const zones = split(r.zones); if (!zones.length) errs.push(['zones', 'Aucune zone d’intervention renseignée.']);
    zones.filter(z => !UNITS[z]).forEach(z => errs.push(['zones', `Code d’unité « ${z} » inconnu (voir unites_admin.csv).`]));
    const d = parseInt(r.annee_debut, 10), f = parseInt(r.annee_fin, 10);
    if (!(d >= 2000 && d <= 2035)) errs.push(['annee_debut', 'Année de début manquante ou invalide.']);
    if (!(f >= 2000 && f <= 2035)) errs.push(['annee_fin', 'Année de fin manquante ou invalide.']);
    if (d && f && d > f) errs.push(['annee_fin', 'L’année de fin précède l’année de début.']);
    if (!['en_cours', 'termine'].includes(r.etat)) errs.push(['etat', `État « ${r.etat || ''} » invalide (en_cours ou termine).`]);
    else if (r.etat === 'termine' && f > ANNEE_REF) warns.push(['etat', `Projet déclaré terminé mais se terminant en ${f}.`]);
    else if (r.etat === 'en_cours' && f && f < ANNEE_REF) warns.push(['etat', `Projet déclaré en cours mais terminé en ${f}.`]);
    const budget = r.budget_eur === '' ? 0 : Number(String(r.budget_eur).replace(/\s/g, '').replace(',', '.'));
    if (Number.isNaN(budget)) warns.push(['budget_eur', 'Budget non numérique, ignoré.']);
    const benef = {};
    split(r.beneficiaires_par_zone).forEach(x => { const [z, n] = x.split(':'); if (!zones.includes(z)) warns.push(['beneficiaires_par_zone', `Bénéficiaires affectés à ${z}, absent des zones.`]); else benef[z] = +n || 0; });
    if (!list(r.bailleurs).length) warns.push(['bailleurs', 'Aucun bailleur renseigné.']);
    errs.forEach(([c, m]) => QA.errors.push({ ligne, id, champ: c, msg: m }));
    warns.forEach(([c, m]) => QA.warnings.push({ ligne, id, champ: c, msg: m }));
    if (errs.length) return;
    P.push({ id, titre: r.intitule.trim(), org: r.organisation, coorg: co, themes: th, odd: split(r.odd).map(Number).filter(Boolean),
      etat: r.etat === 'en_cours' ? 'En cours' : 'Terminé', debut: d, fin: f, zones, benef, partenaires: list(r.partenaires), bailleurs: list(r.bailleurs),
      budget: Number.isNaN(budget) ? 0 : budget, resume: (r.resume || '').trim() });
  });
  QA.kept = P.length;
  allParts = [...new Set(P.flatMap(p => p.partenaires))].sort((a, b) => a.localeCompare(b, 'fr'));
  allBailleurs = [...new Set(P.flatMap(p => p.bailleurs))].sort((a, b) => a.localeCompare(b, 'fr'));
  const b = $('#qaBadge'), n = QA.errors.length + QA.warnings.length;
  b.textContent = n ? n + ' alerte' + (n > 1 ? 's' : '') : 'OK'; b.classList.toggle('ok', !n);
}

/* ---------- filtres ---------- */
const thLabel = c => TH[c] ? TH[c].libelle : c;
const orgName = c => ORG[c] ? ORG[c].nom_court : c;
const orgColor = c => ORG[c] ? ORG[c].couleur : '#888';
function chip(label, pressed, on, dot) { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.setAttribute('aria-pressed', pressed); b.innerHTML = (dot ? `<span class="dot" style="background:${dot}"></span>` : '') + esc(label); b.onclick = on; return b; }
function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
function activeCount() { return (S.q ? 1 : 0) + S.pays.size + (S.region ? 1 : 0) + (S.unit ? 1 : 0) + S.org.size + S.theme.size + (S.bailleur ? 1 : 0) + (S.part ? 1 : 0) + (S.etat ? 1 : 0) + ((S.y1 !== YMIN || S.y2 !== YMAX) ? 1 : 0); }
function buildFilters() {
  const fp = $('#fPays'); fp.innerHTML = ''; PAYS.forEach(p => fp.append(chip(p, S.pays.has(p), () => { toggle(S.pays, p); S.region = ''; S.unit = ''; update(); })));
  const regs = Object.values(REG).filter(r => !S.pays.size || S.pays.has(r.pays)).sort((a, b) => (a.pays + a.nom).localeCompare(b.pays + b.nom, 'fr'));
  $('#fRegion').innerHTML = '<option value="">Toutes les régions</option>' + regs.map(r => `<option value="${esc(r.code)}" ${S.region === r.code ? 'selected' : ''}>${esc(r.nom)} (${esc(r.pays)})</option>`).join('');
  const units = Object.values(UNITS).filter(u => (!S.pays.size || S.pays.has(u.pays)) && (!S.region || u.code_region === S.region)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  $('#fUnit').innerHTML = '<option value="">Toutes les unités</option>' + units.map(u => `<option value="${esc(u.code)}" ${S.unit === u.code ? 'selected' : ''}>${esc(u.nom)} (${esc(u.region)})</option>`).join('');
  const bo = filtered({ skip: 'org' }), bt = filtered({ skip: 'theme' });
  $('#fOrg').innerHTML = Object.values(ORG).map(o => `<label><input type="checkbox" value="${esc(o.code)}" ${S.org.has(o.code) ? 'checked' : ''}><span class="dot" style="background:${o.couleur}"></span>${esc(o.nom_court)}<span class="n">${bo.filter(p => p.org === o.code).length}</span></label>`).join('');
  $('#fTheme').innerHTML = THL.map(t => `<label><input type="checkbox" value="${esc(t.code)}" ${S.theme.has(t.code) ? 'checked' : ''}>${esc(t.libelle)}${t.type === 'transversale' ? '<span class="tag-tr" title="Entrée transversale">T</span>' : ''}<span class="n">${bt.filter(p => p.themes.includes(t.code)).length}</span></label>`).join('');
  $('#fBailleur').innerHTML = '<option value="">Tous les bailleurs</option>' + allBailleurs.map(b => `<option ${S.bailleur === b ? 'selected' : ''}>${esc(b)}</option>`).join('');
  $('#fPart').innerHTML = '<option value="">Tous les partenaires</option>' + allParts.map(b => `<option ${S.part === b ? 'selected' : ''}>${esc(b)}</option>`).join('');
  const fe = $('#fEtat'); fe.innerHTML = ''; [['', 'Tous'], ['En cours', 'En cours'], ['Terminé', 'Terminés']].forEach(([v, l]) => fe.append(chip(l, S.etat === v, () => { S.etat = v; update(); })));
  const yo = a => { let h = ''; for (let y = YMIN; y <= YMAX; y++) h += `<option ${y === a ? 'selected' : ''}>${y}</option>`; return h; };
  $('#y1').innerHTML = yo(S.y1); $('#y2').innerHTML = yo(S.y2);
  const n = activeCount(); $('#nActive').hidden = !n; $('#nActive').textContent = n + (n > 1 ? ' filtres' : ' filtre'); $('#reset').disabled = !n;
}
function filtered(o = {}) {
  return P.filter(p => {
    if (S.q && !(p.titre + ' ' + orgName(p.org) + ' ' + p.partenaires.join(' ') + ' ' + p.bailleurs.join(' ') + ' ' + p.zones.map(z => UNITS[z].nom).join(' ')).toLowerCase().includes(S.q)) return false;
    if (S.pays.size && !p.zones.some(z => S.pays.has(UNITS[z].pays))) return false;
    if (S.region && !p.zones.some(z => UNITS[z].code_region === S.region)) return false;
    if (S.unit && !p.zones.includes(S.unit)) return false;
    if (o.skip !== 'org' && S.org.size && !(S.org.has(p.org) || p.coorg.some(c => S.org.has(c)))) return false;
    if (o.skip !== 'theme' && S.theme.size && !p.themes.some(t => S.theme.has(t))) return false;
    if (S.bailleur && !p.bailleurs.includes(S.bailleur)) return false;
    if (S.part && !p.partenaires.includes(S.part)) return false;
    if (S.etat && p.etat !== S.etat) return false;
    if (p.debut > S.y2 || p.fin < S.y1) return false;
    return true;
  });
}

/* ---------- agrégats ---------- */
const zoneOK = z => (!S.pays.size || S.pays.has(UNITS[z].pays)) && (!S.region || UNITS[z].code_region === S.region) && (!S.unit || z === S.unit);
function agg(list, level) {
  const m = {}, keyOf = z => level === 'a2' ? z : UNITS[z].code_region;
  list.forEach(p => {
    const keys = new Set(p.zones.filter(zoneOK).map(keyOf));
    keys.forEach(k => {
      const a = m[k] || (m[k] = { projets: new Set(), membres: new Set(), partenaires: new Set(), bailleurs: new Set(), benef: 0, list: [] });
      a.projets.add(p.id); a.membres.add(p.org); p.coorg.forEach(c => a.membres.add(c));
      p.partenaires.forEach(x => a.partenaires.add(x)); p.bailleurs.forEach(x => a.bailleurs.add(x)); a.list.push(p);
    });
    p.zones.filter(zoneOK).forEach(z => { const k = keyOf(z); if (m[k]) m[k].benef += p.benef[z] || 0; });
  });
  const out = {}; for (const k in m) { const a = m[k]; out[k] = { projets: a.projets.size, membres: a.membres.size, partenaires: a.partenaires.size, bailleurs: a.bailleurs.size, benef: a.benef, list: a.list }; }
  return out;
}
function breaks(vals) {
  const v = vals.filter(x => x > 0).sort((a, b) => a - b); if (!v.length) return [];
  const q = [.2, .4, .6, .8].map(t => v[Math.min(v.length - 1, Math.floor(t * v.length))]);
  const nice = x => { if (x < 10) return Math.round(x); const p = Math.pow(10, Math.floor(Math.log10(x)) - 1); return Math.round(x / p) * p; };
  return [...new Set(q.map(nice))].filter(x => x > 0);
}
const ramp = () => ['--c1', '--c2', '--c3', '--c4', '--c5'].map(css);
function colorFor(v, br) { if (!v) return css('--nodata'); const r = ramp(); let i = 0; while (i < br.length && v > br[i]) i++; return r[Math.min(i + (5 - br.length - 1), 4)]; }

/* ---------- carte ---------- */
let map, ctry, lyA1, lyA2, lyA1lines, rivers, riverGroup, hist, omvs, benefLy, baseLayer = null, home;
let AGG = { a1: {}, a2: {} }, BR = [], LIST = [];
const BASEMAPS = {
  osm: ['https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', '© contributeurs OpenStreetMap'],
  light: ['https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', '© OpenStreetMap, © CARTO'],
  sat: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Imagerie © Esri, Maxar, Earthstar Geographics'],
};
function level() { return S.scale === 'a1' ? 'a1' : S.scale === 'a2' ? 'a2' : (map.getZoom() >= 6.75 ? 'a2' : 'a1'); }
const keyFeat = (f, lv) => lv === 'a2' ? f.properties.code : f.properties.code;
function start() {
  document.title = CTX.titre + ' – démonstration';
  $('#ttl').textContent = CTX.titre; $('#subttl').textContent = CTX.sous_titre; $('#embedTitle').textContent = CTX.titre;
  map = L.map('map', { zoomSnap: .25, minZoom: 4, maxZoom: 12 });
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Limites : geoBoundaries (CC BY 4.0) · Cours d’eau : Natural Earth');
  map.createPane('units'); map.getPane('units').style.zIndex = 410;
  map.createPane('top'); map.getPane('top').style.zIndex = 450;
  ctry = L.geoJSON(G.a0, { style: style0, interactive: false }).addTo(map);
  lyA2 = L.geoJSON(G.a2, { pane: 'units', onEachFeature: (f, l) => bindUnit(f, l, 'a2') });
  lyA1 = L.geoJSON(G.a1, { pane: 'units', onEachFeature: (f, l) => bindUnit(f, l, 'a1') });
  lyA1lines = L.geoJSON(G.a1, { pane: 'units', interactive: false, style: () => ({ fill: false, color: css('--ink-2'), weight: 1.2, opacity: .55 }) });
  rivers = L.geoJSON(G.riv, { pane: 'top', interactive: false, style: () => ({ color: css('--river'), weight: 2.2, opacity: .9 }) });
  const cities = L.layerGroup(VILLES.map(v => L.circleMarker([v.lat, v.lon], { pane: 'top', radius: 2.6, weight: 1, color: css('--ink'), fillColor: css('--surface'), fillOpacity: 1, interactive: false }).bindTooltip(v.nom, { permanent: true, direction: 'right', className: 'city', offset: [2, 0] })));
  riverGroup = L.layerGroup([rivers, cities]).addTo(map);
  [['Mauritanie', 18.3, -12.6], ['Sénégal', 14.2, -15.7], ['Mali', 15.6, -8.4], ['Guinée', 10.3, -11.6]].forEach(([n, la, lo]) => L.tooltip({ permanent: true, direction: 'center', className: 'country', interactive: false }).setLatLng([la, lo]).setContent(n).addTo(map));
  omvs = L.geoJSON(G.omvs, { pane: 'top', pointToLayer: (f, ll) => L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="omvs-icon"></div>', iconSize: [14, 14] }) }),
    onEachFeature: (f, l) => l.bindTooltip(`<div class="tt"><b>${esc(f.properties.nom)}</b><span>${esc(f.properties.type)} · ${f.properties.mise_en_service}</span><br><span>Position approximative</span></div>`) });
  hist = L.layerGroup(); benefLy = L.layerGroup();
  home = L.geoJSON(G.a1).getBounds();
  map.fitBounds(home, { padding: [20, 20] });
  map.on('zoomend', () => { if (S.scale === 'auto') restyle(); });
  $('#loading').hidden = true;
  readHash();
  wire(); syncSeg(); update();
  if (S.sel || S.fiche) render();
}
function style0() { return { stroke: true, color: css('--line'), weight: 1, fillColor: css('--country'), fillOpacity: baseLayer ? 0 : 1 }; }
function bindUnit(f, l, lv) {
  l.on('mouseover', () => { l.setStyle({ weight: 2.4, color: css('--ink') }); l.bringToFront(); });
  l.on('mouseout', () => restyle());
  l.on('click', () => { S.sel = { lv, k: keyFeat(f, lv) }; S.fiche = null; S.view = 'unit'; showPanel(); render(); restyle(); });
  l.bindTooltip(() => {
    const a = AGG[lv][keyFeat(f, lv)], v = a ? a[S.ind] : 0, lab = IND.find(i => i[0] === S.ind)[1].toLowerCase();
    const sub = lv === 'a2' ? `${f.properties.region}, ${f.properties.pays}` : f.properties.pays;
    return `<div class="tt"><b>${esc(f.properties.nom)}</b><span>${esc(sub)}</span><br>${fmt(v)} ${esc(lab)}</div>`;
  }, { sticky: true });
}
function restyle() {
  const lv = level(), A = AGG[lv], choroOn = $('#lyChoro').checked;
  BR = breaks(Object.values(A).map(a => a[S.ind]));
  const lyr = lv === 'a2' ? lyA2 : lyA1, other = lv === 'a2' ? lyA1 : lyA2;
  if (map.hasLayer(other)) map.removeLayer(other);
  if (!map.hasLayer(lyr)) lyr.addTo(map);
  if (lv === 'a2') { if (!map.hasLayer(lyA1lines)) lyA1lines.addTo(map); } else if (map.hasLayer(lyA1lines)) map.removeLayer(lyA1lines);
  const fo = baseLayer ? .78 : 1;
  lyr.eachLayer(l => {
    const k = keyFeat(l.feature, lv), a = A[k], v = a ? a[S.ind] : 0, sel = S.sel && S.sel.lv === lv && S.sel.k === k;
    l.setStyle({ fillColor: choroOn ? colorFor(v, BR) : css('--nodata'), fillOpacity: choroOn ? (v ? fo : (baseLayer ? .15 : 1)) : (baseLayer ? 0 : .6), color: sel ? css('--focus') : css('--surface'), weight: sel ? 3 : (lv === 'a2' ? .8 : 1.2), opacity: 1 });
  });
  if (S.sel && S.sel.lv === lv) lyr.eachLayer(l => { if (keyFeat(l.feature, lv) === S.sel.k) l.bringToFront(); });
  if ($('#lyBenef').checked) buildBenef(lv);
  legend(lv);
}
function centroidOf(layer) { return layer.getBounds().getCenter(); }
function buildBenef(lv) {
  benefLy.clearLayers(); const A = AGG[lv], lyr = lv === 'a2' ? lyA2 : lyA1;
  const max = Math.max(1, ...Object.values(A).map(a => a.benef));
  lyr.eachLayer(l => { const a = A[keyFeat(l.feature, lv)]; if (!a || !a.benef) return;
    benefLy.addLayer(L.circleMarker(centroidOf(l), { pane: 'top', radius: 4 + 22 * Math.sqrt(a.benef / max), color: css('--ink'), weight: 1.2, fillColor: css('--focus'), fillOpacity: .55 })
      .bindTooltip(`<div class="tt"><b>${esc(l.feature.properties.nom)}</b>${fmt(a.benef)} bénéficiaires</div>`, { sticky: true })
      .on('click', () => l.fire('click'))); });
}
function buildHist() {
  hist.clearLayers();
  lyA2.eachLayer(l => { const id = l.feature.properties.code, n = HIST[id]; if (!n) return;
    hist.addLayer(L.circleMarker(centroidOf(l), { pane: 'top', radius: 4 + Math.sqrt(n) * 3.2, color: css('--hist'), weight: 1.5, dashArray: '3 2', fillColor: css('--hist'), fillOpacity: .12 })
      .on('click', () => l.fire('click'))
      .bindTooltip(`<div class="tt"><b>${esc(l.feature.properties.nom)}</b><span>2010-2020 (Traverses n°50, fictif) : ${n} projet${n > 1 ? 's' : ''}</span></div>`, { sticky: true })); });
}
function legend(lv) {
  const r = ramp(), lab = IND.find(i => i[0] === S.ind)[1]; let rows = '';
  if ($('#lyChoro').checked) {
    rows += `<div class="legend-row"><span class="sw" style="background:${css('--nodata')}"></span>Aucun projet</div>`;
    const off = 5 - BR.length - 1; let lo = 1;
    BR.forEach((b, i) => { rows += `<div class="legend-row"><span class="sw" style="background:${r[i + off]}"></span>${lo === b ? fmt(b) : fmt(lo) + ' – ' + fmt(b)}</div>`; lo = b + 1; });
    const maxv = Math.max(0, ...Object.values(AGG[lv]).map(a => a[S.ind]));
    if (maxv >= lo) rows += `<div class="legend-row"><span class="sw" style="background:${r[4]}"></span>${fmt(lo)}${maxv > lo ? ' – ' + fmt(maxv) : ''}</div>`;
  }
  if ($('#lyBenef').checked) rows += `<div class="legend-row" style="margin-top:6px"><span class="sw" style="background:${css('--focus')};opacity:.7;border-radius:50%;width:14px;height:14px"></span>Bénéficiaires (cercles proportionnels)</div>`;
  if (map.hasLayer(hist)) rows += `<div class="legend-row" style="margin-top:4px"><span class="sw" style="border:1.5px dashed ${css('--hist')};border-radius:50%;width:14px;height:14px"></span>Projets 2010-2020 (historique, non actualisé)</div>`;
  if (map.hasLayer(omvs)) rows += `<div class="legend-row" style="margin-top:4px"><span class="omvs-icon" style="width:10px;height:10px;margin:0 4px"></span>Ouvrage de l’OMVS</div>`;
  $('#legend').innerHTML = `<div class="legend-title">${$('#lyChoro').checked ? esc(lab) + ' par ' + (lv === 'a2' ? 'unité admin 2' : 'région') : 'Légende'}</div>${rows}<div class="legend-hint">${S.scale === 'auto' ? (lv === 'a1' ? 'Zoomez pour afficher les unités admin 2' : 'Dézoomez pour revenir aux régions') : 'Échelle fixée manuellement'}</div>`;
}
function syncSeg() { $('#segInd').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === S.ind)); $('#segScale').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === S.scale)); }
function zoomTo(k, lv) { const lyr = lv === 'a2' ? lyA2 : lyA1; const l = lyr.getLayers().find(l => l.feature.properties.code === k); if (l) map.fitBounds(l.getBounds(), { padding: [30, 30], maxZoom: 9 }); }
function setBase(v) {
  if (baseLayer) { map.removeLayer(baseLayer); baseLayer = null; }
  if (v !== 'none') { const [u, a] = BASEMAPS[v]; baseLayer = L.tileLayer(u, { attribution: a, maxZoom: 18 }).addTo(map); baseLayer.bringToBack(); }
  ctry.setStyle(style0()); restyle();
}

/* ---------- panneau ---------- */
function bars(entries, colorOf) { const max = Math.max(1, ...entries.map(e => e[1])); return `<div class="bars">${entries.map(([k, v]) => `<div class="bar"><div class="t"><div title="${esc(k)}">${esc(k)}</div><div class="track"><div class="fill" style="width:${v / max * 100}%;${colorOf ? `background:${colorOf(k)}` : ''}"></div></div></div><div class="v">${fmt(v)}</div></div>`).join('')}</div>`; }
function countBy(list, fn) { const m = {}; list.forEach(p => [].concat(fn(p)).forEach(k => m[k] = (m[k] || 0) + 1)); return Object.entries(m).sort((a, b) => b[1] - a[1]); }
function yearsChart(list) {
  const ys = []; for (let y = YMIN; y <= YMAX; y++) ys.push([y, list.filter(p => p.debut <= y && p.fin >= y).length]);
  const max = Math.max(1, ...ys.map(y => y[1])), W = 320, H = 120, pl = 26, pb = 20, pt = 14, bw = (W - pl) / ys.length;
  const step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : 10, top = Math.ceil(max / step) * step;
  let g = ''; for (let t = 0; t <= top; t += step) { const y = H - pb - (t / top) * (H - pb - pt); g += `<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}" stroke="${css('--line')}" stroke-width="1"/><text x="${pl - 5}" y="${y + 4}" text-anchor="end">${t}</text>`; }
  const b = ys.map(([y, v], i) => { const h = (v / top) * (H - pb - pt), x = pl + i * bw + bw * .18; return `<rect x="${x}" y="${H - pb - h}" width="${bw * .64}" height="${h}" rx="2" fill="${css('--accent')}"/><text x="${x + bw * .32}" y="${H - pb - h - 4}" text-anchor="middle" style="font-weight:600;fill:${css('--ink')}">${v}</text><text x="${x + bw * .32}" y="${H - 4}" text-anchor="middle">${y}</text>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Projets actifs par année">${g}${b}</svg>`;
}
const benefOf = p => Object.entries(p.benef).filter(([z]) => zoneOK(z)).reduce((s, [, v]) => s + v, 0);
function kpis(list, benef) {
  const s = new Set(), pa = new Set(), ba = new Set(); list.forEach(p => { s.add(p.org); p.coorg.forEach(c => s.add(c)); p.partenaires.forEach(x => pa.add(x)); p.bailleurs.forEach(x => ba.add(x)); });
  const bud = list.reduce((a, p) => a + p.budget, 0), co = list.filter(p => p.coorg.length).length;
  return `<div class="kpis"><div class="kpi"><b>${list.length}</b><span>projets</span></div><div class="kpi"><b>${s.size}</b><span>membres IFS</span></div><div class="kpi"><b>${pa.size}</b><span>partenaires</span></div><div class="kpi"><b>${ba.size}</b><span>bailleurs</span></div><div class="kpi"><b>${fmt(benef)}</b><span>bénéficiaires</span></div><div class="kpi"><b>${fmtEur(bud)}</b><span>budget cumulé</span></div></div>
  <div class="unit-sub" style="margin-top:4px">Dont <b>${co}</b> projet${co > 1 ? 's' : ''} co-porté${co > 1 ? 's' : ''} par plusieurs membres de l’IFS.</div>`;
}
function projItem(p) { return `<li><button type="button" data-p="${esc(p.id)}"><span class="pt">${esc(p.titre)}</span><span class="pm"><span class="dot" style="background:${orgColor(p.org)}"></span>${esc(orgName(p.org))}${p.coorg.length ? ' + ' + p.coorg.map(orgName).map(esc).join(', ') : ''} · ${p.debut}-${p.fin} <span class="state ${p.etat === 'En cours' ? 'on' : 'off'}">${esc(p.etat)}</span></span></button></li>`; }
function bindProjects(el) { el.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { S.fiche = b.dataset.p; render(); el.scrollTop = 0; writeHash(); }); }
function render() {
  const el = $('#panel');
  if (S.fiche) {
    const p = P.find(x => x.id === S.fiche); if (!p) { S.fiche = null; return render(); }
    const ben = Object.values(p.benef).reduce((a, b) => a + b, 0);
    el.innerHTML = `<div class="crumb"><button class="back" type="button" id="bk">← ${S.sel ? 'Retour à l’unité' : 'Retour à la synthèse'}</button></div>
    <div class="fiche"><div class="unit-sub">Fiche projet · ${esc(p.id)}</div><h2 class="unit-title">${esc(p.titre)}</h2>
    <dl><dt>Porteur</dt><dd><span class="pills"><span class="pill"><span class="dot" style="background:${orgColor(p.org)};display:inline-block;margin-right:5px"></span>${esc(orgName(p.org))}</span>${p.coorg.map(c => `<span class="pill">co-porté · ${esc(orgName(c))}</span>`).join('')}</span></dd>
    <dt>État</dt><dd><span class="state ${p.etat === 'En cours' ? 'on' : 'off'}">${esc(p.etat)}</span> · ${p.debut} – ${p.fin}</dd>
    <dt>Thématiques</dt><dd class="pills">${p.themes.map(t => `<span class="pill">${esc(thLabel(t))}</span>`).join('')}</dd>
    <dt>ODD</dt><dd class="pills">${p.odd.map(o => `<span class="odd">ODD ${o}</span>`).join('')}</dd>
    <dt>Zones</dt><dd>${p.zones.map(z => `<button class="back" type="button" data-z="${esc(z)}">${esc(UNITS[z].nom)}</button> <span style="color:var(--ink-3)">(${esc(UNITS[z].pays)})</span>`).join(', ')}</dd>
    <dt>Partenaires</dt><dd>${p.partenaires.map(esc).join(' ; ')}</dd>
    <dt>Bailleurs</dt><dd>${p.bailleurs.map(esc).join(' ; ')}</dd>
    <dt>Budget global</dt><dd>${fmt(p.budget)} €</dd>
    <dt>Bénéficiaires</dt><dd>${fmt(ben)}</dd></dl>
    <p>${esc(p.resume)}</p></div>
    <div class="panel-actions"><button class="btn" type="button" id="shareP">Copier le lien de ce projet</button></div>`;
    $('#bk').onclick = () => { S.fiche = null; render(); writeHash(); };
    $('#shareP').onclick = copyLink;
    el.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { S.sel = { lv: 'a2', k: b.dataset.z }; S.fiche = null; S.view = 'unit'; if (S.scale === 'a1') S.scale = 'auto'; syncSeg(); zoomTo(b.dataset.z, 'a2'); render(); restyle(); writeHash(); });
    return;
  }
  if (S.view === 'qa') return renderQA(el);
  if (S.view === 'about') return renderAbout(el);
  if (S.view === 'unit' && S.sel) {
    const a = AGG[S.sel.lv][S.sel.k]; let name, sub;
    if (S.sel.lv === 'a2') { const u = UNITS[S.sel.k]; name = u.nom; sub = `Unité admin 2 · ${u.region}, ${u.pays}`; } else { const r = REG[S.sel.k]; name = r.nom; sub = `Région · ${r.pays}`; }
    const list = a ? a.list : [], h = S.sel.lv === 'a2' ? HIST[S.sel.k] : Object.keys(UNITS).filter(z => UNITS[z].code_region === S.sel.k).reduce((s, z) => s + (HIST[z] || 0), 0);
    el.innerHTML = `<div class="crumb"><button class="back" type="button" id="bk">← Synthèse du bassin</button></div>
      <h2 class="unit-title">${esc(name)}</h2><div class="unit-sub">${esc(sub)}</div>
      ${kpis(list, a ? a.benef : 0)}
      <div class="unit-sub" style="margin-top:6px">Période 2010-2020 (Traverses n°50, fictif) : <b>${h || 0}</b> projet${h > 1 ? 's' : ''}.</div>
      ${list.length ? `<div class="block"><span class="lbl">Membres IFS présents</span>${bars(countBy(list, p => [p.org, ...p.coorg]).map(([k, v]) => [orgName(k), v]), k => orgColor(Object.keys(ORG).find(c => ORG[c].nom_court === k)))}</div>
      <div class="block"><span class="lbl">Thématiques</span>${bars(countBy(list, p => p.themes).map(([k, v]) => [thLabel(k), v]))}</div>
      <div class="block"><span class="lbl">Projets (${list.length})</span><ul class="plist">${list.slice().sort((x, y) => y.fin - x.fin).map(projItem).join('')}</ul></div>` : `<p class="empty">Aucun projet ne correspond aux filtres actifs dans cette unité.</p>`}`;
    $('#bk').onclick = () => { S.sel = null; S.view = 'synth'; render(); restyle(); writeHash(); };
    bindProjects(el); writeHash(); return;
  }
  if (S.view === 'all') {
    el.innerHTML = `<div class="crumb"><button class="back" type="button" id="bk">← Synthèse</button></div><h2 class="h">Projets de la sélection (${LIST.length})</h2><ul class="plist">${LIST.map(projItem).join('')}</ul>`;
    $('#bk').onclick = () => { S.view = 'synth'; render(); }; bindProjects(el); return;
  }
  const list = LIST, ben = list.reduce((a, p) => a + benefOf(p), 0), n = activeCount();
  el.innerHTML = `<h2 class="h">Synthèse de la sélection</h2><div class="unit-sub">${n ? `${n} filtre${n > 1 ? 's' : ''} actif${n > 1 ? 's' : ''}` : 'Ensemble du bassin, sans filtre'}</div>
    ${kpis(list, ben)}
    ${list.length ? `
    <div class="block"><span class="lbl">Projets actifs par année</span><div class="yrs">${yearsChart(list)}</div></div>
    <div class="block"><span class="lbl">Répartition thématique</span>${bars(countBy(list, p => p.themes).map(([k, v]) => [thLabel(k), v]))}</div>
    <div class="block"><span class="lbl">Par pays</span>${bars(countBy(list, p => [...new Set(p.zones.map(z => UNITS[z].pays))]))}</div>
    <div class="block"><span class="lbl">Par organisation porteuse</span>${bars(countBy(list, p => p.org).map(([k, v]) => [orgName(k), v]), k => orgColor(Object.keys(ORG).find(c => ORG[c].nom_court === k)))}</div>
    <div class="block"><span class="lbl">Principaux bailleurs</span>${bars(countBy(list, p => p.bailleurs).slice(0, 5))}</div>
    <div class="panel-actions"><button class="btn primary" type="button" id="csv">Télécharger la sélection (CSV)</button><button class="btn" type="button" id="lst">Voir la liste des projets</button></div>
    ` : `<p class="empty">Aucun projet ne correspond à ces filtres. Élargissez la période ou retirez un filtre.</p>`}
    <p class="note">Cliquez sur une unité de la carte pour afficher ses projets. Les chiffres se recalculent à chaque filtre. <button class="link-btn" type="button" id="meth">Règles de calcul</button></p>`;
  const c = $('#csv'); if (c) c.onclick = downloadCSV;
  const l = $('#lst'); if (l) l.onclick = () => { S.view = 'all'; render(); };
  $('#meth').onclick = showMethod;
}
function renderQA(el) {
  const row = (x, sev) => `<div class="qa-row"><span class="sev ${sev}">${sev === 'err' ? 'Ligne écartée' : 'Avertissement'}</span><b>Ligne ${x.ligne} · ${esc(x.id)} · ${esc(x.champ)}</b><span>${esc(x.msg)}</span></div>`;
  el.innerHTML = `<div class="crumb"><button class="back" type="button" id="bk">← Synthèse</button></div>
    <h2 class="unit-title">Qualité des données</h2><div class="unit-sub">Contrôle automatique de <code>data/projets.csv</code> à chaque chargement</div>
    <div class="qa-sum"><div class="kpi"><b>${QA.total}</b><span>lignes lues</span></div><div class="kpi"><b>${QA.kept}</b><span>projets publiés</span></div><div class="kpi"><b>${QA.total - QA.kept}</b><span>lignes écartées</span></div></div>
    <p class="note" style="margin-top:0">Les lignes en erreur ne sont pas affichées sur la carte ; les avertissements n’empêchent pas la publication. Les mêmes règles sont appliquées par <code>scripts/valider_donnees.py</code> lors de chaque mise à jour du fichier sur GitHub. Dans cette démonstration, deux lignes contiennent des anomalies volontaires.</p>
    <div class="qa-list">${QA.errors.map(x => row(x, 'err')).join('')}${QA.warnings.map(x => row(x, 'warn')).join('')}${!QA.errors.length && !QA.warnings.length ? '<p class="empty">Aucune anomalie détectée.</p>' : ''}</div>`;
  $('#bk').onclick = () => { S.view = 'synth'; render(); };
}
function renderAbout(el) {
  el.innerHTML = `<div class="crumb"><button class="back" type="button" id="bk">← Synthèse</button></div>
    <h2 class="unit-title">À propos</h2>
    <div class="prose"><p style="background:var(--demo-bg);color:var(--demo-ink);padding:8px 10px;border-radius:8px">${esc(CTX.avertissement)}</p>
    <h3>L’Initiative Fleuve Sénégal</h3><p>${esc(CTX.presentation_ifs)}</p>
    <h3>Les membres</h3><div class="members">${Object.values(ORG).map(o => `<div><span class="dot" style="background:${o.couleur}"></span><b>${esc(o.nom_court)}</b><span>${o.nom_complet !== o.nom_court ? esc(o.nom_complet) : ''}</span></div>`).join('')}</div>
    <h3>Le bassin du fleuve Sénégal</h3><p>${esc(CTX.presentation_bassin)}</p>
    <h3>Objectif de la webmap</h3><p>${esc(CTX.objectif_webmap)}</p>
    <h3>Mise à jour</h3><p>Les textes de cette page sont modifiables dans <code>data/contexte.json</code> et <code>data/organisations.csv</code>, les projets dans <code>data/projets.csv</code> (export Kobo). Aucune ligne de code n’est à modifier.</p>
    <p style="color:var(--ink-3)">${esc(CTX.contact)}</p></div>`;
  $('#bk').onclick = () => { S.view = 'synth'; render(); };
}
function showMethod() {
  modal(`<h2 id="ovT">Règles de calcul et sources</h2><ul>
  <li><b>Comptage</b> : un projet présent dans plusieurs unités est compté dans chacune, mais une seule fois dans les totaux d’une région et du bassin.</li>
  <li><b>Membres IFS</b> : organisation porteuse et co-porteurs membres de l’IFS.</li>
  <li><b>Bénéficiaires</b> : sommés par unité à partir de la ventilation par zone fournie par la collecte ; le budget est affiché au niveau du projet.</li>
  <li><b>Période</b> : un projet est retenu s’il est actif au moins une année dans la période choisie.</li>
  <li><b>Classes de couleur</b> : quantiles recalculés à chaque filtre.</li>
  <li><b>Limites administratives</b> : geoBoundaries (CC BY 4.0), 15 régions et leurs unités de niveau 2 ; référentiel définitif à valider avec l’IFS.</li>
  <li><b>Cours d’eau</b> : Natural Earth. <b>Ouvrages OMVS</b> : positions approximatives.</li></ul>
  <div class="panel-actions"><button class="btn primary" type="button" id="ovC">Fermer</button></div>`);
}

/* ---------- export, partage, état dans l'URL ---------- */
function downloadCSV() {
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['id_projet', 'intitule', 'organisation', 'co_porteurs', 'thematiques', 'etat', 'annee_debut', 'annee_fin', 'zones', 'pays', 'partenaires', 'bailleurs', 'budget_eur', 'beneficiaires'].join(';')]
    .concat(LIST.map(p => [p.id, q(p.titre), orgName(p.org), q(p.coorg.map(orgName).join(', ')), q(p.themes.map(thLabel).join(', ')), p.etat, p.debut, p.fin, q(p.zones.map(z => UNITS[z].nom).join(', ')), q([...new Set(p.zones.map(z => UNITS[z].pays))].join(', ')), q(p.partenaires.join(', ')), q(p.bailleurs.join(', ')), p.budget, Object.values(p.benef).reduce((a, b) => a + b, 0)].join(';')));
  const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'selection_projets_ifs.csv'; document.body.append(a); a.click(); a.remove();
  toast(`${LIST.length} projets exportés`);
}
function stateString() {
  const h = new URLSearchParams();
  if (S.q) h.set('q', S.q); if (S.pays.size) h.set('pays', [...S.pays].join(',')); if (S.region) h.set('region', S.region); if (S.unit) h.set('unite', S.unit);
  if (S.org.size) h.set('org', [...S.org].join(',')); if (S.theme.size) h.set('theme', [...S.theme].join(',')); if (S.bailleur) h.set('bailleur', S.bailleur); if (S.part) h.set('partenaire', S.part);
  if (S.etat) h.set('etat', S.etat); if (S.y1 !== YMIN) h.set('de', S.y1); if (S.y2 !== YMAX) h.set('a', S.y2); if (S.ind !== 'projets') h.set('indicateur', S.ind);
  if (S.sel) h.set('sel', S.sel.lv + ':' + S.sel.k); if (S.fiche) h.set('projet', S.fiche);
  return h.toString();
}
let hashLock = false;
function writeHash() { const s = stateString(); hashLock = true; history.replaceState(null, '', s ? '#' + s : location.pathname + location.search); setTimeout(() => hashLock = false, 0); }
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1)); if (!location.hash) return;
  S.q = h.get('q') || ''; $('#q').value = S.q;
  S.pays = new Set((h.get('pays') || '').split(',').filter(x => PAYS.includes(x)));
  S.region = REG[h.get('region')] ? h.get('region') : ''; S.unit = UNITS[h.get('unite')] ? h.get('unite') : '';
  S.org = new Set((h.get('org') || '').split(',').filter(x => ORG[x])); S.theme = new Set((h.get('theme') || '').split(',').filter(x => TH[x]));
  S.bailleur = h.get('bailleur') || ''; S.part = h.get('partenaire') || ''; S.etat = h.get('etat') || '';
  S.y1 = +h.get('de') || YMIN; S.y2 = +h.get('a') || YMAX; if (IND.some(i => i[0] === h.get('indicateur'))) S.ind = h.get('indicateur');
  const sel = h.get('sel'); if (sel) { const [lv, k] = sel.split(':'); if ((lv === 'a2' && UNITS[k]) || (lv === 'a1' && REG[k])) { S.sel = { lv, k }; S.view = 'unit'; S.scale = lv; } }
  if (h.get('projet') && P.some(p => p.id === h.get('projet'))) S.fiche = h.get('projet');
}
function copyLink() {
  writeHash(); const url = location.href;
  const fb = () => modal(`<h2 id="ovT">Lien de cette vue</h2><p style="color:var(--ink-2)">Copiez le lien ci-dessous :</p><textarea class="copy" id="ta" readonly>${esc(url)}</textarea><div class="panel-actions"><button class="btn" type="button" id="ovC">Fermer</button></div>`, () => { const t = $('#ta'); t.focus(); t.select(); });
  try { navigator.clipboard.writeText(url).then(() => toast('Lien copié : il rouvre la carte avec les mêmes filtres'), fb); } catch (e) { fb(); }
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, 2800); }
function modal(html, after) { $('#ovBody').innerHTML = html; $('#ov').hidden = false; const c = $('#ovC'); if (c) { c.onclick = closeM; c.focus(); } if (after) after(); }
function closeM() { $('#ov').hidden = true; }

/* ---------- événements ---------- */
function wire() {
  $('#fOrg').addEventListener('change', e => { toggle(S.org, e.target.value); update(); });
  $('#fTheme').addEventListener('change', e => { toggle(S.theme, e.target.value); update(); });
  $('#fRegion').onchange = e => { S.region = e.target.value; S.unit = ''; update(); if (S.region) zoomTo(S.region, 'a1'); };
  $('#fUnit').onchange = e => { S.unit = e.target.value; update(); if (S.unit) { if (S.scale === 'a1') { S.scale = 'auto'; syncSeg(); } zoomTo(S.unit, 'a2'); } };
  $('#fBailleur').onchange = e => { S.bailleur = e.target.value; update(); };
  $('#fPart').onchange = e => { S.part = e.target.value; update(); };
  $('#y1').onchange = e => { S.y1 = +e.target.value; if (S.y1 > S.y2) S.y2 = S.y1; update(); };
  $('#y2').onchange = e => { S.y2 = +e.target.value; if (S.y2 < S.y1) S.y1 = S.y2; update(); };
  let qt; $('#q').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); update(); }, 150); };
  $('#reset').onclick = () => { Object.assign(S, { q: '', region: '', unit: '', bailleur: '', part: '', etat: '', y1: YMIN, y2: YMAX }); S.pays.clear(); S.org.clear(); S.theme.clear(); $('#q').value = ''; update(); map.fitBounds(home, { padding: [20, 20] }); };
  const segInd = $('#segInd'); IND.forEach(([k, l]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.dataset.k = k; b.onclick = () => { S.ind = k; syncSeg(); restyle(); writeHash(); }; segInd.append(b); });
  const segScale = $('#segScale'); [['auto', 'Auto'], ['a1', 'Régions'], ['a2', 'Admin 2']].forEach(([k, l]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = l; b.dataset.k = k; b.onclick = () => { S.scale = k; syncSeg(); restyle(); }; segScale.append(b); });
  $('#home').onclick = () => map.fitBounds(home, { padding: [20, 20] });
  const pop = $('#layersPop'), lb = $('#btnLayers');
  lb.onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; lb.setAttribute('aria-expanded', !pop.hidden); };
  document.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== lb) { pop.hidden = true; lb.setAttribute('aria-expanded', 'false'); } });
  pop.querySelectorAll('input[name=bm]').forEach(r => r.onchange = () => setBase(r.value));
  $('#lyChoro').onchange = () => restyle();
  $('#lyBenef').onchange = e => { if (e.target.checked) { benefLy.addTo(map); restyle(); } else { map.removeLayer(benefLy); legend(level()); } };
  $('#lyRiver').onchange = e => e.target.checked ? riverGroup.addTo(map) : map.removeLayer(riverGroup);
  $('#lyOmvs').onchange = e => { e.target.checked ? omvs.addTo(map) : map.removeLayer(omvs); legend(level()); };
  $('#lyHist').onchange = e => { if (e.target.checked) { buildHist(); hist.addTo(map); } else map.removeLayer(hist); legend(level()); };
  $('#btnAbout').onclick = () => { S.view = 'about'; S.fiche = null; showPanel(); render(); };
  $('#btnQA').onclick = () => { S.view = 'qa'; S.fiche = null; showPanel(); render(); };
  $('#btnShare').onclick = copyLink;
  $('#btnEmbedFilters').onclick = () => { document.body.classList.toggle('show-filters'); setTimeout(() => map.invalidateSize(), 50); };
  $('#ov').onclick = e => { if (e.target.id === 'ov') closeM(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#ov').hidden) closeM(); if (!pop.hidden) pop.hidden = true; } });
  $('#tabF').onclick = () => setTab('F'); $('#tabS').onclick = () => setTab('S');
  matchMedia('(max-width:860px)').addEventListener('change', () => { layoutMode(); map.invalidateSize(); });
  layoutMode();
  const retheme = () => { ctry.setStyle(style0()); rivers.setStyle({ color: css('--river') }); lyA1lines.setStyle({ color: css('--ink-2') }); if (map.hasLayer(hist)) buildHist(); restyle(); render(); };
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  window.addEventListener('hashchange', () => { if (hashLock) return; readHash(); update(); });
}
function showPanel() { if (matchMedia('(max-width:860px)').matches) setTab('S'); }
function setTab(t) { $('#tabF').setAttribute('aria-selected', t === 'F'); $('#tabS').setAttribute('aria-selected', t === 'S'); $('#filters').dataset.hide = t === 'F' ? '0' : '1'; $('#panel').dataset.hide = t === 'S' ? '0' : '1'; }
function layoutMode() { if (!matchMedia('(max-width:860px)').matches) { $('#filters').dataset.hide = '0'; $('#panel').dataset.hide = '0'; } else setTab($('#tabF').getAttribute('aria-selected') === 'true' ? 'F' : 'S'); }

function update() {
  LIST = filtered(); AGG = { a1: agg(LIST, 'a1'), a2: agg(LIST, 'a2') };
  if (S.view === 'all') S.view = 'synth';
  buildFilters(); restyle(); render(); writeHash();
}
})();
