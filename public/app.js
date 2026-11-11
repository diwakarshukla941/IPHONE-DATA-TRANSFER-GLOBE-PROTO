const $ = (selector) => document.querySelector(selector);
const screens = ['start', 'host', 'scan', 'paired'];
let sessionId = null;
let role = null;
let polling = null;
let stream = null;
let detector = null;
let scanLocked = false;

function show(name) { screens.forEach((id) => $(`#${id}`).classList.toggle('hidden', id !== name)); }
function api(path, options) { return fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options }).then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; }); }
function stopCamera() { if (stream) stream.getTracks().forEach((track) => track.stop()); stream = null; }
function reset() { stopCamera(); clearInterval(polling); sessionId = null; role = null; show('start'); }

$('#create').onclick = async () => {
  const button = $('#create');
  button.disabled = true;
  button.textContent = 'Creating your pulse…';
  try {
    const session = await api('/api/sessions', { method: 'POST' });
    sessionId = session.id; role = 'owner';
    $('#hostCode').textContent = session.id;
    $('#hostStatus').textContent = 'Waiting for a nearby phone…';
    show('host');
    renderPulseGlobe(session.id);
    watch();
  } catch (error) {
    button.textContent = error.message || 'Could not create a pulse. Try again.';
    button.classList.add('error');
  } finally {
    button.disabled = false;
    if (!sessionId) button.textContent = 'Create a pairing pulse →';
  }
};

function drawCodeFallback(id) {
  const canvas = $('#qrcode');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.height = 220;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 220, 220);
  ctx.fillStyle = '#082333'; ctx.font = 'bold 17px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('PAIR CODE', 110, 86); ctx.font = 'bold 22px monospace'; ctx.fillText(id, 110, 125);
}

function renderPulseGlobe(id) {
  const canvas = $('#qrcode');
  const ctx = canvas.getContext('2d');
  const size = 520;
  canvas.width = canvas.height = size;
  const seed = [...id].reduce((value, char) => ((value * 33) ^ char.charCodeAt(0)) >>> 0, 2166136261);
  const random = (index) => {
    let value = (seed + index * 747796405) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 2246822507) >>> 0;
    return ((value ^ (value >>> 13)) >>> 0) / 4294967296;
  };
  const bits = id.split('').flatMap((char) => char.charCodeAt(0).toString(2).padStart(8, '0')).map(Number);
  const dots = Array.from({ length: 1000 }, (_, index) => {
    const angle = random(index * 4) * Math.PI * 2;
    const radius = Math.pow(random(index * 4 + 1), .57) * .93;
    const bit = bits[index % bits.length];
    return { angle, radius, bit, size: 1 + random(index * 4 + 2) * 3.1, phase: random(index * 4 + 3) * Math.PI * 2 };
  });
  const paint = (time) => {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#f6fafb'; ctx.fillRect(0, 0, size, size);
    const center = size / 2;
    const glow = ctx.createRadialGradient(center, center, 20, center, center, 230);
    glow.addColorStop(0, '#caedf7'); glow.addColorStop(.58, '#e4f7fb'); glow.addColorStop(1, '#f6fafb');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(center, center, 230, 0, Math.PI * 2); ctx.fill();
    dots.forEach((dot, index) => {
      const wave = Math.sin(time / 950 + dot.phase + dot.radius * 8) * 3.5;
      const orbit = dot.angle + time / 3600;
      const latitude = Math.sin(orbit * 2.7 + time / 2800) * (1 - dot.radius) * 16;
      const x = center + Math.cos(orbit) * (dot.radius * 214 + wave);
      const y = center + Math.sin(orbit) * (dot.radius * 196 + wave) + latitude;
      const alpha = .3 + (1 - dot.radius) * .44 + dot.bit * .18;
      ctx.fillStyle = `rgba(${dot.bit ? '0,126,218' : '35,158,215'}, ${alpha})`;
      ctx.beginPath(); ctx.arc(x, y, dot.size + Math.sin(time / 620 + index) * .34, 0, Math.PI * 2); ctx.fill();
    });
    requestAnimationFrame(paint);
  };
  requestAnimationFrame(paint);
}

$('#openScanner').onclick = () => { show('scan'); };
$('.back').onclick = reset;
document.querySelectorAll('.reset').forEach((button) => button.onclick = reset);

