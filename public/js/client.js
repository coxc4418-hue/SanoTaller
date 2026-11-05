// SanoTaller — Clientes y vehículos: buscadores, formularios, ficha del vehículo (órdenes, mantenimiento, kilometraje) y ficha pública con QR
import { store, clientBadge } from './store.js';
import { saveClient, setClientActive, saveVehicle, setVehicleActive, renewCardCode, cardUrl, payBalance, adjustPoints, addService, removeService, markReminded, updateKm } from './ops.js';
import {
  VTYPES, vtypeOf, BRANDS, FUELS, GEARS, COLORS, OILS, vehicleName, vehicleLine, estKm, kmPerDay, latestBy, dueTone, dueText, plateKey,
  JOB_STATUS, JOB_TYPES, jobBadge, SERVICES, apptBadge, productLine, searchText, jobTotals
} from './taller.js';
import { openModal, esc, usd, toast, setBusy, fmtDate, fmtDateTime, todayKey, dayKey, addDays, loc, normalize, debounce, initials, colorFor, confirmDialog, promptDialog, emptyState, printHTML, num, parseNum, compressImage } from './utils.js';
import { icon } from './icons.js';
import { qrDataURL, waClient, printReceipt, PRINT_HEAD } from './shared.js';
import { requirePin } from './auth.js';

const nav = async (route, params = {}) => { const { navigate } = await import('./main.js'); navigate(route, { params, force: true }); };
const jobsMod = () => import('./views/jobs.js');

// ======================================================================
// PIEZAS VISUALES
// ======================================================================
export function avatar(c, size = '') { return `<span class="avatar ${size}" style="background:${colorFor(c?.name)}">${esc(initials(c?.name))}</span>`; }
export function hydratePhotos() {}
/** Foto del vehículo o su ícono sobre el color del tipo */
export function vehAvatar(v, size = '') {
  const t = vtypeOf(v);
  if (v?.photo) return `<span class="avatar pet-av ${size}"><img src="${esc(v.photo)}" alt=""></span>`;
  return `<span class="avatar pet-av ${size}" style="background:${t.color}22;color:${t.color}"><span class="pet-emoji">${t.emoji}</span></span>`;
}
/** Placa con estilo de matrícula */
export const plateHTML = (plate, size = '') => `<span class="plate ${size}">${esc(plate || 'S/P')}</span>`;
export const vehLine = (v) => vehicleLine(v);
export const clientLine = (c) => {
  const vs = store.vehiclesOf(c?.id);
  const bits = [];
  if (vs.length) bits.push(vs.map((v) => `${v.plate} ${v.brand || ''} ${v.model || ''}`.trim()).join(', '));
  if (c?.lastVisitAt) bits.push(`última visita ${fmtDate(c.lastVisitAt)}`);
  else if (!vs.length) bits.push('sin vehículos registrados');
  return esc(bits.join(' · '));
};
export function pointsHTML(c) {
  const L = store.loyalty;
  if (!L?.enabled) return '';
  const pts = Math.floor(Number(c?.points) || 0);
  return `<span class="badge badge-violet">${icon('star')} ${pts} pts${L.pointValue ? ` · ${usd(pts * L.pointValue)}` : ''}</span>`;
}
/** Insignia del plan de mantenimiento: lo más urgente */
export function dueBadge(v) {
  const it = store.dueFor(v)[0];
  if (!it) return '<span class="badge badge-neutral">Sin plan de mantenimiento</span>';
  return `<span class="badge badge-${dueTone(it)}">${icon('droplet')} ${esc(it.name.split(' (')[0])}: ${dueText(it)}</span>`;
}
/** Insignia si el vehículo está ahora en el taller */
export function inShopBadge(v) {
  const j = store.jobOfVehicle(v?.id);
  return j ? `<span class="badge badge-${JOB_STATUS[j.status]?.tone || 'info'}">${icon('wrench')} ${esc(j.number)} · ${JOB_STATUS[j.status]?.label || ''}</span>` : '';
}
/** Mini gráfico del kilometraje */
export function kmChart(v, w = 280, h = 70) {
  const list = (v?.kmLog || []).slice(-12);
  if (list.length < 2) return '';
  const vals = list.map((x) => Number(x.km) || 0);
  const mn = Math.min(...vals), mx = Math.max(...vals); const span = mx - mn || 1;
  const X = (i) => (i / (vals.length - 1)) * (w - 16) + 8; const Y = (val) => h - 10 - ((val - mn) / span) * (h - 24);
  return `<svg class="wchart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Kilometraje"><polyline points="${vals.map((val, i) => `${X(i)},${Y(val)}`).join(' ')}" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${vals.map((val, i) => `<circle cx="${X(i)}" cy="${Y(val)}" r="3" fill="var(--brand)"><title>${fmtDate(list[i].date)}: ${num(val, 0)} km</title></circle>`).join('')}</svg>
    <div class="between t-sub"><span>${fmtDate(list[0].date)} · ${num(vals[0], 0)} km</span><span>${fmtDate(list[list.length - 1].date)} · <b>${num(vals[vals.length - 1], 0)} km</b></span></div>`;
}

// ======================================================================
// BUSCAR CLIENTE / VEHÍCULO
// ======================================================================
const ownerMatch = (x, t, d) => !t || normalize(`${x.name} ${x.number || ''} ${x.idDoc || ''} ${x.company || ''} ${store.vehiclesOf(x.id).map((v) => `${v.plate} ${v.brand} ${v.model}`).join(' ')}`).includes(t) || (d.length >= 3 && (String(x.phone || '').replace(/\D/g, '').includes(d) || String(x.idDoc || '').replace(/\D/g, '').includes(d)));
export function pickClient({ title = 'Buscar cliente', allowNew = true } = {}) {
  return new Promise((resolve) => {
    let picked = null;
    const m = openModal({
      title, size: 'md',
      body: `<div class="stack"><label class="search search-big">${icon('search')}<input data-q placeholder="Cliente, placa, cédula o teléfono…" autocomplete="off" autofocus></label><div class="pick-list" data-l></div></div>`,
      footer: `${allowNew ? `<button class="btn btn-secondary" data-new style="margin-right:auto">${icon('userPlus')} Cliente nuevo</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button>`,
      onClose: () => resolve(picked)
    });
    const draw = (q = '') => {
      const t = normalize(q); const d = q.replace(/\D/g, '');
      const list = store.clients.filter((x) => x.active !== false && ownerMatch(x, t, d)).slice(0, 40);
      m.el.querySelector('[data-l]').innerHTML = list.length ? list.map((x) => `<button type="button" class="list-item" data-id="${x.id}">${avatar(x)}<div class="grow" style="min-width:0"><b class="ellipsis">${esc(x.name)}</b><div class="t-sub ellipsis">${esc(x.number)}${x.phone ? ' · ' + esc(x.phone) : ''}</div><div class="t-sub ellipsis">${clientLine(x)}</div></div></button>`).join('')
        : emptyState('users', t ? 'Sin resultados' : 'Aún no hay clientes', allowNew ? 'Regístralo con “Cliente nuevo”.' : '');
      m.el.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { picked = store.client(b.dataset.id); m.close(); });
    };
    m.el.querySelector('[data-q]').oninput = debounce((e) => draw(e.target.value), 80);
    m.el.querySelector('[data-q]').onkeydown = (e) => { if (e.key === 'Enter') { const f = store.findClient(e.target.value); if (f) { picked = f; m.close(); } } };
    const nb = m.el.querySelector('[data-new]');
    if (nb) nb.onclick = async () => { const q = m.el.querySelector('[data-q]').value.trim(); const isNum = /\d{6,}/.test(q); const r = await clientForm(null, { name: isNum ? '' : q, phone: isNum ? q : '' }); if (r) { picked = r; m.close(); } };
    draw();
  });
}
const vehMatch = (v, t, d) => !t || normalize(`${v.plate} ${plateKey(v.plate)} ${v.brand || ''} ${v.model || ''} ${v.year || ''} ${v.color || ''} ${v.ownerName || ''} ${v.number || ''} ${v.vin || ''} ${v.cardCode || ''}`).includes(t) || (d.length >= 4 && String(v.ownerPhone || '').replace(/\D/g, '').includes(d));
export function pickVehicle({ title = 'Buscar vehículo', allowNew = true, ownerId = null } = {}) {
  return new Promise((resolve) => {
    let picked = null;
    const m = openModal({
      title, size: 'md',
      body: `<div class="stack"><label class="search search-big">${icon('search')}<input data-q placeholder="Placa, marca, modelo, dueño o teléfono…" autocomplete="off" autofocus autocapitalize="characters"></label><div class="pick-list" data-l></div></div>`,
      footer: `${allowNew ? `<button class="btn btn-secondary" data-new style="margin-right:auto">${icon('plus')} Vehículo nuevo</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button>`,
      onClose: () => resolve(picked)
    });
    const draw = (q = '') => {
      const t = normalize(q); const d = q.replace(/\D/g, '');
      const list = store.vehicles.filter((v) => v.active !== false && (!ownerId || v.ownerId === ownerId) && vehMatch(v, t, d)).slice(0, 40);
      m.el.querySelector('[data-l]').innerHTML = list.length ? list.map((v) => `<button type="button" class="list-item" data-id="${v.id}">${vehAvatar(v)}<div class="grow" style="min-width:0"><div class="row" style="gap:6px">${plateHTML(v.plate, 'plate-sm')}<b class="ellipsis">${esc(vehicleName(v))}</b></div><div class="t-sub ellipsis">${esc([v.color, v.km ? num(v.km, 0) + ' km' : ''].filter(Boolean).join(' · '))}</div><div class="t-sub ellipsis">${icon('user')} ${esc(v.ownerName || '')}${v.ownerPhone ? ' · ' + esc(v.ownerPhone) : ''}</div></div>${inShopBadge(v)}</button>`).join('')
        : emptyState('car', t ? 'Sin resultados' : 'Aún no hay vehículos', allowNew ? 'Regístralo con “Vehículo nuevo”.' : '');
      m.el.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { picked = store.vehicle(b.dataset.id); m.close(); });
    };
    m.el.querySelector('[data-q]').oninput = debounce((e) => draw(e.target.value), 80);
    m.el.querySelector('[data-q]').onkeydown = (e) => { if (e.key === 'Enter') { const f = store.findVehicle(e.target.value); if (f) { picked = f; m.close(); } } };
    const nb = m.el.querySelector('[data-new]');
    if (nb) nb.onclick = async () => { const q = m.el.querySelector('[data-q]').value.trim(); const r = await vehicleForm(null, { owner: ownerId ? store.client(ownerId) : null, plate: /\d/.test(q) && q.length <= 9 ? q : '' }); if (r) { picked = r.vehicle; m.close(); } };
    draw();
  });
}

