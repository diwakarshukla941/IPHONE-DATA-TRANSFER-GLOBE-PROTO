/* ══════════════════════════════════════════════════════════════
   Pulse Pair — iPhone Data Transfer Globe Replica
   
   Encoding: session ID (10 hex chars = 80 bits) is embedded as
   particle-density in a polar grid (10 rings × 8 sectors).
   bit=1 cells → many bright particles, bit=0 → few dim ones.
   
   Decoding: camera samples the same polar grid, thresholds
   blue-channel prominence, recovers the 80 bits.
   ══════════════════════════════════════════════════════════════ */

const $ = (sel) => document.querySelector(sel);
const screens = ['start', 'host', 'scan', 'paired'];
let sessionId = null;
let role = null;
let polling = null;
let stream = null;
let scanLocked = false;
let globeAnim = null;

/* ── Shared encoding geometry (encoder & decoder must agree) ── */
const RINGS = 10;
const SECTORS = 8;
const R_INNER = 0.22;   // data starts at 22% of disc radius
const R_OUTER = 0.84;   // data ends at 84% of disc radius

/* ── Helpers ─────────────────────────────────────────────────── */
function show(name) {
  screens.forEach((id) => $(`#${id}`).classList.toggle('hidden', id !== name));
}

function api(path, options) {
  return fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options })
    .then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      return data;
    });
}

function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

function reset() {
  stopCamera();
  clearInterval(polling);
  if (globeAnim) cancelAnimationFrame(globeAnim);
  globeAnim = null;
  sessionId = null;
  role = null;
  show('start');
}

/* ── 10-char hex ID → 80-bit Uint8Array ────────────────────── */
function idToBits(id) {
  const bits = new Uint8Array(RINGS * SECTORS);
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i);
    for (let b = 0; b < 8; b++) bits[i * 8 + b] = (code >> (7 - b)) & 1;
  }
  return bits;
}

/* ── Seeded PRNG (deterministic visuals per session) ───────── */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507) >>> 0;
    s = Math.imul(s ^ (s >>> 13), 3266489917) >>> 0;
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  };
}

/* ══════════════════════════════════════════════════════════════
   iPhone-Style 3D Particle Globe  (with embedded data)
   ══════════════════════════════════════════════════════════════ */