async function join(id) {
  id = id.trim().toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(id)) throw new Error('Enter a valid 10-character code.');
  await api(`/api/sessions/${id}/join`, { method: 'POST' });
  stopCamera(); sessionId = id; role = 'guest'; show('paired'); watch();
}

$('#manualJoin').onclick = async () => { try { await join($('#manualCode').value); } catch (error) { $('#cameraMessage').textContent = error.message; $('#cameraMessage').classList.add('error'); } };
$('#startCamera').onclick = async () => {
  if (!window.isSecureContext) {
    $('#cameraMessage').textContent = 'Camera access requires HTTPS on a phone. This local http address is blocked by the browser.';
    $('#cameraMessage').classList.add('error');
    return;
  }
  try {
    scanLocked = false;
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const video = $('#video'); video.srcObject = stream; await video.play(); $('#cameraMessage').textContent = 'Looking for a pairing pulse…'; scanFrame();
  } catch (error) { $('#cameraMessage').textContent = error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in your browser settings and try again.' : 'Camera could not be opened. Use the backup code below.'; $('#cameraMessage').classList.add('error'); }
};

function scanFrame() {
  if (!stream || $('#scan').classList.contains('hidden')) return;
  const video = $('#video'), canvas = $('#scanCanvas');
  if (video.readyState >= 2 && !scanLocked) {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0);
    const id = decodeParticleDisc(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (id) { scanLocked = true; $('#cameraMessage').textContent = 'Particle signature found — pairing…'; join(id).catch((error) => { scanLocked = false; $('#cameraMessage').textContent = error.message; }); }
  }
  requestAnimationFrame(scanFrame);
}

// The sender encodes each session-id bit as high (five dots) or low (one dot)
// particle density in a 16×16 field. Keep the globe inside the on-screen camera guide.
function decodeParticleDisc(image) {
  const grid = 16, source = Math.min(image.width, image.height) * .72;
  const left = (image.width - source) / 2, top = (image.height - source) / 2;
  const bits = new Uint8Array(80);
  for (let row = 0; row < grid; row += 1) for (let column = 0; column < grid; column += 1) {
    const x0 = Math.floor(left + column * source / grid), x1 = Math.floor(left + (column + 1) * source / grid);
    const y0 = Math.floor(top + row * source / grid), y1 = Math.floor(top + (row + 1) * source / grid);
    let bluePixels = 0, total = 0;
    for (let y = y0 + 2; y < y1 - 2; y += 1) for (let x = x0 + 2; x < x1 - 2; x += 1) {
      const pixel = (y * image.width + x) * 4;
      if (image.data[pixel + 2] - image.data[pixel] > 48 && image.data[pixel + 1] - image.data[pixel] > 30) bluePixels += 1;
      total += 1;
    }
    const bitIndex = row * grid + column;
    if (bitIndex < bits.length) bits[bitIndex] = bluePixels / Math.max(total, 1) > .032 ? 1 : 0;
  }
  let id = '';
  for (let character = 0; character < 10; character += 1) {
    let value = 0; for (let bit = 0; bit < 8; bit += 1) value = (value << 1) | bits[character * 8 + bit];
    id += String.fromCharCode(value);
  }
  return /^[A-F0-9]{10}$/.test(id) ? id : null;
}

function watch() { clearInterval(polling); const refresh = async () => { try { const session = await api(`/api/sessions/${sessionId}`); if (role === 'owner' && session.paired) { show('paired'); } if (session.paired) renderMessages(session.messages); const remaining = Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000)); if (role === 'owner' && !session.paired) $('#hostStatus').textContent = `Waiting for a nearby phone… ${remaining}s`; } catch (error) { reset(); } }; refresh(); polling = setInterval(refresh, 1200); }
function renderMessages(messages) { $('#messages').innerHTML = messages.map((message) => `<div class="message ${message.from}"><small>${message.from === role ? 'You' : 'Paired phone'}</small>${escapeHtml(message.text)}</div>`).join(''); $('#messages').scrollTop = $('#messages').scrollHeight; }
function escapeHtml(value) { const node = document.createElement('div'); node.textContent = value; return node.innerHTML; }
$('#messageForm').onsubmit = async (event) => { event.preventDefault(); const input = $('#messageText'); const text = input.value.trim(); if (!text || !sessionId) return; await api(`/api/sessions/${sessionId}/messages`, { method: 'POST', body: JSON.stringify({ text, from: role }) }); input.value = ''; };
