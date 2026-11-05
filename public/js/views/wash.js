// SanoTaller — Autolavado: cola por placa (en cola → lavando → secado y aspirado → listo), tiempo de espera, aviso y cobro
import { store } from '../store.js';
import { esc, usd, emptyState, openModal, toast, setBusy, fmtTime, fmtAgo, parseNum, confirmDialog, normalize, num } from '../utils.js';
import { icon } from '../icons.js';
import { WASH_STATUS, WASH_FLOW, vehicleName, COLORS, BRANDS } from '../taller.js';
import { openWash, setWashStatus, closeWash, washEta } from '../ops.js';
import { vehAvatar, plateHTML, pickVehicle, openVehicle } from '../client.js';
import { waClient } from '../shared.js';

const nav = async (route, params = {}) => { const { navigate } = await import('../main.js'); navigate(route, { params, force: true }); };
const priceOf = (name) => Number(store.products.find((p) => p.trackStock === false && p.active !== false && normalize(p.name) === normalize(name))?.price
  ?? store.products.find((p) => p.trackStock === false && p.active !== false && normalize(p.name).includes(normalize(name)))?.price) || 0;

/** Entrada al autolavado: vehículo registrado o solo la placa (cliente de paso) */
export function washForm({ vehicle = null, appt = null } = {}) {
  return new Promise((resolve) => {
    let saved = null; let v = vehicle;
    const sel = new Set();
    const m = openModal({
      title: 'Entrada al autolavado', size: 'md',
      body: `<div class="stack"><div data-veh></div>
        <div class="field"><label>Servicios *</label><div class="chips chips-wrap" data-sv>${store.washTypes.map((w) => `<button type="button" class="chip" data-v="${esc(w.name)}">${esc(w.name)}${priceOf(w.name) ? ` · ${usd(priceOf(w.name))}` : ''}</button>`).join('')}</div></div>
        <div class="form-grid">
          <div class="field"><label>Lavador(a)</label><select class="select" data-st><option value="">Cualquiera</option>${store.washers.map((s) => `<option value="${s.id}" ${appt?.staffId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Precio</label><input class="input" data-p inputmode="decimal" placeholder="0,00"></div>
        </div>
        <div class="field"><label>Nota</label><input class="input" data-n placeholder="Ej.: cuidado con la antena, tiene pintura nueva"></div>
        <div class="error-msg" data-err></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('spray')} Poner en cola</button>`,
      onClose: () => resolve(saved)
    });
    const q = (s) => m.el.querySelector(s);
    const drawVeh = () => {
      q('[data-veh]').innerHTML = v ? `<div class="list-item box">${vehAvatar(v)}<div class="grow" style="min-width:0"><div class="row" style="gap:6px">${plateHTML(v.plate, 'plate-sm')}<b class="ellipsis">${esc(vehicleName(v))}</b></div><div class="t-sub">${esc(v.color || '')} · ${esc(v.ownerName || '')}</div></div><button type="button" class="btn btn-ghost btn-sm" data-chg>${icon('refresh')}</button></div>`
        : `<div class="form-grid"><div class="field"><label>Placa *</label><input class="input mono plate-input" data-pl placeholder="AB123CD" autocapitalize="characters" autofocus></div><div class="field"><label>Vehículo</label><input class="input" data-ds placeholder="Ej.: Aveo gris"></div>
           <div class="field"><label>Cliente</label><input class="input" data-on></div><div class="field"><label>Teléfono (para avisar)</label><input class="input" data-op inputmode="tel"></div></div>
           <button type="button" class="btn btn-ghost btn-sm" data-chg>${icon('search')} Elegir un vehículo registrado</button>`;
      q('[data-chg]').onclick = async () => { const p = await pickVehicle({ title: 'Vehículo para lavar' }); if (p) { v = p; drawVeh(); } };
      const pl = q('[data-pl]');
      if (pl) pl.oninput = () => { pl.value = pl.value.toUpperCase(); const f = store.byPlate(pl.value); if (f) { v = f; drawVeh(); toast(`${f.plate} ya está registrado: ${f.ownerName}`); } };
    };
    drawVeh();
    m.el.querySelectorAll('[data-sv] [data-v]').forEach((b) => b.onclick = () => {
      const x = b.dataset.v; sel.has(x) ? sel.delete(x) : sel.add(x); b.classList.toggle('on', sel.has(x));
      const tot = [...sel].reduce((a, s) => a + priceOf(s), 0);
      q('[data-p]').value = tot ? String(tot).replace('.', ',') : '';
    });
    q('[data-ok]').onclick = async (e) => {
      const err = q('[data-err]'); err.textContent = '';
      const plate = v?.plate || q('[data-pl]')?.value || '';
      if (!plate.trim()) { err.textContent = 'Escribe la placa o elige el vehículo.'; return; }
      if (!sel.size) { err.textContent = 'Marca al menos un servicio.'; return; }
      setBusy(e.currentTarget, true);
      try {
        saved = await openWash({ vehicleId: v?.id || null, plate, desc: q('[data-ds]')?.value || '', ownerName: q('[data-on]')?.value || '', phone: q('[data-op]')?.value || '', types: [...sel], price: parseNum(q('[data-p]').value), staffId: q('[data-st]').value || null, note: q('[data-n]').value, apptId: appt?.id || null });
        m.close();
        const eta = washEta(saved);
        toast(`${saved.plate} en cola${eta ? ` · espera aprox. ${eta} min` : ''}`);
      } catch (ex) { err.textContent = ex.message; setBusy(e.currentTarget, false); }
    };
  });
}

function charge(w) { nav('vender', { clientId: w.ownerId, vehicleId: w.vehicleId, washId: w.id, washPlate: w.plate }); }
async function deliver(w) {
  if (!(await confirmDialog({ title: `Entregar ${esc(w.plate)}`, message: `¿El cliente ya retiró el vehículo?${!w.charged && w.price ? `<br><b>Aún no se ha cobrado (${usd(w.price)}).</b>` : ''}`, confirmText: 'Entregado' }))) return;
  await closeWash(w);
  toast('Entregado');
  if (!w.charged && w.price && await confirmDialog({ title: 'Cobrar ahora', message: `Falta cobrar ${usd(w.price)}.`, confirmText: 'Ir a cobrar', cancelText: 'Después' })) charge(w);
}

export function mount(el) {
  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Autolavado</h1><p class="view-sub" id="w-sub"></p></div>
    <div class="view-actions"><button class="btn btn-primary" id="w-new" data-tour="wash-new">${icon('plus')} Entrada</button></div></div>
    <div id="w-body"></div>`;
  const $ = (s) => el.querySelector(s);
  function draw() {
    const cols = WASH_FLOW.filter((k) => k !== 'entregado');
    const q = store.washQueue;
    const waitMin = q.filter((w) => w.status === 'espera').length ? Math.max(...q.filter((w) => w.status === 'espera').map(washEta)) : 0;
    $('#w-sub').textContent = `${q.length} vehículo(s) · ${q.filter((w) => w.status === 'espera').length} en cola${waitMin ? ` · espera aprox. ${waitMin} min` : ''} · ${Math.max(1, Number(store.settings.washBays) || 1)} bahía(s)`;
    $('#w-body').innerHTML = `<div class="kanban" data-tour="wash">${cols.map((k) => { const list = q.filter((w) => w.status === k); return `<div class="kcol"><div class="kcol-head"><span class="badge badge-${WASH_STATUS[k].tone}">${icon(WASH_STATUS[k].icon)} ${WASH_STATUS[k].label}</span><span class="count">${list.length}</span></div>${list.map((w) => { const v = w.vehicleId ? store.vehicle(w.vehicleId) : null; const i = WASH_FLOW.indexOf(w.status); const nx = WASH_FLOW[i + 1]; const eta = washEta(w); return `<div class="kcard"><button class="kcard-main" data-d="${w.id}">${v ? vehAvatar(v) : `<span class="avatar pet-av"><span class="pet-emoji">🚗</span></span>`}<div class="grow" style="min-width:0"><div class="row" style="gap:6px">${plateHTML(w.plate, 'plate-sm')}<b class="ellipsis">${esc(w.vehicleName || '')}</b></div><div class="t-sub ellipsis">${esc((w.types || []).join(', '))}</div><div class="t-sub">${fmtTime(w.inAt)} · ${fmtAgo(w.inAt)}${w.staffName ? ' · ' + esc(w.staffName) : ''}${eta ? ` · le toca en ~${eta} min` : ''}</div><div class="row" style="gap:4px">${w.price ? `<span class="badge badge-neutral">${usd(w.price)}</span>` : ''}${w.charged ? '<span class="badge badge-success">cobrado</span>' : ''}</div></div></button>
        <div class="row" style="gap:4px">${nx === 'entregado' ? `<button class="btn btn-primary btn-sm grow" data-out="${w.id}">${icon('checkCircle')} Entregar</button>${!w.charged && w.price ? `<button class="btn btn-secondary btn-icon btn-sm" data-ch="${w.id}" title="Cobrar">${icon('cart')}</button>` : ''}` : `<button class="btn btn-secondary btn-sm grow" data-nx="${w.id}" data-v="${nx}">${icon(WASH_STATUS[nx].icon)} ${WASH_STATUS[nx].label}</button>`}${w.status === 'listo' && w.phone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${w.id}" title="Avisar que está listo">${icon('whatsapp')}</button>` : ''}</div></div>`; }).join('') || '<div class="kempty">—</div>'}</div>`; }).join('')}</div>
      ${!q.length ? emptyState('spray', 'El autolavado está libre', 'Registra la entrada con la placa: el cliente sabe cuánto le falta y le avisas por WhatsApp cuando esté listo.') : ''}`;
    el.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { const w = store.washes.find((x) => x.id === b.dataset.d); if (w?.vehicleId) openVehicle(w.vehicleId); });
    el.querySelectorAll('[data-nx]').forEach((b) => b.onclick = async () => {
      const w = store.washes.find((x) => x.id === b.dataset.nx); const st = b.dataset.v;
      await setWashStatus(w, st);
      if (st === 'listo' && w.phone && await confirmDialog({ title: `${esc(w.plate)} está listo`, message: '¿Le avisas al cliente por WhatsApp?', confirmText: 'Avisar' })) waClient('lavado_listo', { client: store.client(w.ownerId), wash: w });
    });
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => { const w = store.washes.find((x) => x.id === b.dataset.wa); waClient('lavado_listo', { client: store.client(w.ownerId), wash: w }); });
    el.querySelectorAll('[data-out]').forEach((b) => b.onclick = () => deliver(store.washes.find((x) => x.id === b.dataset.out)));
    el.querySelectorAll('[data-ch]').forEach((b) => b.onclick = () => charge(store.washes.find((x) => x.id === b.dataset.ch)));
  }
  $('#w-new').onclick = () => washForm();
  draw();
  const off = store.on('*', (evt) => { if (evt === 'washes' || evt === 'vehicles' || evt === 'settings') draw(); });
  const iv = setInterval(draw, 60000);
  return () => { off(); clearInterval(iv); };
}
