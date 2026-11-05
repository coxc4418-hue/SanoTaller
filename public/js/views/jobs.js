// SanoTaller — Órdenes de trabajo: tablero del taller, recepción con inspección, presupuesto con aprobación del cliente, reparación, entrega y garantía
import { store } from '../store.js';
import { esc, usd, bs, fx, num, emptyState, openModal, toast, setBusy, fmtDate, fmtDateTime, fmtTime, fmtAgo, todayKey, dayKey, addDays, parseNum, promptDialog, confirmDialog, compressImage, printHTML, normalize } from '../utils.js';
import { icon } from '../icons.js';
import {
  JOB_STATUS, JOB_TYPES, BOARD, jobBadge, FUEL_LEVELS, CHECK_ITEMS, CHECK_STATE, BELONGINGS, ZONES, DAMAGE, COMPLAINTS, LINE_KINDS, jobTotals, vehicleName, vtypeOf, packFactor
} from '../taller.js';
import { openJob as openJobOp, saveJob, setJobStatus, addJobNote, sendQuote, applyDecision, deliverJob, cancelJob, quoteUrl, syncQuotes } from '../ops.js';
import { vehAvatar, plateHTML, pickVehicle, pickProduct, openVehicle, openClient, docHead, DOC_CSS, vehBox } from '../client.js';
import { waClient, PRINT_HEAD } from '../shared.js';

const nav = async (route, params = {}) => { const { navigate } = await import('../main.js'); navigate(route, { params, force: true }); };
const inDays = (n) => dayKey(addDays(new Date(), n));