function renderPulseGlobe(id) {
  const el = $('#qrcode');
  const ctx = el.getContext('2d');
  const S = 520;
  el.width = el.height = S;
  const C = S / 2;
  const DISC = 226;

  const bits = idToBits(id);
  const rand = makeRng(
    [...id].reduce((v, c) => ((v * 33) ^ c.charCodeAt(0)) >>> 0, 5381)
  );

  /* ── Data particles (anchored in polar grid cells) ── */
  const particles = [];

  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < SECTORS; s++) {
      const bit = bits[r * SECTORS + s];
      const count = bit ? 18 : 2;

      const r0 = R_INNER + (R_OUTER - R_INNER) * (r / RINGS);
      const r1 = R_INNER + (R_OUTER - R_INNER) * ((r + 1) / RINGS);
      const a0 = (s / SECTORS) * Math.PI * 2;
      const a1 = ((s + 1) / SECTORS) * Math.PI * 2;

      for (let i = 0; i < count; i++) {
        particles.push({
          kind: 'data',
          bit,
          radius: r0 + (r1 - r0) * (0.08 + rand() * 0.84),
          angle: a0 + (a1 - a0) * (0.08 + rand() * 0.84),
          sz: 0.9 + rand() * 2.8,
          ph: rand() * Math.PI * 2,
          ph2: rand() * Math.PI * 2,
          sp: 0.35 + rand() * 0.8,
          hue: 192 + rand() * 18,
        });
      }
    }
  }

  /* ── Decorative particles (core glow + outer halo + scattered) ── */
  for (let i = 0; i < 500; i++) {
    const zone = rand();
    let radius;
    if (zone < 0.3) radius = rand() * R_INNER * 0.88;
    else if (zone < 0.65) radius = R_OUTER + rand() * (1.0 - R_OUTER);
    else radius = R_INNER + rand() * (R_OUTER - R_INNER);

    particles.push({
      kind: 'deco',
      radius,
      angle: rand() * Math.PI * 2,
      sz: 0.4 + rand() * 2.2,
      ph: rand() * Math.PI * 2,
      ph2: rand() * Math.PI * 2,
      sp: 0.2 + rand() * 2.0,
      alpha: 0.02 + rand() * 0.09,
      hue: 188 + rand() * 28,
    });
  }

  /* ── Render loop ── */
  function paint(t) {
    ctx.clearRect(0, 0, S, S);

    /* Background (matches page) */
    ctx.fillStyle = '#081b2a';
    ctx.fillRect(0, 0, S, S);

    /* Layered sphere glow */
    const g1 = ctx.createRadialGradient(C, C, 0, C, C, DISC * 0.5);
    g1.addColorStop(0, 'rgba(100, 225, 255, 0.10)');
    g1.addColorStop(1, 'rgba(100, 225, 255, 0)');
    ctx.fillStyle = g1;
    ctx.beginPath();
    ctx.arc(C, C, DISC * 0.5, 0, Math.PI * 2);
    ctx.fill();

    const g2 = ctx.createRadialGradient(C, C, DISC * 0.35, C, C, DISC * 1.1);
    g2.addColorStop(0, 'rgba(20, 90, 150, 0)');
    g2.addColorStop(0.55, 'rgba(25, 110, 180, 0.032)');
    g2.addColorStop(1, 'rgba(8, 27, 42, 0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(C, C, DISC * 1.1, 0, Math.PI * 2);
    ctx.fill();

    /* Gentle breathing */
    const breath = 1 + Math.sin(t * 0.0005) * 0.015;

    /* Draw particles */
    for (const p of particles) {
      const wobble = Math.sin(t * 0.001 * p.sp + p.ph) * 2.6;
      const angDrift = Math.cos(t * 0.0006 * p.sp + p.ph2) * 0.005;
      const pr = p.radius * DISC * breath + wobble;
      const pa = p.angle + angDrift;
      const x = C + Math.cos(pa) * pr;
      const y = C + Math.sin(pa) * pr;

      /* Depth illusion: edge particles are dimmer/smaller */
      const depth = Math.max(0.25, 1 - p.radius * 0.55);
      const sz = p.sz + Math.sin(t * 0.0012 + p.ph) * 0.3;

      if (p.kind === 'data') {
        if (p.bit) {
          const a = (0.44 + Math.sin(t * 0.0008 + p.ph) * 0.11) * depth;
          /* Glow halo */
          ctx.fillStyle = `hsla(${p.hue}, 82%, 62%, ${a * 0.22})`;
          ctx.beginPath();
          ctx.arc(x, y, sz * 2.8, 0, Math.PI * 2);
          ctx.fill();
          /* Core dot */
          ctx.fillStyle = `hsla(${p.hue}, 88%, 68%, ${a})`;
          ctx.beginPath();
          ctx.arc(x, y, sz, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = `rgba(25, 60, 100, ${0.035 * depth})`;
          ctx.beginPath();
          ctx.arc(x, y, sz * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        /* Decorative */
        const a = (p.alpha + Math.sin(t * 0.001 + p.ph) * 0.02) * depth;
        ctx.fillStyle = `hsla(${p.hue}, 72%, 66%, ${a})`;
        ctx.beginPath();
        ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* Faint outer boundary ring (helps decoder find the disc) */
    ctx.strokeStyle = 'rgba(80, 200, 240, 0.08)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(C, C, DISC * R_OUTER, 0, Math.PI * 2);
    ctx.stroke();

    globeAnim = requestAnimationFrame(paint);
  }

  globeAnim = requestAnimationFrame(paint);
}

/* ══════════════════════════════════════════════════════════════
   Camera-Based Particle Disc Decoder
   
   Samples each polar-grid cell's blue-channel prominence from
   a camera frame, thresholds adaptively, reconstructs the ID.
   ══════════════════════════════════════════════════════════════ */
function decodeParticleDisc(image) {
  const w = image.width, h = image.height, d = image.data;
  const cx = w / 2, cy = h / 2;
  const discR = Math.min(w, h) * 0.35;

  const cellSignal = new Float64Array(RINGS * SECTORS);

  for (let ring = 0; ring < RINGS; ring++) {
    for (let sec = 0; sec < SECTORS; sec++) {
      const r0 = R_INNER + (R_OUTER - R_INNER) * (ring / RINGS);
      const r1 = R_INNER + (R_OUTER - R_INNER) * ((ring + 1) / RINGS);
      const a0 = (sec / SECTORS) * Math.PI * 2;
      const a1 = ((sec + 1) / SECTORS) * Math.PI * 2;

      let signal = 0, n = 0;
      const RS = 6, AS = 6;
      for (let ri = 0; ri < RS; ri++) {
        for (let ai = 0; ai < AS; ai++) {
          const r = (r0 + (r1 - r0) * (ri + 0.5) / RS) * discR;
          const a = a0 + (a1 - a0) * (ai + 0.5) / AS;
          const px = Math.round(cx + Math.cos(a) * r);
          const py = Math.round(cy + Math.sin(a) * r);
          if (px >= 0 && px < w && py >= 0 && py < h) {
            const idx = (py * w + px) * 4;
            signal += d[idx + 2] - d[idx]; // B − R
            n++;
          }
        }
      }
      cellSignal[ring * SECTORS + sec] = n > 0 ? signal / n : 0;
    }
  }

  /* Adaptive threshold: mid-point between 25th and 75th percentile */
  const sorted = Array.from(cellSignal).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.25)];
  const hi = sorted[Math.floor(sorted.length * 0.75)];
  const thresh = (lo + hi) / 2;

  let id = '';
  for (let ch = 0; ch < 10; ch++) {
    let v = 0;
    for (let b = 0; b < 8; b++) {
      v = (v << 1) | (cellSignal[ch * 8 + b] > thresh ? 1 : 0);
    }
    id += String.fromCharCode(v);
  }

  return /^[A-F0-9]{10}$/.test(id) ? id : null;
}

/* ══════════════════════════════════════════════════════════════
   UI Flow
   ══════════════════════════════════════════════════════════════ */

/* ── Create session ── */
$('#create').onclick = async () => {
  const btn = $('#create');
  btn.disabled = true;
  btn.textContent = 'Creating your pulse…';
  try {
    const session = await api('/api/sessions', { method: 'POST' });
    sessionId = session.id;
    role = 'owner';
    $('#hostCode').textContent = session.id;
    $('#hostStatus').textContent = 'Waiting for a nearby phone…';
    show('host');
    renderPulseGlobe(session.id);
    watch();
  } catch (err) {
    btn.textContent = err.message || 'Could not create. Try again.';
    btn.classList.add('error');
  } finally {
    btn.disabled = false;
    if (!sessionId) btn.textContent = 'Create a pairing pulse →';
  }
};

/* ── Navigation ── */
$('#openScanner').onclick = () => show('scan');
$('.back').onclick = reset;
document.querySelectorAll('.reset').forEach((b) => (b.onclick = reset));

/* ── Join session ── */
async function join(id) {
  id = id.trim().toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(id)) throw new Error('Enter a valid 10-character code.');
  await api(`/api/sessions/${id}/join`, { method: 'POST' });
  stopCamera();
  sessionId = id;
  role = 'guest';
  show('paired');
  watch();
}

$('#manualJoin').onclick = async () => {
  try {
    await join($('#manualCode').value);
  } catch (err) {
    $('#cameraMessage').textContent = err.message;
    $('#cameraMessage').classList.add('error');
  }
};

/* ── Camera scanner ── */
$('#startCamera').onclick = async () => {
  if (!window.isSecureContext) {
    $('#cameraMessage').textContent =
      'Camera requires HTTPS on mobile. Use the backup code below.';
    $('#cameraMessage').classList.add('error');
    return;
  }
  try {
    scanLocked = false;
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    const video = $('#video');
    video.srcObject = stream;
    await video.play();
    $('#cameraMessage').textContent = 'Point at the glowing globe…';
    scanFrame();
  } catch (err) {
    $('#cameraMessage').textContent =
      err.name === 'NotAllowedError'
        ? 'Camera permission denied. Allow it and try again.'
        : 'Camera could not be opened. Use the backup code below.';
    $('#cameraMessage').classList.add('error');
  }
};

function scanFrame() {
  if (!stream || $('#scan').classList.contains('hidden')) return;
  const video = $('#video');
  const canvas = $('#scanCanvas');
  if (video.readyState >= 2 && !scanLocked) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0);
    const id = decodeParticleDisc(
      ctx.getImageData(0, 0, canvas.width, canvas.height)
    );
    if (id) {
      scanLocked = true;
      $('#cameraMessage').textContent = 'Signal found — pairing…';
      join(id).catch((err) => {
        scanLocked = false;
        $('#cameraMessage').textContent = err.message;
      });
    }
  }
  requestAnimationFrame(scanFrame);
}

/* ── Polling & messages ── */
function watch() {
  clearInterval(polling);
  const refresh = async () => {
    try {
      const session = await api(`/api/sessions/${sessionId}`);
      if (role === 'owner' && session.paired) show('paired');
      if (session.paired) renderMessages(session.messages);
      const sec = Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000));
      if (role === 'owner' && !session.paired)
        $('#hostStatus').textContent = `Waiting for a nearby phone… ${sec}s`;
    } catch {
      reset();
    }
  };
  refresh();
  polling = setInterval(refresh, 1200);
}

function renderMessages(msgs) {
  $('#messages').innerHTML = msgs
    .map(
      (m) =>
        `<div class="message ${m.from}"><small>${
          m.from === role ? 'You' : 'Paired phone'
        }</small>${escapeHtml(m.text)}</div>`
    )
    .join('');
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

function escapeHtml(v) {
  const n = document.createElement('div');
  n.textContent = v;
  return n.innerHTML;
}

$('#messageForm').onsubmit = async (e) => {
  e.preventDefault();
  const input = $('#messageText');
  const text = input.value.trim();
  if (!text || !sessionId) return;
  await api(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text, from: role }),
  });
  input.value = '';
};