// ======================================================================
// FORMULARIO DEL CLIENTE
// ======================================================================
export function clientForm(client = null, preset = {}) {
  const x = { ...preset, ...(client || {}) };
  return new Promise((resolve) => {
    let saved = null;
    const m = openModal({
      title: client ? 'Editar cliente' : 'Nuevo cliente', sub: client ? esc(client.number) : 'El dueño o responsable del vehículo. Con nombre y teléfono basta.', size: 'md',
      body: `<form data-f autocomplete="off"><div class="form-grid">
          <div class="field full"><label>Nombre y apellido *</label><input class="input" name="name" value="${esc(x.name || '')}" autofocus></div>
          <div class="field"><label>Teléfono / WhatsApp</label><input class="input" name="phone" inputmode="tel" value="${esc(x.phone || '')}" placeholder="Para avisarle cuando esté listo"></div>
          <div class="field"><label>${esc(loc().id)}</label><input class="input" name="idDoc" value="${esc(x.idDoc || '')}" placeholder="Para facturas"></div>
          <div class="field"><label>Empresa / flota</label><input class="input" name="company" value="${esc(x.company || '')}" placeholder="Si es un carro de empresa"></div>
          <div class="field"><label>Otro teléfono</label><input class="input" name="phone2" inputmode="tel" value="${esc(x.phone2 || '')}"></div>
          <div class="field"><label>Correo</label><input class="input" name="email" inputmode="email" value="${esc(x.email || '')}"></div>
          <div class="field"><label>Dirección</label><input class="input" name="address" value="${esc(x.address || '')}"></div>
          ${store.activeAgreements.length ? `<div class="field"><label>Convenio / flota</label><select class="select" name="agreementId"><option value="">Ninguno</option>${store.activeAgreements.map((a) => `<option value="${a.id}" ${x.agreementId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
          <div class="field"><label>N° de afiliado</label><input class="input" name="agreementNumber" value="${esc(x.agreementNumber || '')}"></div>` : ''}
          <div class="field"><label>¿Cómo nos conoció?</label><select class="select" name="howFound">${['', 'Recomendación', 'Instagram', 'Facebook', 'Google Maps', 'Pasó por el frente', 'Otro'].map((v) => `<option ${x.howFound === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field full"><label>Notas</label><input class="input" name="notes" value="${esc(x.notes || '')}" placeholder="Ej.: prefiere que lo llamen en la tarde"></div>
        </div><div class="error-msg mt" data-err></div></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} ${client ? 'Guardar' : 'Registrar cliente'}</button>`,
      onClose: () => resolve(saved)
    });
    const F = m.el.querySelector('[data-f]').elements;
    m.el.querySelector('[data-f]').onsubmit = (e) => { e.preventDefault(); m.el.querySelector('[data-ok]').click(); };
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      const err = m.el.querySelector('[data-err]'); err.textContent = '';
      if (!F.name.value.trim()) { err.textContent = 'Escribe el nombre del cliente.'; F.name.focus(); return; }
      const btn = e.currentTarget; setBusy(btn, true, 'Guardando…');
      const data = { name: F.name.value, phone: F.phone.value, idDoc: F.idDoc.value, company: F.company.value, phone2: F.phone2.value, email: F.email.value, address: F.address.value, howFound: F.howFound.value, notes: F.notes.value, agreementId: F.agreementId?.value || '', agreementNumber: F.agreementNumber?.value || '' };
      try { saved = await saveClient(data, client?.id || null); m.close(); toast(client ? 'Cliente actualizado' : `Cliente registrado: ${saved.number}`); }
      catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
    };
  });
}

// ======================================================================
// FORMULARIO DEL VEHÍCULO
// ======================================================================
export function vehicleForm(veh = null, { owner = null, plate = '' } = {}) {
  const x = { type: 'carro', ...(veh || {}), ...(veh ? {} : { plate }) };
  return new Promise((resolve) => {
    let saved = null; let photo = x.photo || ''; let type = x.type || 'carro';
    let own = veh ? store.client(veh.ownerId) : owner;
    const m = openModal({
      title: veh ? `Editar ${esc(veh.plate)}` : 'Nuevo vehículo', sub: veh ? esc(veh.number) : 'Lo esencial: placa, marca, modelo y dueño.', size: 'lg',
      body: `<form data-f autocomplete="off">
        <div class="pet-form-top">
          <label class="pet-photo" title="Foto del vehículo"><input type="file" accept="image/*" data-ph hidden><span data-phv>${photo ? `<img src="${esc(photo)}" alt="">` : `${icon('camera')}<small>Foto</small>`}</span></label>
          <div class="grow stack" style="gap:10px">
            <div class="field"><label>Placa *</label><input class="input input-lg mono plate-input" name="plate" value="${esc(x.plate || '')}" autofocus placeholder="Ej.: AB123CD" autocapitalize="characters"></div>
            <div class="chips chips-wrap" data-tp>${Object.entries(VTYPES).map(([k, v]) => `<button type="button" class="chip ${k === type ? 'on' : ''}" data-v="${k}">${v.emoji} ${v.label}</button>`).join('')}</div>
          </div>
        </div>
        <div class="section-title mt">${icon('user')} Dueño</div>
        <div data-own></div>
        <div class="form-grid mt">
          <div class="field"><label>Marca</label><input class="input" name="brand" list="brands-dl" value="${esc(x.brand || '')}" placeholder="Toyota"><datalist id="brands-dl">${Object.keys(BRANDS).map((b) => `<option value="${esc(b)}">`).join('')}</datalist></div>
          <div class="field"><label>Modelo</label><input class="input" name="model" list="models-dl" value="${esc(x.model || '')}" placeholder="Corolla"><datalist id="models-dl"></datalist></div>
          <div class="field"><label>Año</label><input class="input" name="year" inputmode="numeric" maxlength="4" value="${esc(x.year || '')}"></div>
          <div class="field"><label>Color</label><input class="input" name="color" list="colors-dl" value="${esc(x.color || '')}"><datalist id="colors-dl">${COLORS.map((c) => `<option value="${c}">`).join('')}</datalist></div>
          <div class="field"><label>Kilometraje actual</label><div class="input-group"><input class="input" name="km" inputmode="numeric" value="${x.km ? esc(String(x.km)) : ''}"><span class="suffix">km</span></div></div>
          <div class="field"><label>Combustible</label><select class="select" name="fuel"><option value="">—</option>${Object.entries(FUELS).map(([k, v]) => `<option value="${k}" ${x.fuel === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>Transmisión</label><select class="select" name="gear"><option value="">—</option>${Object.entries(GEARS).map(([k, v]) => `<option value="${k}" ${x.gear === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>Aceite que usa</label><input class="input" name="oil" list="oils-dl" value="${esc(x.oil || '')}" placeholder="15W-40 mineral"><datalist id="oils-dl">${OILS.map((c) => `<option value="${c}">`).join('')}</datalist></div>
          <div class="field"><label>Motor</label><input class="input" name="engine" value="${esc(x.engine || '')}" placeholder="Ej.: 1.8 4 cilindros"></div>
          <div class="field"><label>Serial de carrocería (VIN)</label><input class="input mono" name="vin" value="${esc(x.vin || '')}"></div>
          <div class="field"><label>Cauchos (medida)</label><input class="input" name="tires" value="${esc(x.tires || '')}" placeholder="Ej.: 195/65 R15"></div>
          <div class="field"><label>Seguro</label><input class="input" name="insurance" value="${esc(x.insurance || '')}" placeholder="Aseguradora y póliza"></div>
          <div class="field full"><label>Notas</label><input class="input" name="notes" value="${esc(x.notes || '')}" placeholder="Ej.: tiene alarma, la llave de seguridad de los rines está en la guantera"></div>
        </div>
        <div class="error-msg mt" data-err></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} ${veh ? 'Guardar' : 'Registrar vehículo'}</button>`,
      onClose: () => resolve(saved)
    });
    const q = (s) => m.el.querySelector(s);
    const F = q('[data-f]').elements;
    const drawOwner = () => {
      q('[data-own]').innerHTML = own?.id ? `<div class="list-item box">${avatar(own)}<div class="grow" style="min-width:0"><b>${esc(own.name)}</b><div class="t-sub">${esc(own.number || '')}${own.phone ? ' · ' + esc(own.phone) : ''}</div></div><button type="button" class="btn btn-ghost btn-sm" data-chg>${icon('refresh')} Cambiar</button></div>`
        : `<div class="form-grid"><div class="field"><label>Nombre del dueño *</label><input class="input" data-on value="${esc(own?.name || '')}"></div><div class="field"><label>Teléfono / WhatsApp</label><input class="input" data-op inputmode="tel" value="${esc(own?.phone || '')}"></div></div><button type="button" class="btn btn-ghost btn-sm mt-xs" data-chg>${icon('search')} Elegir un cliente registrado</button>`;
      q('[data-chg]').onclick = async () => { const c = await pickClient({ title: 'Dueño del vehículo' }); if (c) { own = c; drawOwner(); } };
    };
    const drawModels = () => { q('#models-dl').innerHTML = (BRANDS[F.brand.value.trim()] || Object.values(BRANDS).flat()).map((b) => `<option value="${esc(b)}">`).join(''); };
    F.brand.oninput = drawModels;
    F.plate.oninput = () => { const p = F.plate.selectionStart; F.plate.value = F.plate.value.toUpperCase(); F.plate.setSelectionRange(p, p); };
    m.el.querySelectorAll('[data-tp] [data-v]').forEach((b) => b.onclick = () => { type = b.dataset.v; m.el.querySelectorAll('[data-tp] [data-v]').forEach((y) => y.classList.toggle('on', y === b)); });
    q('[data-ph]').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { photo = await compressImage(f, 360, 0.72); q('[data-phv]').innerHTML = `<img src="${photo}" alt="">`; } catch (_) { toast('No se pudo leer la imagen', 'warning'); }
    };
    drawOwner(); drawModels();
    q('[data-f]').onsubmit = (e) => { e.preventDefault(); q('[data-ok]').click(); };
    q('[data-ok]').onclick = async (e) => {
      const err = q('[data-err]'); err.textContent = '';
      if (!F.plate.value.trim()) { err.textContent = 'Escribe la placa.'; F.plate.focus(); return; }
      const ow = own?.id ? own : { name: q('[data-on]')?.value || '', phone: q('[data-op]')?.value || '' };
      if (!veh && !String(ow.name || '').trim()) { err.textContent = 'Escribe el nombre del dueño o elige uno registrado.'; q('[data-on]')?.focus(); return; }
      const btn = e.currentTarget; setBusy(btn, true, 'Guardando…');
      const data = { plate: F.plate.value, type, brand: F.brand.value, model: F.model.value, year: F.year.value, color: F.color.value, km: parseNum(F.km.value), fuel: F.fuel.value, gear: F.gear.value, oil: F.oil.value, engine: F.engine.value, vin: F.vin.value, tires: F.tires.value, insurance: F.insurance.value, notes: F.notes.value, photo };
      try {
        saved = await saveVehicle(data, veh?.id || null, veh ? (own?.id && own.id !== veh.ownerId ? own : null) : ow);
        m.close(); toast(veh ? 'Vehículo actualizado' : `${saved.vehicle.plate} registrado: ${saved.vehicle.number}`);
      } catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
    };
  });
}

// ======================================================================
// PRODUCTOS (repuestos y servicios)
// ======================================================================
export function pickProduct({ title = 'Buscar repuesto o servicio', filter = null } = {}) {
  return new Promise((resolve) => {
    let picked = null;
    const m = openModal({ title, size: 'md', body: `<div class="stack"><label class="search search-big">${icon('search')}<input data-q placeholder="Nombre, referencia, vehículo o código…" autofocus autocomplete="off"></label><div class="pick-list" data-l></div></div>`, footer: '<button class="btn btn-secondary" data-close>Cancelar</button>', onClose: () => resolve(picked) });
    const draw = (q = '') => {
      const t = normalize(q);
      const exact = store.byBarcode(q);
      const list = (exact ? [exact] : store.products.filter((p) => p.active !== false && (!filter || filter(p)) && (!t || t.split(' ').every((w) => searchText(p).includes(w))))).slice(0, 40);
      m.el.querySelector('[data-l]').innerHTML = list.map((p) => `<button type="button" class="list-item" data-id="${p.id}"><span class="kpi-icon tone-brand" style="width:36px;height:36px">${icon(p.trackStock === false ? 'wrench' : /aceite|lubric/i.test(p.category || '') ? 'droplet' : 'box')}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(p.name)}</b><div class="t-sub ellipsis">${esc(productLine(p) || p.category || '')}</div></div>${p.trackStock === false ? '' : `<span class="t-sub">${num(p.stock || 0, 0)} disp.</span>`}<b class="num">${usd(p.price)}</b></button>`).join('') || emptyState('box', 'Sin resultados');
      m.el.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { picked = store.product(b.dataset.id); m.close(); });
    };
    m.el.querySelector('[data-q]').oninput = debounce((e) => draw(e.target.value), 80);
    draw();
  });
}

// ======================================================================
// MANTENIMIENTO (registro de un servicio del plan)
// ======================================================================
export function serviceForm(v, s0 = null) {
  return new Promise((resolve) => {
    let saved = null; let maintId = s0?.maintId || null;
    const cur = store.vehicle(v.id) || v;
    const m = openModal({
      title: s0 ? 'Editar mantenimiento' : 'Registrar mantenimiento', sub: `${esc(cur.plate)} · ${esc(vehicleName(cur))} · queda en su plan con el próximo por km y fecha`, size: 'md',
      body: `<div class="stack">
        ${s0 ? '' : `<div class="chips chips-wrap" data-cat>${store.maintPlan.map((c) => `<button type="button" class="chip" data-id="${c.id}">${icon(c.icon || 'wrench')} ${esc(c.name)}</button>`).join('')}</div>`}
        <div class="form-grid">
          <div class="field full"><label>Servicio *</label><input class="input" data-n value="${esc(s0?.name || '')}" placeholder="Ej.: Cambio de aceite y filtro"></div>
          <div class="field"><label>Fecha</label><input class="input" type="date" data-d value="${esc(s0?.date || todayKey())}"></div>
          <div class="field"><label>Kilometraje</label><div class="input-group"><input class="input" data-km inputmode="numeric" value="${esc(String(s0?.km || cur.km || ''))}"><span class="suffix">km</span></div></div>
          <div class="field"><label>Próximo a los</label><div class="input-group"><input class="input" data-nk inputmode="numeric" value="${esc(String(s0?.nextKm || ''))}"><span class="suffix">km</span></div></div>
          <div class="field"><label>O en la fecha</label><input class="input" type="date" data-nx value="${esc(s0?.next || '')}"></div>
          <div class="field full"><label>Nota</label><input class="input" data-no value="${esc(s0?.note || '')}" placeholder="Ej.: aceite 15W-40, filtro marca X"></div>
        </div><div class="error-msg" data-err></div></div>`,
      footer: `${s0 ? `<button class="btn btn-ghost text-danger" data-del>${icon('trash')} Quitar</button>` : ''}<span class="grow"></span><button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`,
      onClose: () => resolve(saved)
    });
    const q = (s) => m.el.querySelector(s);
    const recalc = () => {
      const c = store.maintPlan.find((x) => x.id === maintId); if (!c) return;
      const km = parseNum(q('[data-km]').value);
      q('[data-nk]').value = km && c.everyKm ? String(Math.round(km + Number(c.everyKm))) : '';
      const d = q('[data-d]').value || todayKey();
      q('[data-nx]').value = c.everyDays ? dayKey(addDays(new Date(d + 'T12:00:00'), Number(c.everyDays))) : '';
    };
    m.el.querySelectorAll('[data-cat] [data-id]').forEach((b) => b.onclick = () => {
      const c = store.maintPlan.find((x) => x.id === b.dataset.id); maintId = c.id; q('[data-n]').value = c.name; recalc();
      m.el.querySelectorAll('[data-cat] [data-id]').forEach((y) => y.classList.toggle('on', y === b));
    });
    q('[data-km]').oninput = () => { if (maintId && !s0) recalc(); };
    q('[data-ok]').onclick = async (e) => {
      setBusy(e.currentTarget, true);
      try {
        saved = await addService(store.vehicle(v.id) || v, { id: s0?.id, maintId, name: q('[data-n]').value, date: q('[data-d]').value, km: parseNum(q('[data-km]').value), nextKm: parseNum(q('[data-nk]').value) || null, next: q('[data-nx]').value, note: q('[data-no]').value, jobId: s0?.jobId, jobNumber: s0?.jobNumber });
        m.close(); toast(`Mantenimiento registrado en ${cur.plate}`);
      } catch (ex) { q('[data-err]').textContent = ex.message; setBusy(e.currentTarget, false); }
    };
    q('[data-del]')?.addEventListener('click', async () => { await removeService(store.vehicle(v.id) || v, s0.id); saved = { removed: true }; m.close(); toast('Registro quitado', 'warning'); });
  });
}
export async function kmDialog(v) {
  const val = await promptDialog({ title: 'Actualizar kilometraje', label: `${v.plate} · última lectura ${v.km ? num(v.km, 0) + ' km' : '—'}`, value: '', confirmText: 'Guardar' });
  const n = parseNum(val);
  if (!(n > 0)) return false;
  if (v.km && n < Number(v.km) && !(await confirmDialog({ title: 'Kilometraje menor', message: `La lectura anterior era ${num(v.km, 0)} km. ¿Guardar ${num(n, 0)} km de todas formas?`, confirmText: 'Guardar' }))) return false;
  await updateKm(v, n); toast('Kilometraje actualizado');
  return true;
}

// ======================================================================
// FICHA DEL VEHÍCULO
// ======================================================================
const VTABS = { resumen: 'Resumen', ordenes: 'Órdenes', mantenimiento: 'Mantenimiento', citas: 'Citas', compras: 'Compras' };
export async function openVehicle(id, { tab: tab0 = 'resumen' } = {}) {
  let v = store.vehicle(id) || await store.getVehicle(id);
  if (!v) { toast('Vehículo no encontrado', 'warning'); return; }
  let tab = tab0;
  const cache = {};
  const m = openModal({ title: '', size: 'xl', body: '<div data-root></div>' });
  m.el.querySelector('.modal')?.classList.add('member-modal');
  const root = m.el.querySelector('[data-root]');
  const load = async (k, fn) => (cache[k] ??= await fn().catch((e) => { console.error(e); return []; }));
  const offs = [store.on('vehicles', () => { const n = store.vehicle(id); if (n && n !== v) { v = n; header(); if (['resumen', 'mantenimiento'].includes(tab)) draw(); } }), store.on('jobs', () => header())];
  const close0 = m.close; m.close = () => { offs.forEach((f) => f()); close0(); };
  root.innerHTML = `<div data-head></div><div class="tabs mt" data-tabs>${Object.entries(VTABS).map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('')}</div><div data-body class="mt"></div>`;
  const $ = (q) => root.querySelector(q);
  const owner = () => store.client(v.ownerId);

  function header() {
    const o = owner();
    const job = store.jobOfVehicle(v.id);
    $('[data-head]').innerHTML = `<div class="mhead">
      ${vehAvatar(v, 'avatar-xl')}
      <div class="grow" style="min-width:0">
        <div class="row row-wrap">${plateHTML(v.plate, 'plate-lg')}<h2 class="mhead-name">${esc(vehicleName(v))}</h2>${v.active === false ? '<span class="badge badge-neutral">De baja</span>' : dueBadge(v)}${inShopBadge(v)}</div>
        <div class="t-sub">${esc(v.number || '')} · ${esc([vtypeOf(v).label, v.color, v.fuel ? FUELS[v.fuel] : '', v.gear ? GEARS[v.gear] : '', v.engine].filter(Boolean).join(' · '))}${v.vin ? ` · VIN ${esc(v.vin)}` : ''}</div>
        <div class="small mt-xs">${icon('user')} <button class="linkish" data-own><b>${esc(o?.name || v.ownerName || '—')}</b></button>${o?.phone ? ` · ${esc(o.phone)}` : ''}${(Number(o?.balance) || 0) > 0.009 ? ` <span class="badge badge-danger">debe ${usd(o.balance)}</span>` : ''}</div>
      </div>
      <button class="x-btn" data-x aria-label="Cerrar">${icon('x')}</button>
    </div>
    <div class="mactions">
      ${job ? `<button class="btn btn-primary" data-a="job">${icon('wrench')} Ver orden ${esc(job.number)}</button>` : `<button class="btn btn-primary" data-a="receive">${icon('wrench')} Recibir en el taller</button>`}
      <button class="btn btn-secondary" data-a="maint">${icon('droplet')} Mantenimiento</button>
      <button class="btn btn-secondary" data-a="km">${icon('gauge')} Kilometraje</button>
      <button class="btn btn-secondary" data-a="appt">${icon('calendar')} Cita</button>
      <button class="btn btn-secondary" data-a="wash">${icon('spray')} Lavado</button>
      <button class="btn btn-secondary" data-a="card">${icon('qr')} Ficha</button>
      <button class="btn btn-whatsapp" data-a="wa">${icon('whatsapp')} WhatsApp</button>
      <button class="btn btn-ghost" data-a="edit">${icon('edit')} Editar</button>
      <button class="btn btn-ghost btn-icon" data-a="more" title="Más opciones">${icon('menu')}</button>
    </div>`;
    $('[data-x]').onclick = () => m.close();
    $('[data-own]').onclick = () => { m.close(); openClient(v.ownerId); };
    root.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => action(b.dataset.a));
  }

  async function action(a) {
    if (a === 'receive') { const { receiveForm } = await jobsMod(); const r = await receiveForm(v); if (r) { m.close(); (await jobsMod()).openJob(r.id); } }
    if (a === 'job') { const j = store.jobOfVehicle(v.id); if (j) { m.close(); (await jobsMod()).openJob(j.id); } }
    if (a === 'maint') { if (await serviceForm(v)) { tab = 'mantenimiento'; draw(); } }
    if (a === 'km') { if (await kmDialog(v)) { v = store.vehicle(id) || v; header(); draw(); } }
    if (a === 'appt') { const { apptForm } = await import('./views/agenda.js'); if (await apptForm(null, { vehicle: v })) { cache.appts = null; tab = 'citas'; draw(); } }
    if (a === 'wash') { const { washForm } = await import('./views/wash.js'); await washForm({ vehicle: v }); }
    if (a === 'card') cardModal(v);
    if (a === 'edit') { const r = await vehicleForm(v); if (r) { v = { ...v, ...r.vehicle }; header(); draw(); } }
    if (a === 'wa') waMenu(v);
    if (a === 'more') moreMenu();
  }

  function moreMenu() {
    const mm = openModal({
      title: 'Más opciones', sub: esc(v.plate), size: 'sm',
      body: `<div class="list">
        <button class="list-item" data-o="sell">${icon('cart')}<div class="grow"><b>Vender a este vehículo</b><div class="t-sub">Repuestos o servicios de mostrador</div></div></button>
        <button class="list-item" data-o="print">${icon('print')}<div class="grow"><b>Imprimir historial de mantenimiento</b><div class="t-sub">Tamaño carta, con QR</div></div></button>
        <button class="list-item" data-o="code">${icon('refresh')}<div class="grow"><b>Nuevo código de ficha</b><div class="t-sub">Si el vehículo se vendió o se compartió por error</div></div></button>
        ${v.active === false ? `<button class="list-item" data-o="back">${icon('unlock')}<div class="grow"><b>Reactivar</b><div class="t-sub">Vuelve a la lista y a los recordatorios</div></div></button>`
          : `<button class="list-item" data-o="baja">${icon('x')}<div class="grow"><b>Dar de baja</b><div class="t-sub">Se vendió o ya no viene; se conserva su historial</div></div></button>`}
      </div>`,
      footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
    });
    const o = (k, fn) => mm.el.querySelector(`[data-o="${k}"]`)?.addEventListener('click', async () => { mm.close(); await fn(); });
    o('sell', () => { m.close(); nav('vender', { clientId: v.ownerId, vehicleId: v.id }); });
    o('print', () => printCard(v));
    o('code', async () => { if (!(await confirmDialog({ title: 'Nuevo código de ficha', message: 'El enlace anterior de la ficha dejará de funcionar.', confirmText: 'Generar' }))) return; const code = await renewCardCode(v); v = { ...v, cardCode: code }; toast('Código renovado'); cardModal(v); });
    o('back', async () => { await setVehicleActive(v, true); toast('Vehículo reactivado'); });
    o('baja', async () => { if (!(await confirmDialog({ title: 'Dar de baja', message: `${esc(v.plate)} dejará de aparecer en la lista y en los recordatorios. Su historial se conserva.`, confirmText: 'Dar de baja', danger: true }))) return; await setVehicleActive(v, false); toast('Vehículo dado de baja', 'warning'); });
  }

  async function draw() {
    root.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    const body = $('[data-body]');
    body.innerHTML = '<div class="empty"><div class="spinner"></div></div>';
    try { await TAB[tab](body); } catch (e) { console.error(e); body.innerHTML = emptyState('alert', 'No se pudo cargar', esc(e.message)); }
  }

  const dueList = () => {
    const list = store.dueFor(v);
    return list.length ? `<div class="list">${list.map((it, i) => `<div class="list-item"><span class="kpi-icon tone-${dueTone(it) === 'neutral' ? 'brand' : dueTone(it)}" style="width:38px;height:38px">${icon(store.maintPlan.find((p) => p.name === it.name)?.icon || 'wrench')}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(it.name)}</b><div class="t-sub">último ${fmtDate(it.date)}${it.km ? ` a los ${num(it.km, 0)} km` : ''} · próximo ${[it.nextKm ? num(it.nextKm, 0) + ' km' : '', it.next ? fmtDate(it.next) : ''].filter(Boolean).join(' o ')}</div></div><span class="badge badge-${dueTone(it)}">${dueText(it)}</span>${owner()?.phone && (it.late || it.soon || it.urgency <= 20) ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-rem="${i}" title="Recordar al cliente">${icon('whatsapp')}</button>` : ''}</div>`).join('')}</div>`
      : emptyState('droplet', 'Sin plan de mantenimiento', 'Registra el último cambio de aceite y demás servicios: te avisamos cuándo toca el próximo, por kilometraje o por fecha.');
  };
  const bindDue = (body) => body.querySelectorAll('[data-rem]').forEach((b) => b.onclick = () => {
    const it = store.dueFor(v)[+b.dataset.rem]; if (!it) return;
    waClient('mantenimiento', { client: owner(), vehicle: v, item: it }); markReminded(v, `${it.name}:${it.nextKm || it.next}`);
  });
  const jobRow = (j) => `<div class="hc-item"><div class="hc-date"><b>${fmtDate(j.inAt).slice(0, 5)}</b><small>${fmtDate(j.inAt).slice(6)}</small></div><div class="grow" style="min-width:0">
      <div class="row row-wrap" style="gap:6px">${jobBadge(j.status)}<span class="badge badge-${JOB_TYPES[j.type]?.tone || 'neutral'}">${icon(JOB_TYPES[j.type]?.icon || 'wrench')} ${JOB_TYPES[j.type]?.label || 'Servicio'}</span><b>${esc(j.number)}</b>${j.status === 'entregado' && !j.charged && jobTotals(j, true).total > 0 ? '<span class="badge badge-warning">por cobrar</span>' : ''}</div>
      <div class="small">${esc(j.complaint || '')}</div>
      <div class="t-sub">${j.kmIn ? `${num(j.kmIn, 0)} km · ` : ''}${esc(j.mechanicName || '')}${(j.lines || []).length ? ` · ${(j.lines || []).filter((l) => l.approved !== false).map((l) => esc(l.name)).slice(0, 4).join(', ')}` : ''}</div></div>
      <div class="row hc-actions" style="gap:2px;align-self:flex-start"><b class="num small">${usd(jobTotals(j, j.status === 'entregado').total)}</b><button class="btn btn-ghost btn-icon btn-sm" data-j="${j.id}" title="Abrir">${icon('chevronRight')}</button></div></div>`;
  const bindJobs = (body) => body.querySelectorAll('[data-j]').forEach((b) => b.onclick = async () => { m.close(); (await jobsMod()).openJob(b.dataset.j); });

  const TAB = {
    async resumen(body) {
      const jobs = await load('jobs', () => store.vehicleJobs(v.id));
      const qr = v.cardCode ? await qrDataURL(cardUrl(v.cardCode), 3) : '';
      const est = estKm(v, store.settings.kmPerDay);
      const spent = jobs.filter((j) => j.status === 'entregado').reduce((a, j) => a + (Number(j.total) || 0), 0);
      body.innerHTML = `<div class="grid-main">
        <div class="stack">
          <div class="kpis kpis-sm">
            <div class="card kpi"><div class="kpi-label">Kilometraje</div><div class="kpi-value">${v.km ? num(est, 0) : '—'} <small>km</small></div><div class="kpi-sub">${v.km && est !== Number(v.km) ? `estimado · leído ${num(v.km, 0)} el ${fmtDate(v.kmAt)}` : v.kmAt ? `leído el ${fmtDate(v.kmAt)}` : 'sin lectura'}</div></div>
            <div class="card kpi"><div class="kpi-label">Visitas</div><div class="kpi-value">${v.visits || jobs.length || 0}</div><div class="kpi-sub">desde ${fmtDate(v.createdAt)}</div></div>
            <div class="card kpi"><div class="kpi-label">Invertido</div><div class="kpi-value" style="font-size:18px">${usd(spent)}</div><div class="kpi-sub">${jobs.filter((j) => j.status === 'entregado').length} orden(es) entregadas</div></div>
            <div class="card kpi"><div class="kpi-label">Garantía</div><div class="kpi-value" style="font-size:18px">${v.warrantyUntil && v.warrantyUntil >= todayKey() ? fmtDate(v.warrantyUntil) : '—'}</div><div class="kpi-sub">${v.warrantyUntil && v.warrantyUntil >= todayKey() ? `${esc(v.warrantyJob || '')}${v.warrantyKm ? ` · hasta ${num(v.warrantyKm, 0)} km` : ''}` : 'sin garantía vigente'}</div></div>
          </div>
          <div class="card"><div class="card-head"><div class="card-title">${icon('droplet')} Plan de mantenimiento</div><button class="btn btn-ghost btn-sm" data-am>${icon('plus')} Registrar</button></div>${dueList()}</div>
          <div class="card"><div class="card-head"><div class="card-title">${icon('wrench')} Últimas órdenes</div><button class="btn btn-ghost btn-sm" data-allj>Ver todas</button></div>${jobs.length ? `<div class="hc">${jobs.slice(0, 3).map(jobRow).join('')}</div>` : emptyState('wrench', 'Sin órdenes', 'Recíbelo en el taller con el botón de arriba.')}</div>
        </div>
        <div class="stack">
          ${(v.kmLog || []).length > 1 ? `<div class="card"><div class="card-title">${icon('gauge')} Kilometraje · ${num(kmPerDay(v, store.settings.kmPerDay), 0)} km/día</div><div class="mt">${kmChart(v)}</div></div>` : ''}
          <div class="card"><div class="card-title">${icon('info')} Datos</div><div class="kv-grid mt">
            <div class="kv"><span>Aceite</span><b>${esc(v.oil || '—')}</b></div>
            <div class="kv"><span>Cauchos</span><b>${esc(v.tires || '—')}</b></div>
            <div class="kv"><span>Próxima revisión</span><b>${v.nextControl ? fmtDate(v.nextControl) : '—'}</b></div>
            <div class="kv"><span>Seguro</span><b>${esc(v.insurance || '—')}</b></div>
            ${v.notes ? `<div class="kv kv-1"><span>Notas</span><b>${esc(v.notes)}</b></div>` : ''}
          </div></div>
          <div class="card center">${qr ? `<img src="${qr}" class="qr-img" alt="QR">` : ''}<div class="mono small mt-xs">${esc(v.cardCode || '')}</div><div class="small muted">Ficha digital del vehículo</div><button class="btn btn-secondary btn-sm mt" data-card>${icon('whatsapp')} Enviar ficha</button></div>
        </div></div>`;
      bindDue(body); bindJobs(body);
      body.querySelector('[data-am]').onclick = () => action('maint');
      body.querySelector('[data-allj]').onclick = () => { tab = 'ordenes'; draw(); };
      body.querySelector('[data-card]').onclick = () => waClient('tarjeta', { client: owner(), vehicle: v });
    },
    async ordenes(body) {
      const list = await load('jobs', () => store.vehicleJobs(v.id));
      body.innerHTML = `<div class="between"><div class="small muted">${list.length} orden(es)</div>${store.jobOfVehicle(v.id) ? '' : `<button class="btn btn-primary btn-sm" data-new>${icon('plus')} Recibir en el taller</button>`}</div>
        ${list.length ? `<div class="hc mt">${list.map(jobRow).join('')}</div>` : emptyState('wrench', 'Sin órdenes de trabajo', 'Cada orden guarda lo que pidió el cliente, la inspección de ingreso, el presupuesto y lo que se hizo.')}`;
      body.querySelector('[data-new]')?.addEventListener('click', () => action('receive'));
      bindJobs(body);
    },
    async mantenimiento(body) {
      const list = (v.services || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const last = latestBy(v.services || []);
      body.innerHTML = `<div class="between"><div class="small muted">${list.length} registro(s)</div><div class="row" style="gap:6px"><button class="btn btn-secondary btn-sm" data-pr>${icon('print')} Imprimir</button><button class="btn btn-primary btn-sm" data-new>${icon('droplet')} Registrar</button></div></div>
        ${list.length ? `<div class="table-wrap mt"><table class="table"><thead><tr><th>Servicio</th><th>Fecha</th><th class="r">Km</th><th>Próximo</th><th class="hide-sm">Orden</th><th></th></tr></thead><tbody>${list.map((s) => { const isLast = last.some((x) => x.id === s.id); const it = isLast ? store.dueFor(v).find((d) => d.id === s.id) : null; return `<tr><td><b>${esc(s.name)}</b>${s.note ? `<div class="t-sub">${esc(s.note)}</div>` : ''}</td><td>${fmtDate(s.date)}</td><td class="r num">${s.km ? num(s.km, 0) : '—'}</td><td>${[s.nextKm ? num(s.nextKm, 0) + ' km' : '', s.next ? fmtDate(s.next) : ''].filter(Boolean).join(' o ') || '—'} ${it ? `<span class="badge badge-${dueTone(it)}">${dueText(it)}</span>` : ''}</td><td class="hide-sm small">${esc(s.jobNumber || '')}</td><td class="r"><button class="btn btn-ghost btn-icon btn-sm" data-es="${s.id}">${icon('edit')}</button></td></tr>`; }).join('')}</tbody></table></div>` : emptyState('droplet', 'Sin mantenimientos registrados', 'Registra también los que le hicieron en otro taller para que el plan quede completo.')}`;
      body.querySelector('[data-new]').onclick = () => action('maint');
      body.querySelector('[data-pr]').onclick = () => printCard(v);
      body.querySelectorAll('[data-es]').forEach((b) => b.onclick = async () => { if (await serviceForm(v, (v.services || []).find((x) => x.id === b.dataset.es))) draw(); });
    },
    async citas(body) {
      const list = await load('appts', () => store.vehicleAppts(v.id));
      body.innerHTML = `<div class="between"><div class="small muted">${list.length} cita(s)</div><button class="btn btn-primary btn-sm" data-new>${icon('calendar')} Agendar cita</button></div>
        ${list.length ? `<div class="list mt">${list.map((a) => `<div class="list-item"><span class="kpi-icon" style="width:38px;height:38px;background:${SERVICES[a.service]?.color || '#2563eb'}22;color:${SERVICES[a.service]?.color || '#2563eb'}">${icon(SERVICES[a.service]?.icon || 'calendar')}</span><div class="grow"><b>${fmtDate(a.date)} · ${esc(a.time || '')}</b><div class="t-sub">${esc(SERVICES[a.service]?.label || a.service || '')}${a.staffName ? ' · ' + esc(a.staffName) : ''}${a.note ? ' · ' + esc(a.note) : ''}</div></div>${apptBadge(a.status)}</div>`).join('')}</div>` : emptyState('calendar', 'Sin citas')}`;
      body.querySelector('[data-new]').onclick = () => action('appt');
    },
    async compras(body) {
      const sales = await load('sales', () => store.vehicleSales(v.id));
      body.innerHTML = sales.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Documento</th><th>Fecha</th><th>Detalle</th><th class="r">Total</th><th></th></tr></thead><tbody>${sales.map((s) => `<tr style="${s.status === 'voided' ? 'opacity:.5' : ''}"><td><b>${esc(s.number)}</b>${s.status === 'voided' ? ' <span class="badge badge-danger">Anulado</span>' : ''}</td><td class="small">${fmtDateTime(s.date)}</td><td class="small">${(s.items || []).map((i) => esc(i.name)).join(', ')}</td><td class="r num"><b>${usd(s.total)}</b></td><td class="r"><button class="btn btn-ghost btn-icon btn-sm" data-pr="${s.id}">${icon('print')}</button></td></tr>`).join('')}</tbody></table></div>`
        : emptyState('receipt', 'Sin pagos asociados', 'Las órdenes cobradas y las compras de este vehículo aparecen aquí.');
      body.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => printReceipt(sales.find((s) => s.id === b.dataset.pr)));
    }
  };
  root.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  header(); draw();
}

