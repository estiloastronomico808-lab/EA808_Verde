(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const video = $('cam');
  const view = $('view');
  const vctx = view.getContext('2d');
  const proc = document.createElement('canvas');          // capa de la persona (procesada)
  const pctx = proc.getContext('2d', { willReadFrequently: true });

  const PREVIEW_MAX_W = 720;   // resolución de procesamiento en vivo
  const CAPTURE_MAX_W = 1920;  // resolución de la foto final

  const state = {
    stream: null,
    facing: 'environment',   // cámara trasera por defecto; el botón ⟲ cambia a la frontal
    deviceId: null,
    bgs: [],                 // { id, name, src, img|null }
    bgId: 'none',
    sampling: false,
    busy: false,
    lastBlob: null,
    s: { similarity: 0.35, smoothness: 0.12, spill: 0.6, key: '#00b140', mirror: true }
  };

  /* ---------- utilidades ---------- */
  function showMsg(text, ms) {
    const m = $('msg');
    m.textContent = text; m.hidden = false;
    clearTimeout(showMsg.t);
    if (ms) showMsg.t = setTimeout(() => { m.hidden = true; }, ms);
  }
  function hideMsg() { $('msg').hidden = true; }

  function saveSettings() {
    try { localStorage.setItem('cabina.settings', JSON.stringify(state.s)); } catch (e) {}
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem('cabina.settings');
      if (raw) Object.assign(state.s, JSON.parse(raw));
    } catch (e) {}
    $('rngSim').value = state.s.similarity;
    $('rngSmooth').value = state.s.smoothness;
    $('rngSpill').value = state.s.spill;
    $('clrKey').value = state.s.key;
    $('chkMirror').checked = state.s.mirror;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function drawCover(ctx, img, w, h) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function drawChecker(ctx, w, h) {
    const s = Math.max(12, Math.round(w / 40));
    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        ctx.fillStyle = ((x / s + y / s) & 1) ? '#2a2f36' : '#1c2026';
        ctx.fillRect(x, y, s, s);
      }
    }
  }

  function currentBg() { return state.bgs.find((b) => b.id === state.bgId) || null; }

  /* ---------- cámara ---------- */
  // Prueba varias formas de pedir la cámara; muchos celulares ignoran facingMode si no es "exact".
  async function openStream() {
    const base = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const tries = [];
    if (state.deviceId) tries.push(Object.assign({}, base, { deviceId: { exact: state.deviceId } }));
    tries.push(Object.assign({}, base, { facingMode: { exact: state.facing } }));
    tries.push(Object.assign({}, base, { facingMode: state.facing }));
    tries.push(base);
    let last;
    for (const v of tries) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: false, video: v });
      } catch (err) {
        last = err;
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw err;
      }
    }
    throw last;
  }

  async function startCamera() {
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showMsg('Este navegador no permite usar la cámara. Abre la app desde HTTPS (o localhost).');
      return;
    }
    try {
      state.stream = await openStream();
      const st = state.stream.getVideoTracks()[0].getSettings();
      if (st.deviceId) state.deviceId = st.deviceId;
      if (st.facingMode === 'user' || st.facingMode === 'environment') state.facing = st.facingMode;
      video.srcObject = state.stream;
      await video.play();
      showMsg('Cámara ' + (state.facing === 'environment' ? 'trasera' : 'frontal') + ' · ' +
        video.videoWidth + '×' + video.videoHeight, 2500);
      setTimeout(() => {
        if (state.stream && !video.videoWidth) {
          showMsg('La cámara no entrega imagen. Cierra otras apps que la estén usando y recarga.');
        }
      }, 4000);
    } catch (err) {
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      showMsg(denied
        ? 'Permiso de cámara denegado. Actívalo en los ajustes del sitio y recarga.'
        : 'No se pudo abrir la cámara (' + (err && err.name) + ').');
    }
  }
  function stopCamera() {
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }

  /* ---------- procesamiento ---------- */
  function chromaOpts() {
    return {
      key: Chroma.hexToRgb(state.s.key),
      similarity: state.s.similarity,
      smoothness: state.s.smoothness,
      spill: state.s.spill
    };
  }

  // Dibuja el frame de video en `canvas` (con espejo opcional) y quita el verde.
  function cutout(canvas, ctx, maxW) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const w = Math.min(vw, maxW), h = Math.round(w * vh / vw);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.save();
    if (state.s.mirror && state.facing === 'user') { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    const frame = ctx.getImageData(0, 0, w, h);
    Chroma.applyChroma(frame.data, chromaOpts());
    ctx.putImageData(frame, 0, 0);
    return { w, h };
  }

  function composite(target, tctx, person, w, h, forExport) {
    if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
    tctx.clearRect(0, 0, w, h);
    const bg = currentBg();
    if (bg && bg.img) drawCover(tctx, bg.img, w, h);
    else if (!forExport) drawChecker(tctx, w, h);
    tctx.drawImage(person, 0, 0, w, h);
  }

  function loop() {
    if (state.stream && video.videoWidth && !state.busy && !document.hidden) {
      const { w, h } = cutout(proc, pctx, PREVIEW_MAX_W);
      composite(view, vctx, proc, w, h, false);
    }
    requestAnimationFrame(loop);
  }

  /* ---------- fondos ---------- */
  function renderBgList() {
    const list = $('bgList');
    list.textContent = '';
    state.bgs.forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'bg-item' + (b.id === 'none' ? ' none' : '');
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(b.id === state.bgId));
      el.title = b.name;
      if (b.id === 'none') el.textContent = 'Sin fondo';
      else el.style.backgroundImage = 'url("' + b.src + '")';
      el.addEventListener('click', () => { state.bgId = b.id; renderBgList(); });
      list.appendChild(el);
    });
  }

  async function addBackground(id, name, src) {
    try {
      const img = await loadImage(src);
      state.bgs.push({ id, name, src, img });
    } catch (e) { /* imagen inexistente: se omite */ }
  }

  async function loadBackgrounds() {
    state.bgs = [{ id: 'none', name: 'Sin fondo (transparente)', src: '', img: null }];
    try {
      const res = await fetch('fondos/fondos.json', { cache: 'no-cache' });
      if (res.ok) {
        const items = await res.json();
        for (const it of items) await addBackground('f:' + it.src, it.name || it.src, 'fondos/' + it.src);
      }
    } catch (e) { /* sin lista: solo se podrán subir fondos manualmente */ }
    if (state.bgs.length > 1) state.bgId = state.bgs[1].id;
    renderBgList();
  }

  /* ---------- captura ---------- */
  function countdown(n) {
    return new Promise((resolve) => {
      const el = $('countdown');
      el.hidden = false;
      let k = n;
      el.textContent = k;
      const t = setInterval(() => {
        k--;
        if (k <= 0) { clearInterval(t); el.hidden = true; resolve(); }
        else el.textContent = k;
      }, 1000);
    });
  }

  async function takePhoto() {
    if (!state.stream || !video.videoWidth || state.busy) return;
    $('btnShot').disabled = true;
    const secs = parseInt($('selTimer').value, 10) || 0;
    if (secs) await countdown(secs);

    state.busy = true;
    const f = $('flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');

    const cap = document.createElement('canvas');
    const cctx = cap.getContext('2d', { willReadFrequently: true });
    const { w, h } = cutout(cap, cctx, CAPTURE_MAX_W);

    const out = document.createElement('canvas');
    const octx = out.getContext('2d');
    composite(out, octx, cap, w, h, true);

    const hasBg = !!(currentBg() && currentBg().img);
    const blob = await new Promise((r) => out.toBlob(r, hasBg ? 'image/jpeg' : 'image/png', 0.93));
    state.lastBlob = { blob, ext: hasBg ? 'jpg' : 'png' };

    const url = URL.createObjectURL(blob);
    const img = $('imgResult');
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.dataset.url = url; img.src = url;
    $('dlgResult').showModal();
    $('btnShot').disabled = false;
  }

  function fileName() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return 'cabina-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.' + state.lastBlob.ext;
  }

  function download() {
    if (!state.lastBlob) return;
    const a = document.createElement('a');
    a.href = $('imgResult').dataset.url;
    a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function share() {
    if (!state.lastBlob) return;
    const file = new File([state.lastBlob.blob], fileName(), { type: state.lastBlob.blob.type });
    try { await navigator.share({ files: [file], title: 'Mi foto' }); } catch (e) {}
  }

  /* ---------- eventos ---------- */
  function bind() {
    $('btnShot').addEventListener('click', takePhoto);
    $('btnFlip').addEventListener('click', async () => {
      const before = state.facing;
      state.deviceId = null;
      state.facing = before === 'user' ? 'environment' : 'user';
      await startCamera();
      // Si el teléfono entregó la misma cámara, probamos la siguiente de la lista.
      if (state.facing === before) {
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        if (cams.length > 1) {
          const i = cams.findIndex((c) => c.deviceId === state.deviceId);
          state.deviceId = cams[(i + 1) % cams.length].deviceId;
          await startCamera();
        }
      }
    });
    $('btnSettings').addEventListener('click', () => {
      const p = $('panelSettings'); p.hidden = !p.hidden;
    });
    // Borra la copia guardada en el dispositivo y recarga con la versión más reciente.
    $('btnUpdate').addEventListener('click', async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {}
      location.reload();
    });

    const link = (id, key, parse) => $(id).addEventListener('input', (e) => {
      state.s[key] = parse(e.target); saveSettings();
    });
    link('rngSim', 'similarity', (t) => parseFloat(t.value));
    link('rngSmooth', 'smoothness', (t) => parseFloat(t.value));
    link('rngSpill', 'spill', (t) => parseFloat(t.value));
    link('clrKey', 'key', (t) => t.value);
    link('chkMirror', 'mirror', (t) => t.checked);

    $('btnSample').addEventListener('click', () => {
      state.sampling = true;
      showMsg('Toca en la imagen sobre una zona del fondo verde.', 6000);
    });
    view.addEventListener('pointerdown', (e) => {
      if (!state.sampling || !video.videoWidth) return;
      state.sampling = false;
      // Para muestrear necesitamos el frame SIN procesar, tomado de nuevo del video.
      const r = view.getBoundingClientRect();
      const scale = Math.min(r.width / view.width, r.height / view.height);
      const dw = view.width * scale, dh = view.height * scale;
      const x = (e.clientX - r.left - (r.width - dw) / 2) / scale;
      const y = (e.clientY - r.top - (r.height - dh) / 2) / scale;
      const raw = document.createElement('canvas');
      raw.width = view.width; raw.height = view.height;
      const rctx = raw.getContext('2d', { willReadFrequently: true });
      rctx.save();
      if (state.s.mirror && state.facing === 'user') { rctx.translate(raw.width, 0); rctx.scale(-1, 1); }
      rctx.drawImage(video, 0, 0, raw.width, raw.height);
      rctx.restore();
      const key = Chroma.sampleKey(rctx.getImageData(0, 0, raw.width, raw.height), x, y, 6);
      const hex = '#' + key.map((v) => v.toString(16).padStart(2, '0')).join('');
      state.s.key = hex; $('clrKey').value = hex; saveSettings();
      showMsg('Color de fondo calibrado: ' + hex, 2500);
    });

    $('fileBg').addEventListener('change', async (e) => {
      for (const f of e.target.files) {
        const url = URL.createObjectURL(f);
        const id = 'u:' + f.name + ':' + f.size;
        await addBackground(id, f.name, url);
        state.bgId = id;
      }
      e.target.value = '';
      renderBgList();
    });

    $('btnSave').addEventListener('click', download);
    $('btnRetake').addEventListener('click', () => { $('dlgResult').close(); state.busy = false; });
    $('dlgResult').addEventListener('close', () => { state.busy = false; });
    if (navigator.canShare) $('btnShare').hidden = false;
    $('btnShare').addEventListener('click', share);

    // instalación
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferred = e; $('btnInstall').hidden = false;
    });
    $('btnInstall').addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt(); await deferred.userChoice;
      deferred = null; $('btnInstall').hidden = true;
    });
    window.addEventListener('appinstalled', () => { $('btnInstall').hidden = true; });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopCamera(); else startCamera();
    });
  }

  /* ---------- arranque ---------- */
  async function init() {
    loadSettings();
    bind();
    await loadBackgrounds();
    await startCamera();
    requestAnimationFrame(loop);
    if ('serviceWorker' in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      // Si se instala una versión nueva de la app, recarga sola (salvo que estés tomando una foto).
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && !reloaded && !state.busy) { reloaded = true; location.reload(); }
      });
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  init();
})();