// ======================================================================
// RECEPCIÓN DEL VEHÍCULO (abre la orden)
// ======================================================================
/** Diagrama de la carrocería visto desde arriba: se toca una zona para marcar el daño */
function bodyDiagram(damages) {
  const z = (k) => damages.some((d) => d.zone === k) ? 'on' : '';
  return `<svg class="car-diagram" viewBox="0 0 220 300" role="img" aria-label="Diagrama del vehículo">
    <rect x="40" y="10" width="140" height="280" rx="46" class="car-body"/>
    <g data-zone="frente" class="zone ${z('frente')}"><rect x="52" y="14" width="116" height="26" rx="12"/><text x="110" y="31">Frente</text></g>
    <g data-zone="capo" class="zone ${z('capo')}"><rect x="56" y="44" width="108" height="50" rx="8"/><text x="110" y="73">Capó</text></g>
    <g data-zone="parabrisas" class="zone ${z('parabrisas')}"><rect x="62" y="98" width="96" height="22" rx="6"/><text x="110" y="113">Parabrisas</text></g>
    <g data-zone="techo" class="zone ${z('techo')}"><rect x="64" y="124" width="92" height="66" rx="8"/><text x="110" y="161">Techo</text></g>
    <g data-zone="maleta" class="zone ${z('maleta')}"><rect x="56" y="194" width="108" height="56" rx="8"/><text x="110" y="226">Maleta</text></g>
    <g data-zone="trasero" class="zone ${z('trasero')}"><rect x="52" y="254" width="116" height="30" rx="12"/><text x="110" y="273">Atrás</text></g>
    <g data-zone="izq_del" class="zone ${z('izq_del')}"><rect x="8" y="50" width="34" height="96" rx="8"/><text x="25" y="101">Izq</text></g>
    <g data-zone="izq_tras" class="zone ${z('izq_tras')}"><rect x="8" y="152" width="34" height="96" rx="8"/><text x="25" y="203">Izq</text></g>
    <g data-zone="der_del" class="zone ${z('der_del')}"><rect x="178" y="50" width="34" height="96" rx="8"/><text x="195" y="101">Der</text></g>
    <g data-zone="der_tras" class="zone ${z('der_tras')}"><rect x="178" y="152" width="34" height="96" rx="8"/><text x="195" y="203">Der</text></g>
  </svg>`;
}
export function receiveForm(vehicle0 = null, { appt = null } = {}) {
  return new Promise((resolve) => {
    let saved = null; let v = vehicle0;
    let type = appt?.service && JOB_TYPES[appt.service] ? appt.service : appt?.service === 'cauchos' ? 'cauchos' : 'reparacion';
    let fuel = '';
    const checks = {}; const belongings = new Set(); const damages = []; const photos = [];
    const m = openModal({
      title: 'Recibir vehículo', sub: 'Abre la orden de trabajo con la inspección de ingreso. Lo esencial: vehículo, kilometraje y lo que pide el cliente.', size: 'xl',
      body: `<div class="consult">
        <div class="consult-grid">
          <div class="stack">
            <div data-veh></div>
            <div class="chips chips-wrap" data-type>${Object.entries(JOB_TYPES).map(([k, t]) => `<button type="button" class="chip ${k === type ? 'on' : ''}" data-v="${k}">${icon(t.icon)} ${t.label}</button>`).join('')}</div>
            <div class="field"><label>¿Qué pide o reporta el cliente? *</label><textarea class="input" rows="2" data-c placeholder="Ej.: cambio de aceite y revisar ruido al frenar">${esc(appt?.note || '')}</textarea>
              <div class="chips chips-wrap mt-xs" data-cq>${COMPLAINTS.map((c) => `<button type="button" class="chip chip-sm" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>
            <div class="form-grid">
              <div class="field"><label>Kilometraje de entrada</label><div class="input-group"><input class="input" data-km inputmode="numeric"><span class="suffix">km</span></div></div>
              <div class="field"><label>Mecánico</label><select class="select" data-mech><option value="">Sin asignar</option>${store.mechanics.map((s) => `<option value="${s.id}" ${appt?.staffId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
              <div class="field"><label>Prometido para</label><input class="input" type="date" data-pr value="${todayKey()}"><div class="chips mt-xs">${[[0, 'Hoy'], [1, 'Mañana'], [2, '2 días'], [5, '5 días']].map(([d, l]) => `<button type="button" class="chip chip-sm" data-pd="${d}">${l}</button>`).join('')}</div></div>
              <div class="field"><label>Combustible</label><div class="seg seg-block fuel-seg" data-fuel>${FUEL_LEVELS.map((f) => `<button type="button" data-v="${f}">${f}</button>`).join('')}</div></div>
            </div>
            <div class="section-title">${icon('clipboard')} Inspección de ingreso <span class="t-sub">(toca para cambiar: bien → revisar → mal)</span></div>
            <div class="check-grid" data-checks>${CHECK_ITEMS.map((c) => `<button type="button" class="check-item" data-ck="${esc(c)}"><span>${esc(c)}</span><b data-st>—</b></button>`).join('')}</div>
            <div class="section-title">${icon('box')} Lo que trae el vehículo</div>
            <div class="chips chips-wrap" data-bel>${BELONGINGS.map((c) => `<button type="button" class="chip chip-sm" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>
          </div>
          <div class="stack">
            <div class="section-title">${icon('car')} Daños de la carrocería <span class="t-sub">(toca la zona)</span></div>
            <div class="diagram-wrap" data-diag>${bodyDiagram(damages)}</div>
            <div data-dmg></div>
            <div class="section-title">${icon('camera')} Fotos de ingreso <span class="t-sub">(hasta 4)</span></div>
            <div class="photo-row" data-photos></div>
            <div class="field"><label>Notas internas</label><input class="input" data-n placeholder="Ej.: dejó la llave de seguridad de los rines"></div>
          </div>
        </div>
        <div class="error-msg" data-err></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('wrench')} Abrir orden</button>`,
      onClose: () => resolve(saved)
    });
    m.el.querySelector('.modal')?.classList.add('consult-modal');
    const q = (s) => m.el.querySelector(s);
    const drawVeh = () => {
      q('[data-veh]').innerHTML = v ? `<div class="list-item box">${vehAvatar(v)}<div class="grow" style="min-width:0"><div class="row" style="gap:6px">${plateHTML(v.plate, 'plate-sm')}<b class="ellipsis">${esc(vehicleName(v))}</b></div><div class="t-sub">${esc(v.color || '')}${v.km ? ` · último ${num(v.km, 0)} km` : ''} · ${esc(v.ownerName || '')}${v.ownerPhone ? ' · ' + esc(v.ownerPhone) : ''}</div></div><button type="button" class="btn btn-ghost btn-sm" data-chg>${icon('refresh')}</button></div>`
        : `<button type="button" class="btn btn-secondary btn-block btn-lg" data-chg>${icon('search')} Elegir vehículo (placa)</button>`;
      q('[data-chg]').onclick = async () => { const p = await pickVehicle({ title: 'Vehículo que entra' }); if (p) { v = p; drawVeh(); if (p.km && !q('[data-km]').value) q('[data-km]').placeholder = `último ${num(p.km, 0)}`; } };
      if (v?.km) q('[data-km]').placeholder = `último ${num(v.km, 0)}`;
    };
    drawVeh();
    const one = (sel, cb) => m.el.querySelectorAll(`${sel} [data-v]`).forEach((b) => b.onclick = () => { m.el.querySelectorAll(`${sel} [data-v]`).forEach((y) => y.classList.toggle('on', y === b)); cb(b.dataset.v); });
    one('[data-type]', (x) => { type = x; });
    one('[data-fuel]', (x) => { fuel = x; });
    m.el.querySelectorAll('[data-cq] [data-v]').forEach((b) => b.onclick = () => { const t = q('[data-c]'); const cur = t.value.trim(); t.value = cur ? `${cur}; ${b.dataset.v.toLowerCase()}` : b.dataset.v; });
    m.el.querySelectorAll('[data-pd]').forEach((b) => b.onclick = () => { q('[data-pr]').value = inDays(Number(b.dataset.pd)); });
    const cycle = ['ok', 'obs', 'mal', ''];
    m.el.querySelectorAll('[data-ck]').forEach((b) => b.onclick = () => {
      const k = b.dataset.ck; const nx = cycle[(cycle.indexOf(checks[k] || '') + 1) % cycle.length];
      if (nx) checks[k] = nx; else delete checks[k];
      b.className = `check-item ${nx ? 'st-' + nx : ''}`; b.querySelector('[data-st]').textContent = nx ? CHECK_STATE[nx].label : '—';
    });
    m.el.querySelectorAll('[data-bel] [data-v]').forEach((b) => b.onclick = () => { const x = b.dataset.v; belongings.has(x) ? belongings.delete(x) : belongings.add(x); b.classList.toggle('on', belongings.has(x)); });
    const drawDmg = () => {
      q('[data-diag]').innerHTML = bodyDiagram(damages);
      q('[data-dmg]').innerHTML = damages.length ? `<div class="list">${damages.map((d, i) => `<div class="list-item small"><span class="badge badge-danger">${esc(DAMAGE[d.kind] || d.kind)}</span><div class="grow">${esc(ZONES[d.zone] || d.zone)}${d.note ? ` · ${esc(d.note)}` : ''}</div><button type="button" class="btn btn-ghost btn-icon btn-sm" data-dd="${i}">${icon('x')}</button></div>`).join('')}</div>` : '<div class="small muted">Sin daños marcados.</div>';
      m.el.querySelectorAll('[data-dd]').forEach((b) => b.onclick = () => { damages.splice(+b.dataset.dd, 1); drawDmg(); });
      m.el.querySelectorAll('[data-zone]').forEach((g) => g.onclick = () => {
        const zone = g.dataset.zone;
        const mm = openModal({ title: ZONES[zone], size: 'sm', body: `<div class="stack"><div class="chips chips-wrap">${Object.entries(DAMAGE).map(([k, l]) => `<button type="button" class="chip" data-k="${k}">${l}</button>`).join('')}</div><input class="input" data-dn placeholder="Detalle (opcional)"></div>`, footer: '<button class="btn btn-secondary" data-close>Cancelar</button>' });
        mm.el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { damages.push({ zone, kind: b.dataset.k, note: mm.el.querySelector('[data-dn]').value.trim() }); mm.close(); drawDmg(); });
      });
    };
    const drawPhotos = () => {
      q('[data-photos]').innerHTML = photos.map((p, i) => `<span class="photo-th"><img src="${p}" alt=""><button type="button" data-xp="${i}" aria-label="Quitar">${icon('x')}</button></span>`).join('') + (photos.length < 4 ? `<label class="photo-add">${icon('camera')}<input type="file" accept="image/*" capture="environment" data-ph hidden></label>` : '');
      m.el.querySelectorAll('[data-xp]').forEach((b) => b.onclick = () => { photos.splice(+b.dataset.xp, 1); drawPhotos(); });
      q('[data-ph]')?.addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; try { photos.push(await compressImage(f, 520, 0.66)); drawPhotos(); } catch (_) { toast('No se pudo leer la foto', 'warning'); } });
    };
    drawDmg(); drawPhotos();
    q('[data-ok]').onclick = async (e) => {
      const err = q('[data-err]'); err.textContent = '';
      if (!v) { err.textContent = 'Elige el vehículo.'; return; }
      if (!q('[data-c]').value.trim()) { err.textContent = 'Escribe lo que pide o reporta el cliente.'; q('[data-c]').focus(); return; }
      const km = parseNum(q('[data-km]').value);
      if (km && v.km && km < Number(v.km) && !(await confirmDialog({ title: 'Kilometraje menor', message: `La última lectura fue ${num(v.km, 0)} km. ¿Seguro que marca ${num(km, 0)} km?`, confirmText: 'Sí, continuar' }))) return;
      setBusy(e.currentTarget, true, 'Abriendo orden…');
      try {
        saved = await openJobOp({ vehicleId: v.id, type, complaint: q('[data-c]').value, km, fuel, checks, belongings: [...belongings], damages, photos, mechanicId: q('[data-mech]').value || null, promisedAt: q('[data-pr]').value, apptId: appt?.id || null, notes: q('[data-n]').value });
        m.close(); toast(`Orden ${saved.number} abierta: ${v.plate}`);
        if (v.ownerPhone) {
          const c = openModal({ title: `Orden ${saved.number} abierta`, size: 'sm', body: '<p class="small">¿Le avisas al cliente que recibiste el vehículo? Le llega el enlace para seguir el estado desde su teléfono.</p>', footer: `<button class="btn btn-secondary" data-close>Ahora no</button><button class="btn btn-secondary" data-p>${icon('print')} Orden</button><button class="btn btn-whatsapp" data-w>${icon('whatsapp')} Avisar</button>` });
          c.el.querySelector('[data-w]').onclick = () => { waClient('recibido', { client: store.client(v.ownerId), vehicle: v, job: saved }); c.close(); };
          c.el.querySelector('[data-p]').onclick = () => { printJob(saved, 'orden'); c.close(); };
        }
      } catch (ex) { err.textContent = ex.message; setBusy(e.currentTarget, false); }
    };
  });
}

// ======================================================================
// DETALLE DE LA ORDEN
// ======================================================================
const NEXT = {
  recibido: [['diagnostico', 'Iniciar diagnóstico']],
  diagnostico: [['quote', 'Enviar presupuesto'], ['reparacion', 'Reparar sin presupuesto']],
  presupuesto: [['approve', 'Aprobado de palabra'], ['resend', 'Reenviar presupuesto']],
  aprobado: [['reparacion', 'Iniciar reparación']],
  reparacion: [['listo', 'Marcar listo'], ['repuesto', 'Esperando repuesto']],
  repuesto: [['reparacion', 'Llegó el repuesto']],
  listo: [['deliver', 'Entregar']]
};
export async function openJob(id, { tab: tab0 = 'trabajo' } = {}) {
  let job = store.job(id) || await store.getJob(id);
  if (!job) { toast('Orden no encontrada', 'warning'); return; }
  let tab = tab0;
  let lines = (job.lines || []).map((l) => ({ ...l }));
  let dirty = false;
  const m = openModal({ title: '', size: 'xl', body: '<div data-root></div>' });
  m.el.querySelector('.modal')?.classList.add('member-modal');
  const root = m.el.querySelector('[data-root]');
  const off = store.on('jobs', () => { const n = store.job(id); if (n && n !== job) { job = n; if (!dirty) lines = (job.lines || []).map((l) => ({ ...l })); header(); if (tab !== 'trabajo' || !dirty) draw(); } });
  const close0 = m.close;
  m.close = async () => { if (dirty && !(await confirmDialog({ title: 'Cambios sin guardar', message: 'Hay cambios en el presupuesto que no guardaste.', confirmText: 'Salir sin guardar', danger: true }))) return; off(); close0(); };
  root.innerHTML = `<div data-head></div><div class="tabs mt" data-tabs><button data-t="trabajo">Trabajo y presupuesto</button><button data-t="ingreso">Ingreso</button><button data-t="bitacora">Bitácora</button></div><div data-body class="mt"></div>`;
  const $ = (q) => root.querySelector(q);
  const locked = () => job.status === 'entregado' || job.status === 'cancelado';
  const v = () => store.vehicle(job.vehicleId);

  function header() {
    const t = jobTotals({ lines });
    const qt = job.quoteCode ? store.quote(job.quoteCode) : null;
    $('[data-head]').innerHTML = `<div class="mhead">${v() ? vehAvatar(v(), 'avatar-xl') : ''}
      <div class="grow" style="min-width:0">
        <div class="row row-wrap">${plateHTML(job.plate, 'plate-lg')}<h2 class="mhead-name">${esc(job.number)}</h2>${jobBadge(job.status)}<span class="badge badge-${JOB_TYPES[job.type]?.tone || 'neutral'}">${icon(JOB_TYPES[job.type]?.icon || 'wrench')} ${JOB_TYPES[job.type]?.label || ''}</span>${job.charged ? '<span class="badge badge-success">Cobrado</span>' : ''}</div>
        <div class="t-sub">${esc(job.vehicleName || '')} · <button class="linkish" data-own>${esc(job.ownerName || '')}</button>${job.phone ? ' · ' + esc(job.phone) : ''} · entró ${fmtDateTime(job.inAt)}${job.kmIn ? ` con ${num(job.kmIn, 0)} km` : ''}</div>
        <div class="small mt-xs">${icon('user')} ${esc(job.mechanicName || 'Sin mecánico')}${job.promisedAt ? ` · ${icon('clock')} prometido ${fmtDate(job.promisedAt)}${job.promisedAt < todayKey() && !locked() ? ' <span class="badge badge-danger">atrasado</span>' : ''}` : ''}${qt?.decision ? ` · presupuesto ${qt.decision}${qt.decidedAt ? ' ' + fmtAgo(qt.decidedAt) : ''}` : job.status === 'presupuesto' ? ` · ${icon('clock')} esperando respuesta desde ${fmtAgo(job.quoteSentAt)}` : ''}</div>
      </div>
      <div class="stack" style="gap:2px;align-items:flex-end"><button class="x-btn" data-x aria-label="Cerrar">${icon('x')}</button><b class="num" style="font-size:20px">${usd(t.total)}</b>${fx() ? `<span class="t-sub">${bs(t.total)}</span>` : ''}</div>
    </div>
    <div class="mactions">
      ${locked() ? '' : (NEXT[job.status] || []).map(([k, l], i) => `<button class="btn ${i === 0 ? 'btn-primary' : 'btn-secondary'}" data-a="${k}">${icon(k === 'quote' || k === 'resend' ? 'send' : k === 'deliver' ? 'key' : k === 'approve' ? 'check' : JOB_STATUS[k]?.icon || 'wrench')} ${l}</button>`).join('')}
      ${!job.charged && jobTotals({ lines }, true).total > 0 && job.status !== 'cancelado' ? `<button class="btn btn-secondary" data-a="charge">${icon('cart')} Cobrar</button>` : ''}
      ${job.phone ? `<button class="btn btn-whatsapp" data-a="wa">${icon('whatsapp')} Avisar</button>` : ''}
      <button class="btn btn-ghost" data-a="print">${icon('print')} Imprimir</button>
      <button class="btn btn-ghost btn-icon" data-a="more" title="Más opciones">${icon('menu')}</button>
    </div>`;
    $('[data-x]').onclick = () => m.close();
    $('[data-own]').onclick = () => { m.close(); openClient(job.ownerId); };
    root.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => action(b.dataset.a, b));
  }

  async function saveLines(silent = false) {
    if (!dirty) return job;
    const diag = $('[data-diag]')?.value; const rec = $('[data-rec]')?.value;
    job = await saveJob(job, { lines, ...(diag != null ? { diagnosis: diag } : {}), ...(rec != null ? { recommendations: rec } : {}) });
    lines = (job.lines || []).map((l) => ({ ...l }));
    dirty = false;
    if (!silent) toast('Orden guardada');
    return job;
  }
  async function action(a, btn) {
    try {
      if (['quote', 'resend', 'approve', 'reparacion', 'listo', 'deliver', 'charge'].includes(a)) await saveLines(true);
      if (a === 'quote' || a === 'resend') {
        if (!lines.length) { toast('Agrega primero la mano de obra y los repuestos del presupuesto.', 'warning'); tab = 'trabajo'; draw(); return; }
        setBusy(btn, true);
        job = await sendQuote(job);
        header(); draw();
        const c = openModal({ title: 'Presupuesto publicado', sub: `${esc(job.number)} · ${usd(jobTotals(job).total)}`, size: 'sm', body: `<p class="small">El cliente lo abre en su teléfono, ve cada trabajo con su precio y lo aprueba (todo o solo una parte). Te llega aquí al instante.</p><div class="mono small center">${esc(quoteUrl(job.quoteCode))}</div>`, footer: `<button class="btn btn-secondary" data-copy>${icon('copy')} Copiar</button><button class="btn btn-secondary" data-p>${icon('print')}</button><button class="btn btn-whatsapp" data-w>${icon('whatsapp')} Enviar</button>` });
        c.el.querySelector('[data-w]').onclick = () => { waClient('presupuesto', { client: store.client(job.ownerId), vehicle: v(), job }); c.close(); };
        c.el.querySelector('[data-p]').onclick = () => printJob(job, 'presupuesto');
        c.el.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(quoteUrl(job.quoteCode)); toast('Enlace copiado'); } catch (_) { toast(quoteUrl(job.quoteCode), 'info', 6000); } };
        return;
      }
      if (a === 'approve') { await approveDialog(); return; }
      if (['diagnostico', 'reparacion', 'repuesto', 'listo'].includes(a)) {
        let text = '';
        if (a === 'repuesto') { text = await promptDialog({ title: 'Esperando repuesto', label: '¿Qué repuesto y cuándo llega?', value: '', confirmText: 'Guardar' }); if (text == null) return; text = `Esperando repuesto${text ? ': ' + text : ''}`; }
        await setJobStatus(job, a, text);
        job = store.job(id) || { ...job, status: a };
        header(); draw();
        if (a === 'listo' && job.phone && await confirmDialog({ title: `${esc(job.plate)} está listo`, message: '¿Le avisas al cliente por WhatsApp?', confirmText: 'Avisar' })) waClient('listo', { client: store.client(job.ownerId), vehicle: v(), job });
        return;
      }
      if (a === 'deliver') { await deliverDialog(); return; }
      if (a === 'charge') { m.close(); nav('vender', { clientId: job.ownerId, vehicleId: job.vehicleId, jobId: job.id }); return; }
      if (a === 'wa') { waMenuJob(); return; }
      if (a === 'print') { const pm = openModal({ title: 'Imprimir', size: 'sm', body: `<div class="list"><button class="list-item" data-k="orden">${icon('clipboard')}<div class="grow"><b>Orden de trabajo</b><div class="t-sub">Con la inspección de ingreso y firma del cliente</div></div></button><button class="list-item" data-k="presupuesto">${icon('file')}<div class="grow"><b>Presupuesto</b><div class="t-sub">Mano de obra y repuestos con totales</div></div></button></div>`, footer: '<button class="btn btn-secondary" data-close>Cerrar</button>' }); pm.el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { printJob({ ...job, lines }, b.dataset.k); pm.close(); }); return; }
      if (a === 'more') moreMenu();
    } catch (ex) { toast(ex.message, 'danger', 5000); setBusy(btn, false); }
  }
  function moreMenu() {
    const mm = openModal({
      title: 'Más opciones', sub: esc(job.number), size: 'sm',
      body: `<div class="list">
        <button class="list-item" data-o="veh">${icon('car')}<div class="grow"><b>Ficha del vehículo</b><div class="t-sub">${esc(job.plate)} · historial y mantenimiento</div></div></button>
        ${locked() ? '' : `<button class="list-item" data-o="mech">${icon('user')}<div class="grow"><b>Cambiar mecánico o fecha prometida</b></div></button>
        ${job.status !== 'repuesto' ? `<button class="list-item" data-o="parts">${icon('truck')}<div class="grow"><b>Esperando repuesto</b></div></button>` : ''}
        <button class="list-item" data-o="cancel">${icon('x')}<div class="grow"><b>Cancelar la orden</b><div class="t-sub">El cliente retira el vehículo sin hacer el trabajo</div></div></button>`}
      </div>`,
      footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
    });
    const o = (k, fn) => mm.el.querySelector(`[data-o="${k}"]`)?.addEventListener('click', async () => { mm.close(); await fn(); });
    o('veh', () => { m.close(); openVehicle(job.vehicleId); });
    o('parts', () => action('repuesto'));
    o('mech', () => {
      const f = openModal({ title: 'Mecánico y fecha', size: 'sm', body: `<div class="form-grid"><div class="field full"><label>Mecánico</label><select class="select" data-m><option value="">Sin asignar</option>${store.mechanics.map((s) => `<option value="${s.id}" ${job.mechanicId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div><div class="field full"><label>Prometido para</label><input class="input" type="date" data-d value="${esc(job.promisedAt || '')}"></div></div>`, footer: '<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>' });
      f.el.querySelector('[data-ok]').onclick = async () => { job = await saveJob(job, { mechanicId: f.el.querySelector('[data-m]').value || null, promisedAt: f.el.querySelector('[data-d]').value }); f.close(); header(); toast('Guardado'); };
    });
    o('cancel', async () => {
      const r = await promptDialog({ title: 'Cancelar orden', label: 'Motivo (opcional)', value: '', confirmText: 'Cancelar orden' });
      if (r == null) return;
      await cancelJob(job, r); toast('Orden cancelada', 'warning'); dirty = false; m.close();
    });
  }
  function waMenuJob() {
    const o = store.client(job.ownerId);
    const opts = [['estado', 'Estado del vehículo', JOB_STATUS[job.status]?.label || ''], ...(job.quoteCode && job.status === 'presupuesto' ? [['presupuesto', 'Reenviar el presupuesto', usd(jobTotals(job).total)]] : []), ...(job.status === 'listo' ? [['listo', 'Avisar que está listo', 'Para retirar']] : []), ['libre', 'Mensaje libre', '']];
    const mm = openModal({ title: 'WhatsApp', sub: `${esc(job.ownerName)} · ${esc(job.plate)}`, size: 'sm', body: `<div class="list">${opts.map(([k, t, s]) => `<button class="list-item" data-k="${k}">${icon('whatsapp')}<div class="grow"><b>${esc(t)}</b><div class="t-sub">${esc(s)}</div></div></button>`).join('')}</div>`, footer: '<button class="btn btn-secondary" data-close>Cerrar</button>' });
    mm.el.querySelectorAll('[data-k]').forEach((b) => b.onclick = async () => {
      mm.close();
      if (b.dataset.k === 'libre') { const t = await promptDialog({ title: 'Mensaje', label: 'Texto', value: '', confirmText: 'Abrir WhatsApp' }); if (t) waClient('libre', { client: o, vehicle: v(), job, extra: t }); return; }
      waClient(b.dataset.k, { client: o, vehicle: v(), job });
    });
  }
  async function approveDialog() {
    const sel = new Set(lines.map((_, i) => i));
    const mm = openModal({
      title: 'Aprobación del cliente', sub: 'Si el cliente aprobó por teléfono o en persona, marca lo que aprobó.', size: 'md',
      body: `<div class="list">${lines.map((l, i) => `<label class="list-item small"><input type="checkbox" data-i="${i}" checked><div class="grow"><b>${esc(l.name)}</b><div class="t-sub">${LINE_KINDS[l.kind] || ''} · ${num(l.qty, l.qty % 1 ? 1 : 0)} × ${usd(l.price)}</div></div><b class="num">${usd(l.price * l.qty)}</b></label>`).join('')}</div><input class="input mt" data-n placeholder="Nota (opcional): ej. aprobó por llamada">`,
      footer: `<button class="btn btn-ghost text-danger" data-no>${icon('x')} Rechazó todo</button><span class="grow"></span><button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Aprobar marcados</button>`
    });
    mm.el.querySelectorAll('[data-i]').forEach((c) => c.onchange = () => { c.checked ? sel.add(+c.dataset.i) : sel.delete(+c.dataset.i); });
    mm.el.querySelector('[data-ok]').onclick = async () => { job = await applyDecision(job, { decision: 'aprobado', approved: [...sel], note: mm.el.querySelector('[data-n]').value, via: 'taller' }); lines = job.lines.map((l) => ({ ...l })); mm.close(); header(); draw(); toast('Presupuesto aprobado'); };
    mm.el.querySelector('[data-no]').onclick = async () => { job = await applyDecision(job, { decision: 'rechazado', note: mm.el.querySelector('[data-n]').value, via: 'taller' }); lines = job.lines.map((l) => ({ ...l })); mm.close(); header(); draw(); toast('Presupuesto rechazado', 'warning'); };
  }
  async function deliverDialog() {
    const t = jobTotals({ lines }, true);
    const wd = Number(store.settings.warrantyDays) || 0; const wk = Number(store.settings.warrantyKm) || 0;
    const mm = openModal({
      title: `Entregar ${esc(job.plate)}`, sub: `${esc(job.number)} · ${usd(t.total)}${job.charged ? ' · cobrado' : ' · aún no cobrado'}`, size: 'md',
      body: `<div class="form-grid">
        <div class="field"><label>Kilometraje de salida</label><div class="input-group"><input class="input" data-km inputmode="numeric" value="${job.kmIn || ''}"><span class="suffix">km</span></div></div>
        <div class="field"><label>Próxima revisión</label><input class="input" type="date" data-nc><div class="chips mt-xs">${[[30, '1 mes'], [90, '3 meses'], [180, '6 meses']].map(([d, l]) => `<button type="button" class="chip chip-sm" data-nd="${d}">${l}</button>`).join('')}</div></div>
        <div class="field"><label>Garantía (días)</label><input class="input" data-wd inputmode="numeric" value="${wd}"></div>
        <div class="field"><label>Garantía (km)</label><input class="input" data-wk inputmode="numeric" value="${wk}"></div>
        <div class="field full"><label>Recomendaciones para el cliente</label><input class="input" data-t value="${esc(job.recommendations || '')}" placeholder="Ej.: cambiar cauchos traseros en 3 meses"></div>
      </div>${!job.charged && t.total > 0 ? `<div class="vital-alert warning mt">Aún no se ha cobrado ${usd(t.total)}. Puedes cobrar ahora o dejarlo pendiente.</div>` : ''}
      <p class="small muted mt">Los servicios del plan de mantenimiento incluidos en la orden (aceite, filtros, frenos…) se registran solos en el vehículo con su próximo cambio.</p>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('key')} Entregar</button>`
    });
    mm.el.querySelectorAll('[data-nd]').forEach((b) => b.onclick = () => { mm.el.querySelector('[data-nc]').value = inDays(Number(b.dataset.nd)); });
    mm.el.querySelector('[data-ok]').onclick = async (e) => {
      setBusy(e.currentTarget, true);
      try {
        const done = await deliverJob(job, { km: parseNum(mm.el.querySelector('[data-km]').value), nextControl: mm.el.querySelector('[data-nc]').value, warrantyDays: parseNum(mm.el.querySelector('[data-wd]').value), warrantyKm: parseNum(mm.el.querySelector('[data-wk]').value), text: mm.el.querySelector('[data-t]').value ? `Entregado · ${mm.el.querySelector('[data-t]').value}` : '' });
        mm.close(); dirty = false; off(); close0();
        toast(`${done.plate} entregado`);
        const c = openModal({ title: 'Vehículo entregado', sub: esc(done.number), size: 'sm', body: `<p class="small">${done.warrantyUntil ? `Garantía hasta el ${fmtDate(done.warrantyUntil)}${done.warrantyKmUntil ? ` o ${num(done.warrantyKmUntil, 0)} km` : ''}.` : ''}</p>`, footer: `${!done.charged && jobTotals(done, true).total > 0 ? `<button class="btn btn-primary" data-c>${icon('cart')} Cobrar</button>` : ''}${done.phone ? `<button class="btn btn-whatsapp" data-w>${icon('whatsapp')} Gracias</button>` : ''}<button class="btn btn-secondary" data-close>Cerrar</button>` });
        c.el.querySelector('[data-w]')?.addEventListener('click', () => { waClient('entregado', { client: store.client(done.ownerId), vehicle: store.vehicle(done.vehicleId), job: done }); c.close(); });
        c.el.querySelector('[data-c]')?.addEventListener('click', () => { c.close(); nav('vender', { clientId: done.ownerId, vehicleId: done.vehicleId, jobId: done.id }); });
      } catch (ex) { toast(ex.message, 'danger'); setBusy(e.currentTarget, false); }
    };
  }

  function draw() {
    root.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    const body = $('[data-body]');
    if (tab === 'trabajo') drawWork(body);
    if (tab === 'ingreso') drawIntake(body);
    if (tab === 'bitacora') drawLog(body);
  }
  function drawWork(body) {
    const t = jobTotals({ lines }); const ta = jobTotals({ lines }, true);
    const ro = locked() || job.charged;
    const mechOpts = (sel) => `<option value="">${esc(job.mechanicName || 'Mecánico')}</option>${store.mechanics.map((s) => `<option value="${s.id}" ${sel === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
    body.innerHTML = `<div class="grid-main">
      <div class="stack">
        <div class="card"><div class="small muted">Pidió el cliente</div><b>${esc(job.complaint || '—')}</b></div>
        <div class="field"><label>Diagnóstico</label><textarea class="input" rows="2" data-diag ${ro ? 'disabled' : ''} placeholder="Lo que encontró el mecánico">${esc(job.diagnosis || '')}</textarea></div>
        <div class="section-title between"><span>${icon('file')} Presupuesto</span>${ro ? '' : `<span class="row row-wrap" style="gap:4px"><button type="button" class="btn btn-ghost btn-sm" data-add="mano">${icon('plus')} Mano de obra</button><button type="button" class="btn btn-ghost btn-sm" data-add="repuesto">${icon('box')} Repuesto</button><button type="button" class="btn btn-ghost btn-sm" data-add="externo">${icon('truck')} Externo</button><button type="button" class="btn btn-ghost btn-sm" data-add="plan">${icon('droplet')} Mantenimiento</button></span>`}</div>
        ${lines.length ? `<div class="job-lines">${lines.map((l, i) => `<div class="job-line ${l.approved === false ? 'is-off' : ''}">
          <span class="badge badge-${l.kind === 'mano' ? 'info' : l.kind === 'externo' ? 'warning' : 'neutral'}">${l.kind === 'mano' ? 'M.O.' : l.kind === 'externo' ? 'Ext.' : 'Rep.'}</span>
          <input class="input input-sm jl-name" data-f="name" data-i="${i}" value="${esc(l.name)}" ${ro ? 'disabled' : ''}>
          <input class="input input-sm jl-q" data-f="qty" data-i="${i}" value="${esc(String(l.qty).replace('.', ','))}" inputmode="decimal" ${ro ? 'disabled' : ''} title="${l.kind === 'mano' ? 'Horas o cantidad' : 'Cantidad'}">
          <input class="input input-sm jl-p" data-f="price" data-i="${i}" value="${esc(String(l.price).replace('.', ','))}" inputmode="decimal" ${ro ? 'disabled' : ''}>
          ${l.kind === 'mano' ? `<select class="select select-sm jl-m" data-f="mechanicId" data-i="${i}" ${ro ? 'disabled' : ''}>${mechOpts(l.mechanicId)}</select>` : `<span class="jl-m t-sub ellipsis">${l.productId ? `${num(store.product(l.productId)?.stock || 0, 0)} en stock` : l.kind === 'externo' ? `costo ${usd(l.cost || 0)}` : ''}</span>`}
          <b class="num jl-t">${usd(l.price * l.qty)}</b>
          ${l.approved === false ? '<span class="badge badge-neutral" title="No aprobado">No</span>' : l.approved === true ? `<span class="badge badge-success" title="Aprobado">${icon('check')}</span>` : '<span></span>'}
          ${ro ? '' : `<button type="button" class="btn btn-ghost btn-icon btn-sm" data-del="${i}" aria-label="Quitar">${icon('x')}</button>`}
        </div>`).join('')}</div>
        <div class="job-totals"><span>Mano de obra <b>${usd(t.labor)}</b></span><span>Repuestos <b>${usd(t.parts)}</b></span><span class="big">Total <b>${usd(t.total)}</b></span>${ta.total !== t.total ? `<span class="text-success">Aprobado <b>${usd(ta.total)}</b></span>` : ''}${fx() ? `<span class="t-sub">${bs(t.total)}</span>` : ''}</div>`
        : emptyState('file', 'Presupuesto vacío', ro ? '' : 'Agrega la mano de obra y los repuestos. Al enviarlo, el cliente lo aprueba desde su teléfono.')}
        <div class="field"><label>Recomendaciones para el cliente</label><input class="input" data-rec ${ro ? 'disabled' : ''} value="${esc(job.recommendations || '')}" placeholder="Ej.: los cauchos delanteros tienen 3 mm, cambiar pronto"></div>
        ${ro ? '' : `<div class="row" style="justify-content:flex-end"><button class="btn btn-primary" data-save ${dirty ? '' : 'disabled'}>${icon('check')} Guardar cambios</button></div>`}
      </div>
      <div class="stack">
        ${job.quoteCode ? `<div class="card"><div class="card-title">${icon('send')} Presupuesto en línea</div><div class="small mt-xs">${job.quoteStatus === 'aprobado' ? `<span class="badge badge-success">Aprobado</span>` : job.quoteStatus === 'rechazado' ? '<span class="badge badge-danger">Rechazado</span>' : '<span class="badge badge-warning">Esperando respuesta</span>'} enviado ${fmtAgo(job.quoteSentAt)}</div><div class="mono small mt-xs ellipsis">${esc(quoteUrl(job.quoteCode))}</div></div>` : ''}
        <div class="card"><div class="card-title">${icon('info')} Resumen</div><div class="kv-grid mt">
          <div class="kv"><span>Entró</span><b>${fmtDateTime(job.inAt)}</b></div>
          <div class="kv"><span>Km</span><b>${job.kmIn ? num(job.kmIn, 0) : '—'}</b></div>
          <div class="kv"><span>Combustible</span><b>${esc(job.fuel || '—')}</b></div>
          <div class="kv"><span>Prometido</span><b>${job.promisedAt ? fmtDate(job.promisedAt) : '—'}</b></div>
          ${job.outAt ? `<div class="kv"><span>Salió</span><b>${fmtDateTime(job.outAt)}</b></div>` : ''}
          ${job.warrantyUntil ? `<div class="kv"><span>Garantía</span><b>${fmtDate(job.warrantyUntil)}</b></div>` : ''}
          ${job.saleNumber ? `<div class="kv"><span>Recibo</span><b>${esc(job.saleNumber)}</b></div>` : ''}
        </div></div>
      </div></div>`;
    const mark = () => { dirty = true; const s = body.querySelector('[data-save]'); if (s) s.disabled = false; };
    body.querySelectorAll('[data-f]').forEach((inp) => {
      inp.oninput = inp.onchange = () => {
        const l = lines[+inp.dataset.i]; const f = inp.dataset.f;
        l[f] = f === 'qty' || f === 'price' ? parseNum(inp.value) || 0 : inp.value;
        if (f === 'qty' || f === 'price') { inp.closest('.job-line').querySelector('.jl-t').textContent = usd(l.price * l.qty); }
        mark();
      };
    });
    body.querySelector('[data-diag]').oninput = mark; body.querySelector('[data-rec]').oninput = mark;
    body.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { lines.splice(+b.dataset.del, 1); mark(); drawWork(body); header(); });
    body.querySelector('[data-save]')?.addEventListener('click', async (e) => { setBusy(e.currentTarget, true); try { await saveLines(); header(); drawWork(body); } catch (ex) { toast(ex.message, 'danger'); setBusy(e.currentTarget, false); } });
    body.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => addLine(b.dataset.add, body));
  }
  async function addLine(kind, body) {
    const keep = () => { const d = $('[data-diag]'); const r = $('[data-rec]'); if (d) job = { ...job, diagnosis: d.value }; if (r) job = { ...job, recommendations: r.value }; };
    keep();
    if (kind === 'mano') {
      const svc = store.products.filter((p) => p.active !== false && p.trackStock === false && /taller|mano/i.test(p.category || ''));
      const rate = Number(store.settings.laborRate) || 0;
      const mm = openModal({ title: 'Mano de obra', size: 'md', body: `<div class="stack">${svc.length ? `<div class="chips chips-wrap">${svc.slice(0, 24).map((p) => `<button type="button" class="chip chip-sm" data-p="${p.id}">${esc(p.name)} · ${usd(p.price)}</button>`).join('')}</div>` : ''}
        <div class="form-grid"><div class="field full"><label>Trabajo *</label><input class="input" data-n placeholder="Ej.: Cambio de pastillas delanteras" autofocus></div>
        <div class="field"><label>Horas / cantidad</label><input class="input" data-q inputmode="decimal" value="1"></div><div class="field"><label>Precio${rate ? ' (por hora)' : ''}</label><input class="input" data-p0 inputmode="decimal" value="${rate ? String(rate).replace('.', ',') : ''}"></div>
        <div class="field full"><label>Mecánico</label><select class="select" data-m><option value="">${esc(job.mechanicName || 'El de la orden')}</option>${store.mechanics.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div></div></div>`,
        footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('plus')} Agregar</button>` });
      let pid = null;
      mm.el.querySelectorAll('[data-p]').forEach((c) => c.onclick = () => { const p = store.product(c.dataset.p); pid = p.id; mm.el.querySelector('[data-n]').value = p.name; mm.el.querySelector('[data-p0]').value = String(p.price || 0).replace('.', ','); });
      mm.el.querySelector('[data-ok]').onclick = () => {
        const n = mm.el.querySelector('[data-n]').value.trim(); if (!n) { mm.el.querySelector('[data-n]').focus(); return; }
        const p = pid ? store.product(pid) : null;
        lines.push({ kind: 'mano', productId: null, name: n, qty: parseNum(mm.el.querySelector('[data-q]').value) || 1, price: parseNum(mm.el.querySelector('[data-p0]').value) || 0, mechanicId: mm.el.querySelector('[data-m]').value || null, maintId: p?.maintId || null, cost: 0 });
        mm.close(); dirty = true; drawWork(body); header();
      };
      return;
    }
    if (kind === 'repuesto') {
      const p = await pickProduct({ title: 'Repuesto del inventario', filter: (x) => x.trackStock !== false });
      if (!p) return;
      const pack = 'caja'; const f = packFactor(p, pack);
      if ((Number(p.stock) || 0) < f) toast(`Ojo: ${p.name} no tiene existencia suficiente.`, 'warning', 5000);
      lines.push({ kind: 'repuesto', productId: p.id, name: p.name, qty: 1, price: Number(p.price) || 0, pack, factor: f, cost: Number(p.cost) || 0, maintId: p.maintId || null, detail: [p.active, p.lab].filter(Boolean).join(' · ') });
      dirty = true; drawWork(body); header(); return;
    }
    if (kind === 'externo') {
      const mm = openModal({ title: 'Repuesto externo', sub: 'Comprado fuera del inventario (casa de repuestos o lo trajo el cliente).', size: 'md', body: `<div class="form-grid"><div class="field full"><label>Repuesto *</label><input class="input" data-n autofocus placeholder="Ej.: Bomba de agua Toyota Corolla 1.8"></div><div class="field"><label>Cantidad</label><input class="input" data-q inputmode="decimal" value="1"></div><div class="field"><label>Costo</label><input class="input" data-c inputmode="decimal"></div><div class="field"><label>Precio al cliente</label><input class="input" data-p0 inputmode="decimal"></div></div>`, footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('plus')} Agregar</button>` });
      mm.el.querySelector('[data-c]').oninput = (e) => { const c = parseNum(e.target.value); const pi = mm.el.querySelector('[data-p0]'); if (c && !pi.dataset.touched) pi.value = String(Math.round(c * 1.25 * 100) / 100).replace('.', ','); };
      mm.el.querySelector('[data-p0]').oninput = (e) => { e.target.dataset.touched = '1'; };
      mm.el.querySelector('[data-ok]').onclick = () => {
        const n = mm.el.querySelector('[data-n]').value.trim(); if (!n) return;
        lines.push({ kind: 'externo', productId: null, name: n, qty: parseNum(mm.el.querySelector('[data-q]').value) || 1, price: parseNum(mm.el.querySelector('[data-p0]').value) || 0, cost: parseNum(mm.el.querySelector('[data-c]').value) || 0 });
        mm.close(); dirty = true; drawWork(body); header();
      };
      return;
    }
    if (kind === 'plan') {
      const mm = openModal({ title: 'Servicio de mantenimiento', sub: 'Al entregar, queda registrado en el plan del vehículo con su próximo cambio.', size: 'md', body: `<div class="list">${store.maintPlan.map((p) => { const svc = store.products.find((x) => x.active !== false && (x.maintId === p.id || (x.trackStock === false && normalize(x.name).includes(normalize(p.name).split(' ')[0])))); return `<button class="list-item" data-id="${p.id}">${icon(p.icon || 'wrench')}<div class="grow"><b>${esc(p.name)}</b><div class="t-sub">${[p.everyKm ? `cada ${num(p.everyKm, 0)} km` : '', p.everyDays ? `o ${Math.round(p.everyDays / 30)} meses` : ''].filter(Boolean).join(' ')}</div></div>${svc ? `<b class="num">${usd(svc.price)}</b>` : ''}</button>`; }).join('')}</div>`, footer: '<button class="btn btn-secondary" data-close>Cancelar</button>' });
      mm.el.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => {
        const p = store.maintPlan.find((x) => x.id === b.dataset.id);
        const svc = store.products.find((x) => x.active !== false && x.trackStock === false && (x.maintId === p.id || normalize(x.name).includes(normalize(p.name).split(' ')[0])));
        lines.push({ kind: 'mano', productId: null, name: svc?.name || p.name, qty: 1, price: Number(svc?.price) || Number(store.settings.laborRate) || 0, maintId: p.id, mechanicId: null, cost: 0 });
        mm.close(); dirty = true; drawWork(body); header();
      });
    }
  }
  function drawIntake(body) {
    const ch = Object.entries(job.checks || {});
    body.innerHTML = `<div class="grid-main"><div class="stack">
      <div class="card"><div class="card-title">${icon('clipboard')} Inspección de ingreso</div>${ch.length ? `<div class="check-grid mt">${ch.map(([k, s]) => `<div class="check-item st-${s}"><span>${esc(k)}</span><b>${CHECK_STATE[s]?.label || s}</b></div>`).join('')}</div>` : '<div class="small muted mt-xs">Sin inspección registrada.</div>'}</div>
      <div class="card"><div class="card-title">${icon('box')} Lo que trae</div><div class="small mt-xs">${(job.belongings || []).length ? job.belongings.map(esc).join(' · ') : '—'}</div><div class="small mt-xs">Combustible: <b>${esc(job.fuel || '—')}</b> · Km: <b>${job.kmIn ? num(job.kmIn, 0) : '—'}</b></div>${job.notes ? `<div class="small mt-xs">Notas: ${esc(job.notes)}</div>` : ''}</div>
      ${(job.photos || []).length ? `<div class="card"><div class="card-title">${icon('camera')} Fotos</div><div class="photo-row mt">${job.photos.map((p) => `<a class="photo-th" href="${p}" target="_blank" rel="noopener"><img src="${p}" alt=""></a>`).join('')}</div></div>` : ''}
    </div><div class="stack"><div class="card"><div class="card-title">${icon('car')} Daños</div><div class="diagram-wrap mt">${bodyDiagram(job.damages || [])}</div>${(job.damages || []).length ? `<div class="list mt">${job.damages.map((d) => `<div class="list-item small"><span class="badge badge-danger">${esc(DAMAGE[d.kind] || d.kind)}</span><div class="grow">${esc(ZONES[d.zone] || d.zone)}${d.note ? ` · ${esc(d.note)}` : ''}</div></div>`).join('')}</div>` : '<div class="small muted mt-xs">Sin daños marcados al recibirlo.</div>'}</div></div></div>`;
  }
  function drawLog(body) {
    body.innerHTML = `<div class="timeline">${(job.log || []).slice().reverse().map((l) => `<div class="tl-item"><span class="tl-dot"></span><div><b class="small">${esc(l.text)}</b><div class="t-sub">${fmtDateTime(l.at)}${l.by ? ' · ' + esc(String(l.by).split('@')[0]) : ''}</div></div></div>`).join('')}</div>
      ${locked() ? '' : `<div class="row mt"><input class="input" data-note placeholder="Ej.: se pidió el kit de embrague, llega el jueves"><button class="btn btn-secondary" data-addn>${icon('plus')}</button></div>`}`;
    body.querySelector('[data-addn]')?.addEventListener('click', async () => { const val = body.querySelector('[data-note]').value; if (!val.trim()) return; await addJobNote(job, val); job = { ...job, log: [...(job.log || []), { at: new Date().toISOString(), text: val, by: '' }] }; drawLog(body); toast('Nota agregada'); });
  }
  root.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  header(); draw();
}