export function waMenu(v) {
  const o = store.client(v.ownerId);
  const due = store.dueFor(v).filter((x) => x.late || x.soon || x.urgency <= 30);
  const job = store.jobOfVehicle(v.id);
  const opts = [
    ...due.map((it, i) => [`due:${i}`, `Mantenimiento: ${it.name}`, dueText(it)]),
    ...(job ? [['estado', `Estado de la orden ${job.number}`, JOB_STATUS[job.status]?.label || '']] : []),
    ...(v.nextControl ? [['control', 'Recordar su revisión', fmtDate(v.nextControl)]] : []),
    ['tarjeta', 'Enviar la ficha del vehículo', 'Enlace con QR'],
    ...(store.settings.shop?.enabled !== false && store.settings.shop?.slug ? [['catalogo', 'Enlace para pedir repuestos', 'Catálogo en línea']] : []),
    ...((Number(o?.balance) || 0) > 0.009 ? [['deuda', 'Recordar saldo pendiente', usd(o.balance)]] : []),
    ['libre', 'Mensaje libre', 'Escribe lo que quieras']
  ];
  const m = openModal({
    title: 'WhatsApp', sub: `${esc(o?.name || v.ownerName || '')} · ${esc(v.plate)}`, size: 'sm',
    body: `<div class="list">${opts.map(([k, t, s]) => `<button class="list-item" data-k="${esc(k)}">${icon('whatsapp')}<div class="grow"><b>${esc(t)}</b><div class="t-sub">${esc(s)}</div></div></button>`).join('')}</div>`,
    footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
  });
  m.el.querySelectorAll('[data-k]').forEach((b) => b.onclick = async () => {
    const k = b.dataset.k; m.close();
    if (k.startsWith('due:')) { const it = due[+k.slice(4)]; waClient('mantenimiento', { client: o, vehicle: v, item: it }); markReminded(v, `${it.name}:${it.nextKm || it.next}`); return; }
    if (k === 'estado') { waClient('estado', { client: o, vehicle: v, job }); return; }
    if (k === 'libre') { const t = await promptDialog({ title: 'Mensaje', label: 'Texto', value: '', confirmText: 'Abrir WhatsApp' }); if (t) waClient('libre', { client: o, vehicle: v, extra: t }); return; }
    waClient(k, { client: o, vehicle: v });
  });
}

