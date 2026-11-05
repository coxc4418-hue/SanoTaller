// SanoTaller — Inicio: el día del taller de un vistazo
import { store } from '../store.js';
import { esc, usd, fmtLongDate, todayKey, emptyState, fmtDate, fmtAgo } from '../utils.js';
import { icon } from '../icons.js';
import { vehAvatar, plateHTML, openVehicle, vehicleForm, pickVehicle } from '../client.js';
import { waClient } from '../shared.js';
import { SERVICES, apptBadge, dueText, dueTone, JOB_STATUS, WASH_STATUS, stockText, productLine, vehicleName } from '../taller.js';
import { markReminded, setApptStatus } from '../ops.js';

export function mount(el, { navigate }) {
  const h = new Date().getHours();
  const hello = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">${hello} ${h < 12 ? '☀️' : h < 19 ? '🔧' : '🌙'}</h1><p class="view-sub">${fmtLongDate()} · ${esc(store.businessName)}</p></div>
      <div class="view-actions" data-tour="quick">
        <button class="btn btn-primary" data-q="receive">${icon('wrench')} Recibir vehículo</button>
        <button class="btn btn-secondary" data-q="wash">${icon('spray')} Lavado</button>
        <button class="btn btn-secondary" data-q="appt">${icon('calendar')} Agendar cita</button>
        <button class="btn btn-secondary" data-q="sell">${icon('cart')} Vender <kbd class="hide-sm">F1</kbd></button>
        <button class="btn btn-ghost" data-q="new">${icon('plus')} Vehículo</button>
      </div></div>
    <div id="d-ord"></div>
    <div class="kpis" data-tour="kpis" id="d-kpis"></div>
    <div class="grid-2 mt-lg">
      <div class="card" data-tour="shop"><div class="card-head"><div class="card-title">${icon('wrench')} En el taller ahora</div><button class="btn btn-ghost btn-sm" data-go="ordenes">Tablero</button></div><div id="d-in"></div></div>
      <div class="card" data-tour="today"><div class="card-head"><div class="card-title">${icon('calendar')} Citas de hoy</div><button class="btn btn-ghost btn-sm" data-go="agenda">Agenda</button></div><div id="d-appts"></div></div>
    </div>
    <div class="grid-2 mt-lg">
      <div class="card" data-tour="due"><div class="card-head"><div class="card-title">${icon('droplet')} Mantenimientos por avisar</div><button class="btn btn-ghost btn-sm" data-go="recordatorios">Ver todo</button></div><div id="d-due"></div></div>
      <div class="card" data-tour="low"><div class="card-head"><div class="card-title">${icon('alert')} Repuestos por reponer</div><button class="btn btn-ghost btn-sm" data-go="inventario">Inventario</button></div><div id="d-low"></div></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => navigate(b.dataset.go));
  $('[data-q="sell"]').onclick = () => navigate('vender');
  $('[data-q="appt"]').onclick = async () => { const { apptForm } = await import('./agenda.js'); apptForm(null, {}); };
  $('[data-q="receive"]').onclick = async () => { const v = await pickVehicle({ title: '¿Qué vehículo recibes?' }); if (v) { const { receiveForm } = await import('./jobs.js'); receiveForm(v); } };
  $('[data-q="wash"]').onclick = async () => { const { washForm } = await import('./wash.js'); washForm(); };
  $('[data-q="new"]').onclick = async () => { const r = await vehicleForm(); if (r) openVehicle(r.vehicle.id); };

  function orders() {
    const list = store.pendingOrders;
    const fresh = store.newOrders;
    const ready = store.readyJobs; const quotes = store.jobs.filter((j) => j.quoteStatus && ['aprobado', 'diagnostico'].includes(j.status) && String(j.approvedAt || '').slice(0, 10) === todayKey());
    $('#d-ord').innerHTML = (list.length ? `<div class="banner req-banner"><span>${icon('bag')} <b>${list.length} pedido(s) en línea</b> por atender${fresh.length ? ` · ${fresh.length} nuevo(s)` : ''}: ${list.slice(0, 3).map((o) => `${esc((o.name || '').split(' ')[0])} (${o.items?.length || 0})`).join(', ')}</span><button class="btn btn-sm btn-primary" id="d-ord-go">Atender</button></div>` : '')
      + (quotes.length ? `<div class="banner info-banner"><span>${icon('file')} <b>${quotes.length} cliente(s) respondieron el presupuesto</b>: ${quotes.slice(0, 3).map((j) => esc(j.plate)).join(', ')}</span><button class="btn btn-sm btn-primary" data-go3="ordenes">Ver</button></div>` : '')
      + (ready.length ? `<div class="banner ok-banner"><span>${icon('bell')} <b>${ready.length} vehículo(s) listos para entregar</b>: ${ready.slice(0, 4).map((j) => esc(j.plate)).join(', ')}</span><button class="btn btn-sm btn-secondary" data-go3="ordenes">Ver</button></div>` : '');
    $('#d-ord-go')?.addEventListener('click', () => navigate('pedidos'));
    el.querySelectorAll('[data-go3]').forEach((b) => b.onclick = () => navigate(b.dataset.go3));
  }

  function kpis() {
    const t = todayKey();
    const sales = store.recentSales.filter((s) => s.dayKey === t && s.status !== 'voided' && s.kind !== 'abono');
    const total = sales.reduce((a, s) => a + (Number(s.total) || 0), 0);
    const appts = store.todayAppts;
    const jobs = store.jobs;
    const due = store.dueMaint;
    const late = due.filter((x) => x.late).length;
    const wq = store.washQueue;
    const low = store.lowProducts.length;
    $('#d-kpis').innerHTML = `
      <div class="card kpi kpi-link" data-go2="ordenes"><div class="kpi-top"><span class="kpi-label">En el taller</span><span class="kpi-icon tone-brand">${icon('wrench')}</span></div><div class="kpi-value">${jobs.length}</div><div class="kpi-sub">${store.readyJobs.length} listo(s)${store.pendingQuotes.length ? ` · <span class="text-warning">${store.pendingQuotes.length} por aprobar</span>` : ''}${store.waitingParts.length ? ` · <span class="text-danger">${store.waitingParts.length} esperan repuesto</span>` : ''}</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Ventas de hoy</span><span class="kpi-icon tone-success">${icon('dollar')}</span></div><div class="kpi-value">${usd(total)}</div><div class="kpi-sub">${sales.length} cobro(s)${store.openShift ? '' : ' · <span class="text-warning">caja cerrada</span>'}</div></div>
      <div class="card kpi kpi-link" data-go2="agenda"><div class="kpi-top"><span class="kpi-label">Citas de hoy</span><span class="kpi-icon tone-info">${icon('calendar')}</span></div><div class="kpi-value">${appts.length}</div><div class="kpi-sub">${appts.filter((a) => a.status === 'atendida').length} recibida(s)${store.waiting.length ? ` · <span class="text-warning">${store.waiting.length} llegaron</span>` : ''}</div></div>
      <div class="card kpi kpi-link" data-go2="lavado"><div class="kpi-top"><span class="kpi-label">Autolavado</span><span class="kpi-icon tone-info">${icon('spray')}</span></div><div class="kpi-value">${wq.length}</div><div class="kpi-sub">${wq.filter((w) => w.status === 'espera').length} en cola · ${wq.filter((w) => w.status === 'listo').length} listo(s)</div></div>
      <div class="card kpi kpi-link" data-go2="recordatorios"><div class="kpi-top"><span class="kpi-label">Mantenimientos por tocar</span><span class="kpi-icon tone-violet">${icon('droplet')}</span></div><div class="kpi-value">${due.length}</div><div class="kpi-sub">${late ? `<span class="text-danger">${late} vencido(s)</span>` : `próximos ${store.settings.reminderDays || 7} días`}</div></div>
      <div class="card kpi kpi-link" data-go2="inventario" data-p="bajo"><div class="kpi-top"><span class="kpi-label">Stock bajo</span><span class="kpi-icon tone-warning">${icon('box')}</span></div><div class="kpi-value">${low}</div><div class="kpi-sub">${store.liveVehicles.length} vehículo(s) · ${store.liveClients.length} cliente(s)</div></div>`;
    el.querySelectorAll('[data-go2]').forEach((b) => b.onclick = () => navigate(b.dataset.go2, b.dataset.p ? { tab: b.dataset.p } : {}));
  }

  function inShop() {
    const order = ['listo', 'presupuesto', 'repuesto', 'reparacion', 'aprobado', 'diagnostico', 'recibido'];
    const list = [...store.jobs].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    const wl = store.washQueue.filter((w) => w.status !== 'espera');
    $('#d-in').innerHTML = list.length || wl.length ? `<div class="list">${list.slice(0, 8).map((j) => { const st = JOB_STATUS[j.status] || JOB_STATUS.recibido; const v = store.vehicle(j.vehicleId); return `<button class="list-item" data-j="${j.id}">${v ? vehAvatar(v) : ''}<div class="grow" style="min-width:0"><div class="row" style="gap:6px">${plateHTML(j.plate, 'plate-sm')}<b class="ellipsis">${esc(j.vehicleName || '')}</b></div><div class="t-sub ellipsis">${esc(j.number)} · ${esc(j.complaint || '')}${j.mechanicName ? ' · ' + esc(j.mechanicName) : ''} · ${fmtAgo(j.inAt)}</div></div><span class="badge badge-${st.tone}">${icon(st.icon)} ${st.label}</span></button>`; }).join('')}
      ${wl.map((w) => `<div class="list-item"><span class="kpi-icon tone-info" style="width:36px;height:36px">${icon('spray')}</span><div class="grow" style="min-width:0"><div class="row" style="gap:6px">${plateHTML(w.plate, 'plate-sm')}<b class="ellipsis">${esc(w.vehicleName || '')}</b></div><div class="t-sub ellipsis">${esc((w.types || []).join(', '))}</div></div><span class="badge badge-${WASH_STATUS[w.status]?.tone || 'neutral'}">${WASH_STATUS[w.status]?.label || ''}</span></div>`).join('')}</div>${list.length > 8 ? `<div class="small muted mt-xs">y ${list.length - 8} más en el tablero…</div>` : ''}`
      : emptyState('wrench', 'No hay vehículos en el taller', 'Recibe un vehículo: registras el kilometraje, el combustible y los daños, y le sigues el paso hasta entregarlo.');
    el.querySelectorAll('#d-in [data-j]').forEach((b) => b.onclick = async () => { const { openJob } = await import('./jobs.js'); openJob(b.dataset.j); });
  }

  function appts() {
    const list = store.todayAppts;
    $('#d-appts').innerHTML = list.length ? `<div class="list">${list.slice(0, 8).map((a) => {
      const v = a.vehicleId ? store.vehicle(a.vehicleId) : null; const sv = SERVICES[a.service] || SERVICES.mantenimiento;
      return `<div class="list-item"><div class="appt-time"><b>${esc(a.time)}</b></div>${v ? vehAvatar(v) : `<span class="kpi-icon" style="width:38px;height:38px;background:${sv.color}22;color:${sv.color}">${icon(sv.icon)}</span>`}<div class="grow" style="min-width:0"><button class="linkish ellipsis" data-v="${a.vehicleId || ''}">${plateHTML(a.plate, 'plate-sm')} <b>${esc(a.vehicleName || '')}</b></button><div class="t-sub ellipsis">${esc(sv.label)}${a.staffName ? ' · ' + esc(a.staffName) : ''} · ${esc(a.ownerName || '')}</div></div>${apptBadge(a.status)}
        ${['pendiente', 'confirmada'].includes(a.status) ? `<button class="btn btn-secondary btn-sm" data-arr="${a.id}" title="Llegó">${icon('door')}<span class="hide-sm"> Llegó</span></button>` : a.status === 'llego' ? `<button class="btn btn-primary btn-sm" data-att="${a.id}">${icon(a.service === 'lavado' ? 'spray' : 'wrench')}<span class="hide-sm"> Recibir</span></button>` : ''}</div>`;
    }).join('')}</div>${list.length > 8 ? `<div class="small muted mt-xs">y ${list.length - 8} más…</div>` : ''}`
      : emptyState('calendar', 'Sin citas para hoy', 'Agenda mantenimientos, diagnósticos y lavados: aparecen aquí con su hora.');
    el.querySelectorAll('#d-appts [data-v]').forEach((b) => b.onclick = () => b.dataset.v && openVehicle(b.dataset.v));
    el.querySelectorAll('#d-appts [data-arr]').forEach((b) => b.onclick = () => setApptStatus(store.appointments.find((a) => a.id === b.dataset.arr), 'llego'));
    el.querySelectorAll('#d-appts [data-att]').forEach((b) => b.onclick = async () => {
      const a = store.appointments.find((x) => x.id === b.dataset.att); const v = a.vehicleId ? store.vehicle(a.vehicleId) : null;
      if (a.service === 'lavado') { const { washForm } = await import('./wash.js'); washForm({ vehicle: v, appt: a }); }
      else if (v) { const { receiveForm } = await import('./jobs.js'); receiveForm(v, { appt: a }); }
      else { const p = await pickVehicle({ title: `Vehículo ${a.plate}` }); if (p) { const { receiveForm } = await import('./jobs.js'); receiveForm(p, { appt: a }); } }
    });
  }

  function due() {
    const all = store.dueMaint; const list = all.slice(0, 6);
    const ctrl = store.dueControls.slice(0, 3);
    $('#d-due').innerHTML = `
      <div class="follow-sums"><div><b>${all.filter((x) => x.late).length}</b><span>vencidos</span></div><div><b>${all.filter((x) => !x.late).length}</b><span>por tocar</span></div><div><b>${store.dueControls.length}</b><span>revisiones</span></div><div><b>${store.debtors.length}</b><span>con deuda</span></div></div>
      ${list.length ? `<div class="list mt">${list.map((x, i) => `<div class="list-item">${vehAvatar(x.vehicle)}<div class="grow" style="min-width:0"><button class="linkish ellipsis" data-v="${x.vehicle.id}">${plateHTML(x.vehicle.plate, 'plate-sm')} <b>${esc(vehicleName(x.vehicle))}</b></button><div class="t-sub ellipsis">${esc(x.name)} · ${esc(x.owner?.name || x.vehicle.ownerName || '')}</div></div><span class="badge badge-${dueTone(x)}">${dueText(x)}</span>${x.owner?.phone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${i}" title="Avisar por WhatsApp">${icon('whatsapp')}</button>` : ''}</div>`).join('')}</div>` : ''}
      ${ctrl.length ? `<div class="section-title mt">${icon('refresh')} Revisiones indicadas</div><div class="list">${ctrl.map((x) => `<div class="list-item">${vehAvatar(x.vehicle)}<div class="grow" style="min-width:0"><button class="linkish" data-v="${x.vehicle.id}">${plateHTML(x.vehicle.plate, 'plate-sm')} <b>${esc(vehicleName(x.vehicle))}</b></button><div class="t-sub ellipsis">Revisión · ${fmtDate(x.vehicle.nextControl)}</div></div>${x.owner?.phone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-ct="${x.vehicle.id}">${icon('whatsapp')}</button>` : ''}</div>`).join('')}</div>` : ''}
      ${!list.length && !ctrl.length ? emptyState('checkCircle', 'Todo al día', 'Registra los cambios de aceite, filtros y frenos: aquí verás a quién le toca el próximo por kilometraje o por fecha.') : ''}`;
    el.querySelectorAll('#d-due [data-v]').forEach((b) => b.onclick = () => openVehicle(b.dataset.v));
    el.querySelectorAll('#d-due [data-wa]').forEach((b) => b.onclick = () => { const x = list[+b.dataset.wa]; waClient('mantenimiento', { client: x.owner, vehicle: x.vehicle, item: x }); markReminded(x.vehicle, `${x.id}:${x.nextKm || ''}:${x.next || ''}`); });
    el.querySelectorAll('#d-due [data-ct]').forEach((b) => b.onclick = () => { const v = store.vehicle(b.dataset.ct); waClient('revision', { client: store.client(v.ownerId), vehicle: v }); });
  }

  function low() {
    const lowL = store.lowProducts.sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0)).slice(0, 6);
    $('#d-low').innerHTML = lowL.length ? `<div class="list">${lowL.map((p) => `<div class="list-item"><span class="kpi-icon tone-${(Number(p.stock) || 0) <= 0 ? 'danger' : 'warning'}" style="width:36px;height:36px">${icon('box')}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(p.name)}</b><div class="t-sub ellipsis">${esc(productLine(p))}</div></div><div class="r"><b class="${(Number(p.stock) || 0) <= 0 ? 'text-danger' : ''}">${(Number(p.stock) || 0) <= 0 ? 'Agotado' : stockText(p)}</b><div class="t-sub">mín. ${stockText(p, p.minStock || 0)}</div></div></div>`).join('')}</div>`
      : emptyState('checkCircle', 'Inventario en orden', 'Ningún repuesto por debajo del mínimo.');
  }

  const all = () => { orders(); kpis(); inShop(); appts(); due(); low(); };
  all();
  const off = store.on('*', (evt) => {
    if (evt === 'orders') orders();
    if (evt === 'products') { kpis(); low(); }
    if (evt === 'vehicles' || evt === 'clients') { kpis(); due(); appts(); inShop(); }
    if (evt === 'appointments') { kpis(); appts(); }
    if (evt === 'jobs' || evt === 'quotes') { orders(); kpis(); inShop(); }
    if (evt === 'washes') { kpis(); inShop(); }
    if (evt === 'sales' || evt === 'shift') kpis();
    if (evt === 'settings') all();
  });
  return () => off();
}