// ======================================================================
// IMPRESIÓN: orden de trabajo (con firma) y presupuesto
// ======================================================================
export function printJob(job, kind = 'orden') {
  const v = store.vehicle(job.vehicleId);
  const t = jobTotals(job);
  const s = store.settings;
  const lines = job.lines || [];
  const ch = Object.entries(job.checks || {});
  printHTML(`<!DOCTYPE html><html><head>${PRINT_HEAD}<title>${kind === 'orden' ? 'Orden' : 'Presupuesto'} ${esc(job.number)}</title><style>${DOC_CSS}</style></head><body>
    ${docHead(kind === 'orden' ? `Orden de trabajo ${job.number}` : `Presupuesto ${job.number}`)}
    ${vehBox(v, { plate: job.plate, vehicleName: job.vehicleName, km: job.kmIn, ownerName: job.ownerName, phone: job.phone, date: (job.inAt || '').slice(0, 10) })}
    <p><b>Solicitud del cliente:</b> ${esc(job.complaint || '—')}</p>${job.diagnosis ? `<p><b>Diagnóstico:</b> ${esc(job.diagnosis)}</p>` : ''}
    ${kind === 'orden' ? `<h3>Inspección de ingreso</h3><p>${ch.map(([k, st]) => `${esc(k)}: <b>${CHECK_STATE[st]?.label || st}</b>`).join(' · ') || '—'}</p>
      <p>Combustible: <b>${esc(job.fuel || '—')}</b> · Trae: ${(job.belongings || []).map(esc).join(', ') || '—'}</p>
      <p>Daños: ${(job.damages || []).map((d) => `${esc(ZONES[d.zone] || d.zone)} (${esc(DAMAGE[d.kind] || d.kind)}${d.note ? ': ' + esc(d.note) : ''})`).join(' · ') || 'sin daños marcados'}</p>
      ${job.promisedAt ? `<p>Fecha prometida: <b>${fmtDate(job.promisedAt)}</b> · Mecánico: ${esc(job.mechanicName || '—')}</p>` : ''}` : ''}
    ${lines.length ? `<h3>${kind === 'orden' ? 'Trabajos y repuestos' : 'Detalle'}</h3><table><thead><tr><th>Tipo</th><th>Descripción</th><th class="r">Cant.</th><th class="r">Precio</th><th class="r">Total</th></tr></thead><tbody>${lines.map((l) => `<tr style="${l.approved === false ? 'color:#999;text-decoration:line-through' : ''}"><td>${esc(LINE_KINDS[l.kind] || '')}</td><td><b>${esc(l.name)}</b></td><td class="r">${num(l.qty, l.qty % 1 ? 1 : 0)}</td><td class="r">${usd(l.price)}</td><td class="r">${usd(l.price * l.qty)}</td></tr>`).join('')}</tbody></table>
      <p class="r">Mano de obra: <b>${usd(t.labor)}</b> · Repuestos: <b>${usd(t.parts)}</b> · <span style="font-size:15px">TOTAL: <b>${usd(t.total)}</b></span>${fx() ? ` · ${bs(t.total)}` : ''}</p>` : ''}
    ${job.recommendations ? `<p><b>Recomendaciones:</b> ${esc(job.recommendations)}</p>` : ''}
    ${kind === 'presupuesto' ? `<p class="sm">${esc(s.quoteNote || '')}${Number(s.warrantyDays) ? ` Garantía de ${Number(s.warrantyDays)} días sobre la mano de obra.` : ''}</p>` : '<p class="sm">El cliente autoriza la revisión del vehículo y declara conforme el estado de ingreso descrito. El taller no se hace responsable por objetos de valor no declarados.</p>'}
    <div class="sign"><div>Recibido por (taller)</div><div>Firma del cliente${job.ownerName ? `<br>${esc(job.ownerName)}` : ''}</div></div>
    <p class="sm" style="margin-top:20px">${esc(job.number)} · SanoTaller</p></body></html>`);
}