// ======================================================================
// FICHA DEL CLIENTE
// ======================================================================
const TTABS = { vehiculos: 'Vehículos', compras: 'Pagos', datos: 'Datos' };
export async function openClient(id, { tab: tab0 = 'vehiculos' } = {}) {
  let cl = store.client(id) || await store.getClient(id);
  if (!cl) { toast('Cliente no encontrado', 'warning'); return; }
  let tab = tab0;
  const cache = {};
  const m = openModal({ title: '', size: 'xl', body: '<div data-root></div>' });
  m.el.querySelector('.modal')?.classList.add('member-modal');
  const root = m.el.querySelector('[data-root]');
  const refresh = () => { const n = store.client(id); if (n) { cl = n; header(); if (tab !== 'compras') draw(); } };
  const offs = [store.on('clients', refresh), store.on('vehicles', refresh)];
  const close0 = m.close; m.close = () => { offs.forEach((f) => f()); close0(); };
  root.innerHTML = `<div data-head></div><div class="tabs mt" data-tabs>${Object.entries(TTABS).map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('')}</div><div data-body class="mt"></div>`;
  const $ = (q) => root.querySelector(q);

  function header() {
    const bal = Number(cl.balance) || 0;
    const ag = cl.agreementId ? store.agreement(cl.agreementId) : null;
    $('[data-head]').innerHTML = `<div class="mhead">${avatar(cl, 'avatar-xl')}
      <div class="grow" style="min-width:0">
        <div class="row row-wrap"><h2 class="mhead-name">${esc(cl.name)}</h2>${clientBadge(store.clientStatus(cl))}${bal > 0.009 ? `<span class="badge badge-danger">Debe ${usd(bal)}</span>` : ''}${pointsHTML(cl)}${ag ? `<span class="badge badge-info">${icon('handshake')} ${esc(ag.name)}</span>` : ''}</div>
        <div class="t-sub">${esc(cl.number)}${cl.company ? ` · ${esc(cl.company)}` : ''}${cl.idDoc ? ` · ${esc(loc().id)} ${esc(cl.idDoc)}` : ''}${cl.phone ? ` · ${esc(cl.phone)}` : ''}${cl.address ? ` · ${esc(cl.address)}` : ''}</div>
        <div class="small mt-xs">${clientLine(cl)}</div>
      </div><button class="x-btn" data-x aria-label="Cerrar">${icon('x')}</button></div>
    <div class="mactions">
      <button class="btn btn-primary" data-a="veh">${icon('plus')} Vehículo</button>
      <button class="btn btn-secondary" data-a="sell">${icon('cart')} Vender</button>
      ${bal > 0.009 ? `<button class="btn btn-secondary" data-a="debt">${icon('dollar')} Cobrar saldo</button>` : ''}
      ${cl.phone ? `<button class="btn btn-whatsapp" data-a="wa">${icon('whatsapp')} WhatsApp</button>` : ''}
      <button class="btn btn-ghost" data-a="edit">${icon('edit')} Editar</button>
      <button class="btn btn-ghost btn-icon" data-a="more" title="Más opciones">${icon('menu')}</button>
    </div>`;
    $('[data-x]').onclick = () => m.close();
    root.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => action(b.dataset.a));
  }
  async function action(a) {
    if (a === 'veh') { const r = await vehicleForm(null, { owner: cl }); if (r) { tab = 'vehiculos'; draw(); } }
    if (a === 'sell') { m.close(); nav('vender', { clientId: cl.id }); }
    if (a === 'debt') { await payDebtModal(cl); cache.sales = null; draw(); }
    if (a === 'wa') { const t = await promptDialog({ title: 'WhatsApp', label: `Mensaje para ${cl.name.split(' ')[0]}`, value: '', confirmText: 'Abrir WhatsApp' }); if (t != null) waClient('libre', { client: cl, extra: t }); }
    if (a === 'edit') { const r = await clientForm(cl); if (r) { cl = { ...cl, ...r }; header(); draw(); } }
    if (a === 'more') {
      const mm = openModal({ title: 'Más opciones', sub: esc(cl.name), size: 'sm', body: `<div class="list">
        ${store.loyalty?.enabled ? `<button class="list-item" data-o="pts">${icon('star')}<div class="grow"><b>Ajustar puntos</b><div class="t-sub">Cortesía o corrección (PIN)</div></div></button>` : ''}
        <button class="list-item" data-o="baja">${icon(cl.active === false ? 'unlock' : 'x')}<div class="grow"><b>${cl.active === false ? 'Reactivar cliente' : 'Dar de baja'}</b><div class="t-sub">Se conserva su historial</div></div></button></div>`, footer: '<button class="btn btn-secondary" data-close>Cerrar</button>' });
      mm.el.querySelector('[data-o="pts"]')?.addEventListener('click', async () => {
        mm.close(); if (!(await requirePin('Ajustar puntos'))) return;
        const f = openModal({ title: 'Puntos', sub: esc(cl.name), size: 'sm', body: `<div class="form-grid"><div class="field"><label>Puntos</label><input class="input" type="number" min="0" data-p value="${Math.floor(Number(cl.points) || 0)}"></div><div class="field full"><label>Motivo</label><input class="input" data-why placeholder="Ej.: cortesía"></div></div>`, footer: '<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>' });
        f.el.querySelector('[data-ok]').onclick = async () => { await adjustPoints(cl, f.el.querySelector('[data-p]').value, f.el.querySelector('[data-why]').value); f.close(); toast('Puntos actualizados'); };
      });
      mm.el.querySelector('[data-o="baja"]').onclick = async () => {
        mm.close();
        if (cl.active === false) { await setClientActive(cl, true); toast('Cliente reactivado'); return; }
        if (await confirmDialog({ title: 'Dar de baja', message: `${esc(cl.name)} dejará de aparecer en la lista. Su historial se conserva.`, confirmText: 'Dar de baja', danger: true })) { await setClientActive(cl, false); toast('Cliente dado de baja', 'warning'); }
      };
    }
  }
  async function draw() {
    root.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    const body = $('[data-body]');
    if (tab === 'vehiculos') {
      const vs = store.vehicles.filter((p) => p.ownerId === cl.id);
      body.innerHTML = vs.length ? `<div class="pet-cards">${vs.map((p) => `<button class="pet-card ${p.active === false ? 'is-off' : ''}" data-p="${p.id}">${vehAvatar(p, 'avatar-lg')}<div class="grow" style="min-width:0"><div class="row" style="gap:6px">${plateHTML(p.plate, 'plate-sm')}<b class="ellipsis">${esc(vehicleName(p))}</b></div><div class="t-sub ellipsis">${esc([p.color, p.km ? num(p.km, 0) + ' km' : ''].filter(Boolean).join(' · '))}</div><div class="mt-xs">${p.active === false ? '' : inShopBadge(p) || dueBadge(p)}</div></div>${icon('chevronRight')}</button>`).join('')}</div>`
        : emptyState('car', 'Sin vehículos', 'Registra su primer vehículo con el botón “Vehículo”.');
      body.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { m.close(); openVehicle(b.dataset.p); });
    }
    if (tab === 'compras') {
      body.innerHTML = '<div class="empty"><div class="spinner"></div></div>';
      const sales = (cache.sales ??= await store.clientSales(cl.id).catch(() => []));
      body.innerHTML = sales.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Documento</th><th>Fecha</th><th>Detalle</th><th class="r">Total</th><th></th></tr></thead><tbody>${sales.map((s) => `<tr style="${s.status === 'voided' ? 'opacity:.5' : ''}"><td><b>${esc(s.number)}</b>${s.status === 'voided' ? ' <span class="badge badge-danger">Anulado</span>' : ''}${s.plate ? `<div class="t-sub">${esc(s.plate)}</div>` : ''}</td><td class="small">${fmtDateTime(s.date)}</td><td class="small">${(s.items || []).map((i) => esc(i.name)).join(', ')}</td><td class="r num"><b>${usd(s.total)}</b>${s.credit ? `<div class="t-sub text-danger">pendiente ${usd(s.credit)}</div>` : ''}</td><td class="r"><button class="btn btn-ghost btn-icon btn-sm" data-pr="${s.id}">${icon('print')}</button></td></tr>`).join('')}</tbody></table></div>`
        : emptyState('receipt', 'Sin pagos registrados');
      body.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => printReceipt(sales.find((s) => s.id === b.dataset.pr)));
    }
    if (tab === 'datos') {
      body.innerHTML = `<div class="card"><div class="kv-grid">
        <div class="kv"><span>Teléfono</span><b>${esc(cl.phone || '—')}</b></div><div class="kv"><span>Otro teléfono</span><b>${esc(cl.phone2 || '—')}</b></div>
        <div class="kv"><span>${esc(loc().id)}</span><b>${esc(cl.idDoc || '—')}</b></div><div class="kv"><span>Correo</span><b>${esc(cl.email || '—')}</b></div>
        <div class="kv"><span>Visitas</span><b>${cl.visits || 0}</b></div><div class="kv"><span>Gasto total</span><b>${usd(cl.totalSpent || 0)}</b></div>
        <div class="kv"><span>Cliente desde</span><b>${fmtDate(cl.createdAt)}</b></div><div class="kv"><span>Nos conoció por</span><b>${esc(cl.howFound || '—')}</b></div>
        <div class="kv kv-1"><span>Dirección</span><b>${esc(cl.address || '—')}</b></div>${cl.notes ? `<div class="kv kv-1"><span>Notas</span><b>${esc(cl.notes)}</b></div>` : ''}</div></div>`;
    }
  }
  root.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  header(); draw();
}

// ======================================================================
// SALDO, FICHA PÚBLICA E IMPRESIÓN
// ======================================================================
export async function payDebtModal(cl) {
  const { openPay, showPaid } = await import('./pay.js');
  const bal = Number(cl.balance) || 0;
  const out = await openPay({ title: 'Cobrar saldo pendiente', sub: esc(cl.name), amount: bal, editable: true, max: bal, onConfirm: async (r) => { const res = await payBalance(cl, { amount: r.amount, payments: r.payments }); if (r.print) printReceipt(res.sale); return res; } });
  if (out) showPaid(out.sale, { title: 'Abono registrado', onPrint: () => printReceipt(out.sale) });
}
export async function cardModal(v) {
  const qr = await qrDataURL(cardUrl(v.cardCode), 5);
  const m = openModal({
    title: 'Ficha digital del vehículo', sub: `${esc(v.plate)} · ${esc(vehicleName(v))}`, size: 'sm',
    body: `<div class="center stack" style="align-items:center"><img src="${qr}" class="qr-img lg" alt="QR"><div class="mono small">${esc(v.cardCode)}</div>
      <div class="small muted">El cliente abre el enlace en su teléfono y ve su próximo cambio de aceite, el historial de servicios y, si el carro está en el taller, en qué va. En recepción, escanea el QR para abrir la ficha al instante.</div></div>`,
    footer: `<button class="btn btn-secondary" data-copy>${icon('copy')} Copiar</button><button class="btn btn-secondary" data-pr>${icon('print')} Imprimir</button><button class="btn btn-whatsapp" data-wa>${icon('whatsapp')} Enviar</button>`
  });
  m.el.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(cardUrl(v.cardCode)); toast('Enlace copiado'); } catch (_) { toast(cardUrl(v.cardCode), 'info', 6000); } };
  m.el.querySelector('[data-pr]').onclick = () => printCard(v);
  m.el.querySelector('[data-wa]').onclick = () => waClient('tarjeta', { client: store.client(v.ownerId), vehicle: v });
}
export const docHead = (title) => {
  const s = store.settings;
  return `<div class="hd"><div><div class="biz">${esc(store.businessName)}</div><div class="sm">${[s.address, s.phone && 'Tel. ' + s.phone, s.rif && loc().tax + ' ' + s.rif].filter(Boolean).map(esc).join(' · ')}</div></div><div class="ttl">${esc(title)}</div></div>`;
};
export const DOC_CSS = `@page { margin: 14mm; } body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12.5px; }
  .hd { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #1d4ed8; padding-bottom: 8px; margin-bottom: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .biz { font-size: 18px; font-weight: 800; } .ttl { font-size: 16px; font-weight: 800; color: #1d4ed8; text-transform: uppercase; letter-spacing: .04em; } .sm { font-size: 11px; color: #555; }
  .box { border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; margin: 8px 0; } .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 14px; }
  .k { color: #666; font-size: 10.5px; text-transform: uppercase; } table { width: 100%; border-collapse: collapse; } th { text-align: left; background: #e8eefc; padding: 6px; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; } td { padding: 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; } h3 { font-size: 13px; margin: 14px 0 4px; color: #1d4ed8; } .sign { margin-top: 48px; display: flex; gap: 40px; justify-content: space-between; } .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; font-size: 11px; }
  .plate { display: inline-block; border: 2px solid #111; border-radius: 6px; padding: 1px 8px; font-family: monospace; font-weight: 800; letter-spacing: .08em; }`;
export const vehBox = (v, extra = {}) => `<div class="box grid">
  <div><div class="k">Placa</div><span class="plate">${esc(v?.plate || extra.plate || '')}</span></div>
  <div><div class="k">Vehículo</div><b>${esc(vehicleName(v || {}) !== 'Vehículo' ? vehicleName(v) : extra.vehicleName || '')}</b></div>
  <div><div class="k">Color / tipo</div>${esc([v?.color, vtypeOf(v).label].filter(Boolean).join(' · '))}</div>
  <div><div class="k">Kilometraje</div>${extra.km || v?.km ? num(extra.km || v.km, 0) + ' km' : '—'}</div>
  <div><div class="k">Cliente</div>${esc(extra.ownerName || v?.ownerName || '')}${extra.phone ? ` · ${esc(extra.phone)}` : ''}</div>
  <div><div class="k">Fecha</div>${fmtDate(extra.date || todayKey())}</div></div>`;
/** Historial de mantenimiento impreso (carta) con QR a la ficha digital */
export async function printCard(v0) {
  const v = store.vehicle(v0.id) || v0;
  const qr = await qrDataURL(cardUrl(v.cardCode), 5);
  const sv = (v.services || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const due = store.dueFor(v);
  printHTML(`<!DOCTYPE html><html><head>${PRINT_HEAD}<title>Mantenimiento ${esc(v.plate)}</title><style>${DOC_CSS}
    .top { display: flex; gap: 16px; align-items: center; } .top img.qr { width: 110px; height: 110px; }</style></head><body>
    ${docHead('Historial de mantenimiento')}
    <div class="top"><div style="flex:1">${vehBox(v, { ownerName: v.ownerName, date: todayKey() })}</div><img class="qr" src="${qr}"></div>
    <h3>Próximos servicios</h3><table><thead><tr><th>Servicio</th><th>Último</th><th>Próximo</th><th>Estado</th></tr></thead><tbody>${due.map((it) => `<tr><td><b>${esc(it.name)}</b></td><td>${fmtDate(it.date)}${it.km ? ` · ${num(it.km, 0)} km` : ''}</td><td>${[it.nextKm ? num(it.nextKm, 0) + ' km' : '', it.next ? fmtDate(it.next) : ''].filter(Boolean).join(' o ')}</td><td>${esc(dueText(it))}</td></tr>`).join('') || '<tr><td colspan="4">Sin plan registrado</td></tr>'}</tbody></table>
    <h3>Servicios realizados</h3><table><thead><tr><th>Fecha</th><th>Servicio</th><th class="r">Km</th><th>Orden</th><th>Nota</th></tr></thead><tbody>${sv.map((s) => `<tr><td>${fmtDate(s.date)}</td><td><b>${esc(s.name)}</b></td><td class="r">${s.km ? num(s.km, 0) : ''}</td><td>${esc(s.jobNumber || '')}</td><td>${esc(s.note || '')}</td></tr>`).join('') || '<tr><td colspan="5">Sin registros</td></tr>'}${'<tr><td style="height:26px"></td><td></td><td></td><td></td><td></td></tr>'.repeat(4)}</tbody></table>
    <p class="sm" style="margin-top:14px">Escanea el código QR para ver la ficha digital siempre actualizada · ${esc(v.cardCode || '')} · SanoTaller</p></body></html>`);
}
