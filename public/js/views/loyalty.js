// SanoTaller — Recordatorios: mantenimientos por kilometraje y fecha, revisiones, clientes que no vuelven, saldos, planes y puntos
import { store, daysBetween } from '../store.js';
import { markReminded, settleAgreement } from '../ops.js';
import { esc, usd, emptyState, fmtDate, toast, openModal, setBusy, PAY_METHODS, todayKey } from '../utils.js';
import { icon } from '../icons.js';
import { avatar, vehAvatar, plateHTML, openClient, openVehicle, payDebtModal } from '../client.js';
import { waClient, printDoc } from '../shared.js';
import { dueTone, dueText, vehicleName } from '../taller.js';

const TABS = { mantenimiento: 'Mantenimiento', revisiones: 'Revisiones', inactivos: 'No han vuelto', saldos: 'Saldos pendientes', convenios: 'Flotas y convenios', puntos: 'Puntos' };

export function mount(el, { navigate, params = {} }) {
  let tab = TABS[params.tab] ? params.tab : 'mantenimiento';
  let filter = 'todos';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Recordatorios</h1><p class="view-sub">El taller calcula el kilometraje de cada vehículo y te dice a quién le toca el próximo cambio de aceite, filtros o frenos: avísale a tiempo y vuelve.</p></div></div>
    <div class="tabs" id="l-tabs" data-tour="rem-tabs">${Object.entries(TABS).map(([k, v]) => `<button data-t="${k}">${v}<span class="tab-n" data-n="${k}" hidden></span></button>`).join('')}</div>
    <div id="l-body" class="mt"></div>`;
  const $ = (s) => el.querySelector(s);
  const set = (k, n) => { const b = el.querySelector(`[data-n="${k}"]`); if (b) { b.hidden = !n; b.textContent = n; } };
  const inactive = () => store.liveClients.filter((c) => c.lastVisitAt && daysBetween(c.lastVisitAt.slice(0, 10), todayKey()) > 180).sort((a, b) => (a.lastVisitAt || '').localeCompare(b.lastVisitAt || ''));

  function draw() {
    el.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    set('mantenimiento', store.dueMaint.length); set('revisiones', store.dueControls.length); set('inactivos', inactive().length); set('saldos', store.debtors.length);
    ({ mantenimiento, revisiones, inactivos, saldos, convenios, puntos })[tab]();
  }
  const sent = (v, key) => v.reminded?.[key];
  const keyOf = (x) => `${x.id}:${x.nextKm || ''}:${x.next || ''}`;

  function mantenimiento() {
    const all = store.dueMaint;
    const kinds = [...new Map(all.map((x) => [x.id, x.name])).entries()];
    const list = filter === 'todos' ? all : all.filter((x) => x.id === filter);
    const late = list.filter((x) => x.late); const soon = list.filter((x) => !x.late);
    const row = (x) => { const i = all.indexOf(x); const s = sent(x.vehicle, keyOf(x)); return `<div class="list-item">${vehAvatar(x.vehicle)}<div class="grow" style="min-width:0"><button class="linkish ellipsis" data-v="${x.vehicle.id}">${plateHTML(x.vehicle.plate, 'plate-sm')} <b>${esc(vehicleName(x.vehicle))}</b></button> <span class="t-sub">${esc(x.owner?.name || x.vehicle.ownerName || '')}</span><div class="t-sub ellipsis">${esc(x.name)}${x.nextKm ? ` · a los ${Number(x.nextKm).toLocaleString('es')} km` : ''}${x.next ? ` · ${fmtDate(x.next)}` : ''}</div><div class="small"><span class="badge badge-${dueTone(x)}">${dueText(x)}</span>${s ? ` <span class="badge badge-success">${icon('check')} avisado ${fmtDate(s)}</span>` : ''}</div></div>
      <div class="row" style="gap:4px">${x.owner?.phone || x.vehicle.ownerPhone ? `<button class="btn btn-whatsapp btn-sm" data-wa="${i}">${icon('whatsapp')}<span class="hide-sm"> Avisar</span></button>` : ''}<button class="btn btn-secondary btn-icon btn-sm" data-ap="${x.vehicle.id}" title="Agendar">${icon('calendar')}</button></div></div>`; };
    $('#l-body').innerHTML = `<div class="row row-wrap mb" style="gap:6px"><span class="small muted">Servicio:</span><button class="chip chip-sm ${filter === 'todos' ? 'on' : ''}" data-f="todos">Todos</button>${kinds.map(([k, n]) => `<button class="chip chip-sm ${filter === k ? 'on' : ''}" data-f="${esc(k)}">${esc(n)}</button>`).join('')}</div>
      <div class="grid-2">
      <div class="card"><div class="card-head"><div class="card-title text-danger">${icon('alert')} Vencidos</div><span class="small muted">${late.length}</span></div>${late.length ? `<div class="list">${late.map(row).join('')}</div>` : emptyState('checkCircle', 'Ninguno vencido', 'Todos los vehículos tienen su mantenimiento al día.')}</div>
      <div class="card"><div class="card-head"><div class="card-title">${icon('gauge')} Por tocar</div><span class="small muted">${soon.length}</span></div>${soon.length ? `<div class="list">${soon.map(row).join('')}</div>` : emptyState('calendar', 'Nada por ahora', 'Registra los servicios con su kilometraje: el sistema estima cuándo toca el próximo.')}</div>
    </div>
    <p class="small muted mt">Se avisa cuando faltan ${store.settings.reminderKm || 500} km o ${store.settings.reminderDays || 7} días (lo que llegue primero). El kilometraje de hoy se estima con el promedio de uso de cada vehículo.</p>`;
    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; draw(); });
    el.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => openVehicle(b.dataset.v, { tab: 'mantenimiento' }));
    el.querySelectorAll('[data-ap]').forEach((b) => b.onclick = async () => { const { apptForm } = await import('./agenda.js'); apptForm(null, { vehicle: store.vehicle(b.dataset.ap), service: 'mantenimiento' }); });
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = async () => { const x = all[+b.dataset.wa]; waClient('mantenimiento', { client: x.owner, vehicle: x.vehicle, item: x }); await markReminded(x.vehicle, keyOf(x)); });
  }

  function revisiones() {
    const list = store.dueControls;
    $('#l-body').innerHTML = list.length ? `<div class="card"><div class="list">${list.map((x) => `<div class="list-item">${vehAvatar(x.vehicle)}<div class="grow" style="min-width:0"><button class="linkish" data-v="${x.vehicle.id}">${plateHTML(x.vehicle.plate, 'plate-sm')} <b>${esc(vehicleName(x.vehicle))}</b></button> <span class="t-sub">${esc(x.owner?.name || '')}</span><div class="t-sub ellipsis">Revisión indicada · ${fmtDate(x.vehicle.nextControl)}</div></div><span class="badge badge-${x.d < 0 ? 'danger' : x.d <= 3 ? 'warning' : 'info'}">${x.d < 0 ? `atrasada ${-x.d} d` : x.d === 0 ? 'hoy' : `en ${x.d} d`}</span>${x.owner?.phone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${x.vehicle.id}">${icon('whatsapp')}</button>` : ''}<button class="btn btn-secondary btn-icon btn-sm" data-ap="${x.vehicle.id}" title="Agendar">${icon('calendar')}</button></div>`).join('')}</div></div>`
      : emptyState('refresh', 'Sin revisiones pendientes', 'Al entregar una orden con “Próxima revisión”, el vehículo aparece aquí unos días antes.');
    el.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => openVehicle(b.dataset.v));
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => { const v = store.vehicle(b.dataset.wa); waClient('revision', { client: store.client(v.ownerId), vehicle: v }); });
    el.querySelectorAll('[data-ap]').forEach((b) => b.onclick = async () => { const v = store.vehicle(b.dataset.ap); const { apptForm } = await import('./agenda.js'); apptForm(null, { vehicle: v, service: 'revision', date: v.nextControl }); });
  }

  function inactivos() {
    const list = inactive().slice(0, 100);
    $('#l-body').innerHTML = list.length ? `<div class="card"><div class="card-head"><div class="card-title">${icon('userX')} Más de 6 meses sin venir</div><span class="small muted">${list.length}</span></div><div class="list">${list.map((c) => { const vs = store.vehiclesOf(c.id); return `<div class="list-item">${avatar(c)}<div class="grow" style="min-width:0"><button class="linkish" data-c="${c.id}"><b>${esc(c.name)}</b></button><div class="t-sub ellipsis">${vs.map((v) => esc(v.plate)).join(', ') || 'sin vehículo'} · última visita ${fmtDate(c.lastVisitAt)}</div></div>${c.phone ? `<button class="btn btn-whatsapp btn-sm" data-wa="${c.id}">${icon('whatsapp')}<span class="hide-sm"> Invitar</span></button>` : ''}</div>`; }).join('')}</div></div>`
      : emptyState('checkCircle', 'Todos tus clientes están activos', 'Aquí aparecen los clientes que no vuelven hace más de 6 meses, para invitarlos a una revisión.');
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => openClient(b.dataset.c));
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => { const c = store.client(b.dataset.wa); waClient('volver', { client: c, vehicle: store.vehiclesOf(c.id)[0] || null }); });
  }

  function saldos() {
    const list = store.debtors;
    $('#l-body').innerHTML = list.length ? `<div class="card"><div class="card-head"><div class="card-title">${icon('wallet')} Clientes con saldo</div><b>${usd(store.totalDebt)}</b></div><div class="list">${list.map((c) => `<div class="list-item">${avatar(c)}<div class="grow" style="min-width:0"><button class="linkish" data-c="${c.id}"><b>${esc(c.name)}</b></button><div class="t-sub">${esc(c.phone || '')}</div></div><b class="text-danger num">${usd(c.balance)}</b>${c.phone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${c.id}">${icon('whatsapp')}</button>` : ''}<button class="btn btn-primary btn-sm" data-pay="${c.id}">${icon('dollar')} Cobrar</button></div>`).join('')}</div></div>`
      : emptyState('checkCircle', 'Nadie debe', 'Lo que se deja a crédito (reparaciones grandes, flotas) queda aquí para cobrarlo después.');
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => openClient(b.dataset.c));
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => waClient('deuda', { client: store.client(b.dataset.wa) }));
    el.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => payDebtModal(store.client(b.dataset.pay)));
  }

  async function convenios() {
    $('#l-body').innerHTML = '<div class="empty"><div class="spinner"></div></div>';
    let sales = [];
    try { sales = await store.agreementSales(); } catch (e) { console.error(e); }
    if (tab !== 'convenios') return;
    const pending = sales.filter((s) => !s.agreementPaid);
    const by = {};
    for (const s of pending) (by[s.agreementId || '?'] ||= []).push(s);
    const ags = Object.entries(by);
    $('#l-body').innerHTML = !store.settings.agreements.length ? emptyState('handshake', 'Sin flotas ni convenios', 'Crea convenios con empresas, flotas o aseguradoras en Configuración: descuento y porcentaje que cubre.')
      : ags.length ? ags.map(([id, L]) => { const ag = store.agreement(id); const tot = L.reduce((a, s) => a + (s.agreementDue || 0), 0); return `<div class="card mt"><div class="card-head"><div class="card-title">${icon('handshake')} ${esc(ag?.name || L[0].agreementName || 'Convenio')}</div><div class="row" style="gap:6px"><b>${usd(tot)}</b><button class="btn btn-secondary btn-sm" data-pr="${id}">${icon('print')} Relación</button><button class="btn btn-primary btn-sm" data-st="${id}">${icon('check')} Marcar cobrado</button></div></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Factura</th><th>Fecha</th><th>Cliente / vehículo</th><th class="r">Total</th><th class="r">Cubre</th></tr></thead><tbody>${L.map((s) => `<tr><td><b>${esc(s.number)}</b></td><td>${fmtDate(s.date)}</td><td>${esc(s.memberName || '')}<div class="t-sub">${esc(s.plate || '')}</div></td><td class="r num">${usd(s.total)}</td><td class="r num"><b>${usd(s.agreementDue)}</b></td></tr>`).join('')}</tbody></table></div></div>`; }).join('')
        : emptyState('checkCircle', 'Todo cobrado', 'No hay montos pendientes por cobrar a flotas o convenios.');
    el.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => { const L = by[b.dataset.pr]; const ag = store.agreement(b.dataset.pr); printDoc(`Relación de cobro · ${ag?.name || ''}`, `<p>${esc(store.businessName)}${store.settings.rif ? ' · ' + esc(store.settings.rif) : ''}</p><table><thead><tr><th>Factura</th><th>Fecha</th><th>Cliente</th><th>Placa</th><th>N° afiliado</th><th class="r">Monto</th></tr></thead><tbody>${L.map((s) => { const c = store.client(s.memberId); return `<tr><td>${esc(s.number)}</td><td>${fmtDate(s.date)}</td><td>${esc(s.memberName || '')}</td><td>${esc(s.plate || '')}</td><td>${esc(c?.agreementNumber || '')}</td><td class="r">${usd(s.agreementDue)}</td></tr>`; }).join('')}</tbody></table><p class="r"><b>Total: ${usd(L.reduce((a, s) => a + s.agreementDue, 0))}</b></p><div class="sign"><div>Taller</div><div>Empresa / convenio</div></div>`); });
    el.querySelectorAll('[data-st]').forEach((b) => b.onclick = async () => {
      const L = by[b.dataset.st];
      const m = openModal({ title: 'Cobro del convenio', sub: `${L.length} factura(s) · ${usd(L.reduce((a, s) => a + s.agreementDue, 0))}`, size: 'sm', body: `<div class="stack"><div class="field"><label>Forma de pago</label><select class="select" data-m>${Object.entries(PAY_METHODS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div><div class="field"><label>Referencia</label><input class="input" data-n></div></div>`, footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Confirmar</button>` });
      m.el.querySelector('[data-ok]').onclick = async (e) => { setBusy(e.currentTarget, true); await settleAgreement(L, { method: m.el.querySelector('[data-m]').value, note: m.el.querySelector('[data-n]').value }); m.close(); toast('Marcado como cobrado'); convenios(); };
    });
  }

  function puntos() {
    const L = store.loyalty;
    const list = store.liveClients.filter((c) => Number(c.points) > 0).sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 100);
    $('#l-body').innerHTML = `<div class="card"><div class="small">${L.enabled ? `Programa activo: <b>1 punto por cada ${usd(L.per)}</b> de compra · cada punto vale <b>${usd(L.pointValue)}</b> · canje desde <b>${L.minRedeem} pts</b>.` : 'El programa de puntos está apagado.'} <button class="linkish" id="l-cfg">Configurar</button></div></div>
      ${list.length ? `<div class="card mt"><div class="list">${list.map((c) => `<div class="list-item">${avatar(c)}<div class="grow"><button class="linkish" data-c="${c.id}"><b>${esc(c.name)}</b></button><div class="t-sub">${c.visits || 0} visita(s)</div></div><span class="badge badge-violet">${icon('star')} ${Math.floor(c.points)} pts · ${usd(Math.floor(c.points) * L.pointValue)}</span>${c.phone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${c.id}">${icon('whatsapp')}</button>` : ''}</div>`).join('')}</div></div>` : emptyState('star', 'Aún nadie tiene puntos', 'Se suman solos al cobrarle a un cliente registrado.')}`;
    $('#l-cfg').onclick = () => navigate('ajustes', { tab: 'fidelidad' });
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => openClient(b.dataset.c));
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => waClient('puntos', { client: store.client(b.dataset.wa) }));
  }

  el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  draw();
  const off = store.on('*', (evt) => { if ((evt === 'clients' || evt === 'vehicles') && tab !== 'convenios') draw(); });
  return () => off();
}