// ======================================================================
// TABLERO DEL TALLER
// ======================================================================
export function mount(el, { params = {} }) {
  let q = ''; let mech = '';
  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Órdenes de trabajo</h1><p class="view-sub" id="j-sub"></p></div>
    <div class="view-actions"><button class="btn btn-secondary" id="j-hist">${icon('history')} Historial</button><button class="btn btn-primary" id="j-new" data-tour="job-new">${icon('plus')} Recibir vehículo</button></div></div>
    <div class="toolbar card" style="margin-bottom:12px"><label class="search">${icon('search')}<input id="j-q" placeholder="Placa, orden, cliente o vehículo…"></label><select class="select select-sm" id="j-m" style="width:auto"></select></div>
    <div id="j-board"></div>`;
  const $ = (s) => el.querySelector(s);
  function draw() {
    const t = normalize(q);
    const list = store.jobs.filter((j) => (!mech || j.mechanicId === mech || (j.lines || []).some((l) => l.mechanicId === mech)) && (!t || normalize(`${j.plate} ${j.number} ${j.ownerName} ${j.vehicleName} ${j.complaint}`).includes(t)));
    $('#j-sub').textContent = `${store.jobs.length} vehículo(s) en el taller · ${store.pendingQuotes.length} presupuesto(s) por aprobar · ${store.readyJobs.length} listo(s) para entregar`;
    $('#j-m').innerHTML = `<option value="">Todos los mecánicos</option>${store.mechanics.map((s) => `<option value="${s.id}" ${s.id === mech ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
    $('#j-board').innerHTML = `<div class="kanban kanban-5" data-tour="board">${BOARD.map(([key, sts]) => { const col = list.filter((j) => sts.includes(j.status)); const st = JOB_STATUS[key]; return `<div class="kcol"><div class="kcol-head"><span class="badge badge-${st.tone}">${icon(st.icon)} ${key === 'recibido' ? 'Recibido / diagnóstico' : key === 'reparacion' ? 'En reparación' : st.label}</span><span class="count">${col.length}</span></div>${col.map((j) => {
      const late = j.promisedAt && j.promisedAt < todayKey();
      const tt = jobTotals(j);
      return `<button class="kcard kcard-job" data-j="${j.id}"><div class="row" style="gap:6px">${plateHTML(j.plate, 'plate-sm')}<b class="ellipsis grow">${esc(j.vehicleName || '')}</b></div>
        <div class="t-sub ellipsis">${esc(j.complaint || '')}</div>
        <div class="row row-wrap" style="gap:4px;margin-top:4px">${j.status === 'aprobado' ? jobBadge('aprobado') : ''}${late ? '<span class="badge badge-danger">atrasado</span>' : ''}${j.quoteStatus === 'rechazado' && j.status === 'diagnostico' ? '<span class="badge badge-danger">rechazó</span>' : ''}${tt.total ? `<span class="badge badge-neutral">${usd(tt.total)}</span>` : ''}${j.charged ? '<span class="badge badge-success">cobrado</span>' : ''}</div>
        <div class="t-sub">${esc(j.number)} · ${esc(j.ownerName || '')}${j.mechanicName ? ' · ' + esc(j.mechanicName) : ''} · ${fmtAgo(j.inAt)}</div></button>`;
    }).join('') || '<div class="kempty">—</div>'}</div>`; }).join('')}</div>
    ${!store.jobs.length ? emptyState('wrench', 'No hay vehículos en el taller', 'Recibe el primero con “Recibir vehículo”: placa, kilometraje, lo que pide el cliente y la inspección de ingreso.') : ''}`;
    el.querySelectorAll('[data-j]').forEach((b) => b.onclick = () => openJob(b.dataset.j));
  }
  $('#j-q').oninput = (e) => { q = e.target.value; draw(); };
  $('#j-m').onchange = (e) => { mech = e.target.value; draw(); };
  $('#j-new').onclick = async () => { const r = await receiveForm(); if (r) openJob(r.id); };
  $('#j-hist').onclick = () => historyModal();
  draw();
  const off = store.on('*', (evt) => { if (evt === 'jobs' || evt === 'quotes' || evt === 'settings') draw(); });
  if (params.open) setTimeout(() => openJob(params.open), 50);
  return () => off();
}

/** Órdenes entregadas o canceladas de los últimos días */
async function historyModal() {
  const m = openModal({ title: 'Historial de órdenes', sub: 'Últimos 60 días', size: 'lg', body: '<div class="empty"><div class="spinner"></div></div>', footer: '<button class="btn btn-secondary" data-close>Cerrar</button>' });
  const from = addDays(new Date(), -60).toISOString(); const to = new Date(Date.now() + 864e5).toISOString();
  const list = (await store.jobsBetween(from, to).catch(() => [])).filter((j) => !j.open).sort((a, b) => (b.outAt || '').localeCompare(a.outAt || ''));
  m.el.querySelector('.modal-body').innerHTML = list.length ? `<div class="table-wrap"><table class="table table-hover"><thead><tr><th>Orden</th><th>Vehículo</th><th class="hide-sm">Cliente</th><th>Salió</th><th class="r">Total</th></tr></thead><tbody>${list.map((j) => `<tr data-j="${j.id}" style="cursor:pointer"><td><b>${esc(j.number)}</b><div>${jobBadge(j.status)}</div></td><td>${plateHTML(j.plate, 'plate-sm')}<div class="t-sub">${esc(j.vehicleName || '')}</div></td><td class="hide-sm small">${esc(j.ownerName || '')}</td><td class="small">${fmtDate(j.outAt)}</td><td class="r num">${usd(j.total ?? jobTotals(j, true).total)}${j.status === 'entregado' && !j.charged && (j.total ?? 0) > 0 ? '<div><span class="badge badge-warning">por cobrar</span></div>' : ''}</td></tr>`).join('')}</tbody></table></div>`
    : emptyState('history', 'Sin órdenes cerradas', 'Las órdenes entregadas aparecen aquí.');
  m.el.querySelectorAll('[data-j]').forEach((r) => r.onclick = () => { m.close(); openJob(r.dataset.j); });
}
export { syncQuotes };
