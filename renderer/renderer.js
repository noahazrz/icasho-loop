'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    player: $('player'), notice: $('notice'), noticeText: $('noticeText'), noticeBtn: $('noticeBtn'),
    panel: $('panel'), user: $('user'), scan: $('scan'), scanCancel: $('scanCancel'),
    scanStatus: $('scanStatus'), manual: $('manual'), addManual: $('addManual'),
    opacity: $('opacity'), envInfo: $('envInfo'), counter: $('counter'),
    pin: $('pin'), cfg: $('cfg'), min: $('min'), close: $('close'),
    prev: $('prev'), next: $('next'), mute: $('mute'),
  };

  const MAX_FAILS = 4;
  const LOAD_TIMEOUT_MS = 12000;

  let S = { user: 'icasho', ids: [], muted: false };
  let queue = [];
  let history = [];
  let pos = -1;
  let token = 0;
  let loadTimer = null;
  let fails = 0;
  let playing = false;
  let advancedFor = -1;
  let failedFor = -1;
  let lastId = null;
  let soundFor = -1;
  let unmuteTries = 0;

  // ----------------------------- orden aleatorio ---------------------------
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function refill() {
    queue = shuffle(S.ids.slice());
    // El siguiente en salir es queue[queue.length - 1]: que no repita el ultimo visto.
    if (queue.length > 1 && queue[queue.length - 1] === lastId) {
      [queue[0], queue[queue.length - 1]] = [queue[queue.length - 1], queue[0]];
    }
  }

  function drawFromQueue() {
    if (!S.ids.length) return null;
    if (!queue.length) refill();
    return queue.pop();
  }

  function syncQueueWithIds(prevIds) {
    const before = new Set(prevIds);
    const current = new Set(S.ids);
    queue = queue.filter((id) => current.has(id));
    const added = S.ids.filter((id) => !before.has(id));
    queue.push(...added);
    shuffle(queue);
  }

  // ------------------------------- reproductor -----------------------------
  function playerUrl(id) {
    const p = new URLSearchParams({
      autoplay: '1', loop: '0', controls: '0', music_info: '0', description: '0',
      rel: '0', progress_bar: '0', play_button: '0', volume_control: '0',
      fullscreen_button: '0', timestamp: '0', native_context_menu: '0', closed_caption: '0',
    });
    return `https://www.tiktok.com/player/v1/${id}?${p}`;
  }

  function post(type, value) {
    try {
      el.player.contentWindow.postMessage({ 'x-tiktok-player': true, type, value }, '*');
    } catch (_) { /* iframe aun sin cargar */ }
  }

  function applyMute() {
    post(S.muted ? 'mute' : 'unMute');
  }

  // Cada video es un reproductor nuevo y puede arrancar silenciado: se pide el
  // sonido varias veces, a medida que el reproductor se va poniendo en marcha.
  function ensureSound() {
    applyMute();
    const mine = token;
    [250, 800, 2000].forEach((ms) => {
      setTimeout(() => { if (mine === token) applyMute(); }, ms);
    });
  }

  function showNotice(text, buttonLabel, onClick) {
    el.noticeText.textContent = text;
    el.noticeBtn.textContent = buttonLabel;
    el.noticeBtn.onclick = onClick;
    el.notice.hidden = false;
  }

  function hideNotice() { el.notice.hidden = true; }

  function showEmpty() {
    clearTimeout(loadTimer);
    el.player.removeAttribute('src');
    showNotice('Todavía no hay videos. Escanea el perfil desde Ajustes.', 'Abrir ajustes', () => {
      el.panel.hidden = false;
    });
  }

  function play(id) {
    token++;
    playing = false;
    unmuteTries = 0;
    lastId = id;
    clearTimeout(loadTimer);
    hideNotice();
    el.player.src = playerUrl(id);
    const mine = token;
    loadTimer = setTimeout(() => { if (mine === token && !playing) fail(); }, LOAD_TIMEOUT_MS);
    updateCounter();
  }

  function next() {
    if (!S.ids.length) { showEmpty(); return; }
    if (pos < history.length - 1) {
      pos++;
    } else {
      const id = drawFromQueue();
      if (!id) { showEmpty(); return; }
      history.push(id);
      if (history.length > 200) { history.shift(); }
      pos = history.length - 1;
    }
    play(history[pos]);
  }

  function prev() {
    if (pos > 0) { pos--; play(history[pos]); }
  }

  function ended() {
    if (advancedFor === token) return;
    advancedFor = token;
    next();
  }

  function fail() {
    if (failedFor === token) return;
    failedFor = token;
    fails++;
    if (fails >= MAX_FAILS) {
      clearTimeout(loadTimer);
      showNotice(
        'TikTok no está cargando el reproductor. Revisa tu conexión o inténtalo más tarde.',
        'Reintentar',
        () => { fails = 0; next(); }
      );
      return;
    }
    next();
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== el.player.contentWindow) return;
    let host = '';
    try { host = new URL(ev.origin).hostname; } catch (_) { return; }
    if (!/(^|\.)tiktok\.com$/.test(host)) return;
    const d = ev.data;
    if (!d || d['x-tiktok-player'] !== true) return;

    switch (d.type) {
      case 'onPlayerReady':
        ensureSound();
        post('play');
        break;
      case 'onMute':
        // Si el reproductor se silencia solo y no lo pediste, se reactiva (con tope).
        if (!S.muted && d.value && unmuteTries < 5) {
          unmuteTries++;
          post('unMute');
        }
        break;
      case 'onStateChange':
        if (d.value === 1) {
          playing = true;
          fails = 0;
          clearTimeout(loadTimer);
          if (soundFor !== token) { soundFor = token; ensureSound(); }
        } else if (d.value === 0) {
          ended();
        }
        break;
      case 'onCurrentTime':
        if (d.value && d.value.duration > 0 && d.value.currentTime >= d.value.duration - 0.25) ended();
        break;
      case 'onError':
      case 'onPlayerError':
        fail();
        break;
      default:
    }
  });

  // ------------------------------ interfaz ---------------------------------
  function updateCounter() {
    el.counter.textContent = S.ids.length ? `${S.ids.length} videos` : '';
  }

  function renderMute() {
    el.mute.textContent = S.muted ? 'Silenciado' : 'Sonido';
    el.mute.classList.toggle('off', S.muted);
    el.mute.classList.toggle('on', !S.muted);
  }

  function renderPin(on) {
    el.pin.textContent = on ? 'Fijado' : 'Suelto';
    el.pin.classList.toggle('on', on);
    el.pin.classList.toggle('off', !on);
    el.pin.title = on ? 'Está encima de todas las apps. Pulsa para soltar.' : 'Pulsa para ponerlo encima de todas las apps.';
  }

  function parseIds(text) {
    const out = new Set();
    for (const line of text.split(/\s+/)) {
      const m = /\/video\/(\d{8,25})/.exec(line) || /^(\d{15,25})$/.exec(line);
      if (m) out.add(m[1]);
    }
    return [...out];
  }

  async function saveIds(newIds) {
    const prevIds = S.ids.slice();
    S.ids = [...new Set(newIds)];
    await window.api.setState({ ids: S.ids });
    syncQueueWithIds(prevIds);
    updateCounter();
  }

  el.pin.onclick = async () => renderPin(await window.api.setAlwaysOnTop(!el.pin.classList.contains('on')));
  el.cfg.onclick = () => { el.panel.hidden = !el.panel.hidden; };
  el.min.onclick = () => window.api.minimize();
  el.close.onclick = () => window.api.close();
  el.next.onclick = () => next();
  el.prev.onclick = () => prev();

  el.mute.onclick = async () => {
    S.muted = !S.muted;
    renderMute();
    applyMute();
    await window.api.setState({ muted: S.muted });
  };

  el.opacity.oninput = () => window.api.setOpacity(Number(el.opacity.value) / 100);

  el.user.onchange = async () => {
    await window.api.setState({ user: el.user.value });
    el.scanStatus.textContent = 'Usuario guardado. Pulsa Escanear para cargar sus videos.';
  };

  el.addManual.onclick = async () => {
    const found = parseIds(el.manual.value);
    if (!found.length) {
      el.scanStatus.textContent = 'No encontré enlaces de video en el texto.';
      return;
    }
    const wasEmpty = !S.ids.length;
    await saveIds(S.ids.concat(found));
    el.manual.value = '';
    el.scanStatus.textContent = `Añadidos ${found.length}. Total: ${S.ids.length}.`;
    if (wasEmpty) next();
  };

  el.scan.onclick = async () => {
    const wanted = el.user.value.trim().replace(/^@/, '');
    el.scan.disabled = true;
    el.scanCancel.hidden = false;
    el.scanStatus.textContent = 'Escaneando…';
    const off = window.api.onScanProgress(({ count, needsHuman }) => {
      el.scanStatus.textContent = needsHuman
        ? `Se abrió una ventana de TikTok: resuelve el captcha o inicia sesión. Encontrados: ${count}.`
        : `Escaneando… encontrados: ${count}.`;
    });

    const res = await window.api.scan(wanted);
    off();
    el.scan.disabled = false;
    el.scanCancel.hidden = true;

    if (!res.ok) {
      el.scanStatus.textContent = res.error;
      return;
    }
    const wasEmpty = !S.ids.length;
    const userChanged = res.user !== S.user;
    S.user = res.user;
    el.user.value = res.user;
    if (userChanged) { queue = []; history = []; pos = -1; }
    const prevIds = userChanged ? [] : S.ids.slice();
    S.ids = res.ids;
    syncQueueWithIds(prevIds);
    updateCounter();
    el.scanStatus.textContent = res.found
      ? `Listo: ${res.found} videos encontrados, ${S.ids.length} en la lista.`
      : 'No se encontró ningún video. Revisa el usuario o inténtalo otra vez.';
    if ((wasEmpty || userChanged) && S.ids.length) { el.panel.hidden = true; next(); }
  };

  el.scanCancel.onclick = () => window.api.cancelScan();

  document.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key.toLowerCase() === 'm') el.mute.click();
  });

  // -------------------------------- arranque -------------------------------
  (async () => {
    const st = await window.api.getState();
    S = { user: st.user, ids: st.ids || [], muted: !!st.muted };
    el.user.value = S.user;
    el.opacity.value = Math.round((st.opacity || 1) * 100);
    renderMute();
    renderPin(st.alwaysOnTop !== false);
    updateCounter();

    if (st.platform === 'linux') {
      el.envInfo.textContent = 'Linux: la app corre por XWayland para poder quedarse encima de las demás ventanas.';
    }

    if (S.ids.length) next();
    else { showEmpty(); el.panel.hidden = false; }
  })();
})();
