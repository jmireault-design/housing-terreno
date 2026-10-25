/* =====================================================================
   app.js — disposition (carte | finances), redimensionnement, démarrage
   ===================================================================== */
(function (root) {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const mobile = () => window.innerWidth <= 900;
  const read = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* rien */ } };

  function setMode(mode) {
    if (!['map', 'split', 'fin'].includes(mode)) return;
    if (mobile() && mode === 'split') mode = 'fin';
    document.body.dataset.mode = mode;
    document.querySelectorAll('#mode-seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $('#float-map').hidden = !(mobile() && mode !== 'map');
    write('terreno.mode', mode);
    requestAnimationFrame(() => root.TMap && root.TMap.resize());
  }
  $('#mode-seg').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });
  $('#float-map').addEventListener('click', () => setMode('map'));
  // Sur téléphone, la carte se referme quand on ouvre une section des finances depuis la barre d'onglets
  $('#tabs').addEventListener('click', () => { if (mobile()) setMode('fin'); });

  // Largeur de la carte (poignée entre les deux colonnes)
  const gutter = $('#gutter');
  const applyW = (pct) => document.documentElement.style.setProperty('--map-w', `${pct}%`);
  const savedW = parseFloat(read('terreno.mapw', '46')); if (savedW > 15 && savedW < 85) applyW(savedW);
  gutter.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); gutter.setPointerCapture(ev.pointerId); gutter.classList.add('drag'); document.body.classList.add('resizing');
    const app = $('#app'); const r = app.getBoundingClientRect();
    const move = (e) => { const pct = Math.min(85, Math.max(15, ((e.clientX - r.left) / r.width) * 100)); applyW(pct); root.TMap && root.TMap.resize(); };
    const up = () => { gutter.classList.remove('drag'); document.body.classList.remove('resizing'); gutter.removeEventListener('pointermove', move); gutter.removeEventListener('pointerup', up); write('terreno.mapw', parseFloat(document.documentElement.style.getPropertyValue('--map-w')).toFixed(1)); root.TMap && root.TMap.resize(); };
    gutter.addEventListener('pointermove', move); gutter.addEventListener('pointerup', up);
  });

  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { setMode(document.body.dataset.mode); }, 120); });

  root.TerrenoApp = { setMode };
  setMode(mobile() ? 'fin' : read('terreno.mode', 'split'));

})(window);
