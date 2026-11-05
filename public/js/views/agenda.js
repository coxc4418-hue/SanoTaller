// SanoTaller — Agenda: citas por día y mecánico, vehículos que llegaron y recordatorios por WhatsApp
import { store } from '../store.js';
import { esc, todayKey, dayKey, addDays, fromKey, emptyState, openModal, toast, setBusy, confirmDialog } from '../utils.js';
import { icon } from '../icons.js';
import { SERVICES, APPT_STATUS, apptBadge, vehicleName } from '../taller.js';
import { saveAppt, setApptStatus, deleteAppt } from '../ops.js';
import { vehAvatar, plateHTML, pickVehicle, openVehicle, dueBadge } from '../client.js';
import { waClient } from '../shared.js';

const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const toHM = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const dayName = (k, opts = { weekday: 'short', day: 'numeric' }) => fromKey(k).toLocaleDateString('es', opts);
export function slotsFor(date) {
  const A = store.settings.agenda || {};
  const s = toMin(A.start || '07:30'), e = toMin(A.end || '17:30'), step = Math.max(10, Number(A.slot) || 30);
  const out = []; for (let t = s; t < e; t += step) out.push(toHM(t));
  return out;
}
const isWorkDay = (k) => (store.settings.agenda?.days || [1, 2, 3, 4, 5, 6]).includes(fromKey(k).getDay());

/** Formulario de cita (nueva o editar). pre: { vehicle, date, time, staffId, service } */
export function apptForm(a0 = null, pre = {}) {
  return new Promise((resolve) => {
    let saved = null;
    let pet = a0?.vehicleId ? store.vehicle(a0.vehicleId) : pre.vehicle || null;
    let service = a0?.service || pre.service || 'mantenimiento';
    let date = a0?.date || pre.date || todayKey();
    let time = a0?.time || pre.time || '';
    const m = openModal({
      title: a0 ? 'Editar cita' : 'Agendar cita', size: 'md',
      body: `<div class="stack">
        <div data-pet></div>
        <div class="chips chips-wrap" data-sv>${Object.entries(SERVICES).map(([k, v]) => `<button type="button" class="chip ${k === service ? 'on' : ''}" data-v="${k}">${icon(v.icon)} ${v.label}</button>`).join('')}</div>
        <div class="form-grid">
          <div class="field"><label>Día</label><input class="input" type="date" data-d value="${date}"></div>
          <div class="field"><label>Con</label><select class="select" data-st></select></div>
          <div class="field"><label>Duración (min)</label><input class="input" type="number" min="5" step="5" data-min value="${a0?.minutes || SERVICES[service].minutes}"></div>
          <div class="field"><label>Hora *</label><input class="input" type="time" data-t value="${time}"></div>
        </div>
        <div class="slots" data-slots></div>
        <div class="field"><label>Nota</label><input class="input" data-n value="${esc(a0?.note || '')}" placeholder="Ej.: cambio de aceite y filtro, ruido al frenar"></div>
        <div class="error-msg" data-err></div></div>`,
      footer: `${a0 ? `<button class="btn btn-ghost text-danger" data-del>${icon('trash')}</button>` : ''}<span class="grow"></span><button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} ${a0 ? 'Guardar' : 'Agendar'}</button>`,
      onClose: () => resolve(saved)
    });
    const q = (s) => m.el.querySelector(s);
    const drawPet = () => {
      q('[data-pet]').innerHTML = pet ? `<div class="list-item box">${vehAvatar(pet)}<div class="grow" style="min-width:0"><div class="row" style="gap:6px">${plateHTML(pet.plate, 'plate-sm')}<b class="ellipsis">${esc(vehicleName(pet))}</b></div><div class="t-sub">${esc(pet.ownerName || '')}${pet.ownerPhone ? ' · ' + esc(pet.ownerPhone) : ''}</div>${dueBadge(pet)}</div><button type="button" class="btn btn-ghost btn-sm" data-chg>${icon('refresh')} Cambiar</button></div>`
        : `<button type="button" class="btn btn-secondary btn-block" data-chg>${icon('search')} Elegir vehículo</button>`;
      q('[data-chg]').onclick = async () => { const p = await pickVehicle({ title: 'Vehículo de la cita' }); if (p) { pet = p; drawPet(); } };
    };
    const drawStaff = () => {
      const role = SERVICES[service]?.role || 'mecanico';
      const list = store.staffBy(role).length ? store.staffBy(role) : store.activeSellers;
      const cur = q('[data-st]').value || a0?.staffId || pre.staffId || '';
      q('[data-st]').innerHTML = `<option value="">Cualquiera</option>${list.map((s) => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
    };
    const drawSlots = () => {
      date = q('[data-d]').value || todayKey();
      const st = q('[data-st]').value; const dur = Number(q('[data-min]').value) || 30;
      const busy = store.apptsOn(date).filter((a) => a.id !== a0?.id && !['cancelada', 'no_vino'].includes(a.status) && (!st || a.staffId === st));
      const now = date === todayKey() ? new Date().getHours() * 60 + new Date().getMinutes() : -1;
      const sl = slotsFor(date);
      q('[data-slots]').innerHTML = !isWorkDay(date) ? '<div class="small muted">Ese día el taller no atiende según tu horario (puedes escribir la hora igual).</div>'
        : `<div class="small muted mb-xs">Horas libres${st ? '' : ' (de cualquier mecánico)'}:</div><div class="chips chips-wrap">${sl.map((t) => { const t0 = toMin(t); const taken = st ? busy.some((a) => t0 < toMin(a.time) + (Number(a.minutes) || 30) && toMin(a.time) < t0 + dur) : false; return `<button type="button" class="chip chip-sm ${t === q('[data-t]').value ? 'on' : ''}" data-tm="${t}" ${taken || t0 < now ? 'disabled' : ''}>${t}</button>`; }).join('')}</div>`;
      m.el.querySelectorAll('[data-tm]').forEach((b) => b.onclick = () => { q('[data-t]').value = b.dataset.tm; drawSlots(); });
    };
    m.el.querySelectorAll('[data-sv] [data-v]').forEach((b) => b.onclick = () => { service = b.dataset.v; m.el.querySelectorAll('[data-sv] [data-v]').forEach((y) => y.classList.toggle('on', y === b)); q('[data-min]').value = SERVICES[service].minutes; drawStaff(); drawSlots(); });
    q('[data-d]').onchange = drawSlots; q('[data-st]').onchange = drawSlots; q('[data-min]').onchange = drawSlots; q('[data-t]').onchange = drawSlots;
    drawPet(); drawStaff(); drawSlots();
    const go = async (btn, force = false) => {
      const err = q('[data-err]'); err.textContent = '';
      if (!pet) { err.textContent = 'Elige el vehículo.'; return; }
      if (!q('[data-t]').value) { err.textContent = 'Elige la hora.'; return; }
      setBusy(btn, true, 'Guardando…');
      try {
        saved = await saveAppt({ vehicleId: pet.id, service, date: q('[data-d]').value, time: q('[data-t]').value, minutes: q('[data-min]').value, staffId: q('[data-st]').value || null, note: q('[data-n]').value, force }, a0?.id || null);
        m.close();
        const s2 = { ...saved, serviceLabel: SERVICES[saved.service]?.label };
        toast(a0 ? 'Cita actualizada' : `Cita agendada: ${dayName(saved.date, { weekday: 'long', day: 'numeric', month: 'short' })} ${saved.time}`);
        if (!a0 && pet.ownerPhone) {
          const c = openModal({ title: 'Cita agendada', size: 'sm', body: `<p class="small">¿Le confirmas al cliente por WhatsApp?</p>`, footer: `<button class="btn btn-secondary" data-close>No</button><button class="btn btn-whatsapp" data-w>${icon('whatsapp')} Enviar confirmación</button>` });
          c.el.querySelector('[data-w]').onclick = () => { waClient('cita', { client: store.client(pet.ownerId), vehicle: pet, appt: s2 }); c.close(); };
        }
      } catch (ex) {
        setBusy(btn, false);
        if (ex.clash && await confirmDialog({ title: 'Horario ocupado', message: `${esc(ex.message)}<br>¿Agendar de todas formas?`, confirmText: 'Agendar igual' })) return go(btn, true);
        err.textContent = ex.message;
      }
    };
    q('[data-ok]').onclick = (e) => go(e.currentTarget);
    q('[data-del]')?.addEventListener('click', async () => { if (!(await confirmDialog({ title: 'Eliminar cita', message: 'Se borra de la agenda. Si el cliente avisó que no viene, mejor márcala como cancelada.', confirmText: 'Eliminar', danger: true }))) return; await deleteAppt(a0); saved = { removed: true }; m.close(); toast('Cita eliminada', 'warning'); });
  });
}

/** Menú de acciones de una cita */
export function apptMenu(a) {
  const p = a.vehicleId ? store.vehicle(a.vehicleId) : null; const sv = SERVICES[a.service] || SERVICES.mantenimiento;
  const m = openModal({
    title: `${a.time} · ${esc(a.plate)}`, sub: `${esc(a.vehicleName || '')} · ${esc(sv.label)}${a.staffName ? ' · ' + esc(a.staffName) : ''} · ${dayName(a.date, { weekday: 'long', day: 'numeric', month: 'long' })}`, size: 'sm',
    body: `<div class="stack"><div>${apptBadge(a.status)}</div>${a.note ? `<div class="small">${esc(a.note)}</div>` : ''}${p ? dueBadge(p) : ''}
      <div class="list">
        ${a.status !== 'atendida' && (p || a.service === 'lavado') ? `<button class="list-item" data-o="attend">${icon(a.service === 'lavado' ? 'spray' : 'wrench')}<div class="grow"><b>${a.service === 'lavado' ? 'Pasar al autolavado' : 'Recibir (abrir orden de trabajo)'}</b></div></button>` : ''}
        ${['pendiente', 'confirmada'].includes(a.status) ? `<button class="list-item" data-o="llego">${icon('door')}<div class="grow"><b>Llegó al taller</b></div></button>` : ''}
        ${a.status === 'pendiente' ? `<button class="list-item" data-o="confirmada">${icon('check')}<div class="grow"><b>Marcar confirmada</b></div></button>` : ''}
        <button class="list-item" data-o="wa">${icon('whatsapp')}<div class="grow"><b>Recordar por WhatsApp</b><div class="t-sub">Pide que confirme</div></div></button>
        ${p ? `<button class="list-item" data-o="pet">${icon('car')}<div class="grow"><b>Ficha del vehículo ${esc(p.plate)}</b></div></button>` : ''}
        <button class="list-item" data-o="edit">${icon('edit')}<div class="grow"><b>Cambiar día u hora</b></div></button>
        ${a.status !== 'no_vino' ? `<button class="list-item" data-o="no_vino">${icon('userX')}<div class="grow"><b>No vino</b></div></button>` : ''}
        ${a.status !== 'cancelada' ? `<button class="list-item" data-o="cancelada">${icon('x')}<div class="grow"><b>Cancelar cita</b></div></button>` : ''}
      </div></div>`,
    footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
  });
  m.el.querySelectorAll('[data-o]').forEach((b) => b.onclick = async () => {
    const o = b.dataset.o; m.close();
    if (o === 'attend') { if (a.service === 'lavado') { const { washForm } = await import('./wash.js'); washForm({ vehicle: p, appt: a }); } else { const { receiveForm } = await import('./jobs.js'); receiveForm(p, { appt: a }); } return; }
    if (o === 'wa') { waClient('cita_recordatorio', { client: store.client(a.ownerId), vehicle: p, appt: { ...a, serviceLabel: sv.label } }); return; }
    if (o === 'pet') { openVehicle(p.id, { tab: 'citas' }); return; }
    if (o === 'edit') { apptForm(a); return; }
    await setApptStatus(a, o); toast(APPT_STATUS[o]?.label || 'Listo');
  });
}

export function mount(el, { params = {} }) {
  let day = params.date || todayKey();
  let staff = '';
  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Agenda</h1><p class="view-sub" id="a-sub"></p></div>
    <div class="view-actions"><button class="btn btn-primary" id="a-new" data-tour="appt-new">${icon('plus')} Agendar cita</button></div></div>
    <div class="card card-flush">
      <div class="toolbar"><div class="row" style="gap:6px"><button class="btn btn-ghost btn-icon" id="a-prev" aria-label="Semana anterior">${icon('chevronLeft')}</button><button class="btn btn-secondary btn-sm" id="a-today">Hoy</button><button class="btn btn-ghost btn-icon" id="a-next" aria-label="Semana siguiente">${icon('chevronRight')}</button><input class="input input-sm" type="date" id="a-date" style="width:auto"></div>
        <select class="select select-sm" id="a-staff" style="width:auto"></select></div>
      <div class="week-strip" id="a-week" data-tour="week"></div>
      <div id="a-wait"></div>
      <div id="a-list" data-tour="agenda-list"></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  let extra = null; // citas de días fuera de la ventana escuchada
  async function ensure() {
    const lim = dayKey(addDays(new Date(), -7));
    if (day >= lim) { extra = null; return; }
    extra = await store.apptsBetween(day, day).catch(() => []);
  }
  const apptsOf = (k) => (extra && k === day ? extra : store.apptsOn(k)).filter((a) => !staff || a.staffId === staff).sort((a, b) => a.time.localeCompare(b.time));
  function draw() {
    $('#a-date').value = day;
    $('#a-staff').innerHTML = `<option value="">Todo el equipo</option>${store.activeSellers.map((s) => `<option value="${s.id}" ${s.id === staff ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
    const start = addDays(fromKey(day), -((fromKey(day).getDay() + 6) % 7));
    const week = [...Array(7)].map((_, i) => dayKey(addDays(start, i)));
    $('#a-week').innerHTML = week.map((k) => { const n = apptsOf(k).filter((a) => a.status !== 'cancelada').length; return `<button class="wday ${k === day ? 'on' : ''} ${k === todayKey() ? 'is-today' : ''} ${isWorkDay(k) ? '' : 'off'}" data-k="${k}"><span>${dayName(k, { weekday: 'short' })}</span><b>${fromKey(k).getDate()}</b><small>${n ? `${n} cita${n === 1 ? '' : 's'}` : '—'}</small></button>`; }).join('');
    el.querySelectorAll('[data-k]').forEach((b) => b.onclick = async () => { day = b.dataset.k; await ensure(); draw(); });
    const list = apptsOf(day);
    const live = list.filter((a) => a.status !== 'cancelada');
    $('#a-sub').textContent = `${dayName(day, { weekday: 'long', day: 'numeric', month: 'long' })} · ${live.length} cita(s)${day === todayKey() ? ` · ${store.waiting.length} ya llegaron` : ''}`;
    const wait = day === todayKey() ? store.waiting.filter((a) => !staff || a.staffId === staff) : [];
    $('#a-wait').innerHTML = wait.length ? `<div class="banner req-banner" style="margin:0 14px 10px"><span>${icon('door')} <b>Ya llegaron:</b> ${wait.map((a) => `${esc(a.plate)} (${esc(a.time)})`).join(', ')}</span></div>` : '';
    const sl = slotsFor(day);
    const taken = new Set(live.map((a) => a.time));
    const rows = [...new Set([...sl, ...list.map((a) => a.time)])].sort();
    $('#a-list').innerHTML = isWorkDay(day) || list.length ? `<div class="agenda">${rows.map((t) => {
      const here = list.filter((a) => a.time === t);
      const nowHM = toHM(Math.max(0, new Date().getHours() * 60 + new Date().getMinutes() - 30));
      if (!here.length) return taken.has(t) || day < todayKey() || (day === todayKey() && t < nowHM) ? '' : `<div class="ag-row ag-free"><span class="ag-time">${t}</span><button class="ag-add" data-new="${t}">${icon('plus')} Libre</button></div>`;
      return here.map((a) => { const sv = SERVICES[a.service] || SERVICES.mantenimiento; const p = a.vehicleId ? store.vehicle(a.vehicleId) : null; return `<div class="ag-row"><span class="ag-time">${a.time}</span><button class="ag-appt st-${a.status}" data-a="${a.id}" style="--c:${sv.color}">${p ? vehAvatar(p) : ''}<div class="grow" style="min-width:0"><div class="row" style="gap:6px">${plateHTML(a.plate, 'plate-sm')}<b class="ellipsis">${esc(a.vehicleName || '')}</b> <span class="t-sub">${esc(a.ownerName || '')}</span></div><div class="t-sub ellipsis">${icon(sv.icon)} ${esc(sv.label)} · ${a.minutes || 30} min${a.staffName ? ' · ' + esc(a.staffName) : ''}${a.note ? ' · ' + esc(a.note) : ''}</div></div>${apptBadge(a.status)}</button></div>`; }).join('');
    }).join('')}</div>` : emptyState('calendar', 'Día no laborable', 'Cambia los días de atención en Configuración › Agenda.');
    el.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => apptMenu(list.find((a) => a.id === b.dataset.a)));
    el.querySelectorAll('[data-new]').forEach((b) => b.onclick = () => apptForm(null, { date: day, time: b.dataset.new, staffId: staff || null }));
  }
  $('#a-new').onclick = () => apptForm(null, { date: day, staffId: staff || null });
  $('#a-prev').onclick = async () => { day = dayKey(addDays(fromKey(day), -7)); await ensure(); draw(); };
  $('#a-next').onclick = async () => { day = dayKey(addDays(fromKey(day), 7)); await ensure(); draw(); };
  $('#a-today').onclick = async () => { day = todayKey(); await ensure(); draw(); };
  $('#a-date').onchange = async (e) => { if (e.target.value) { day = e.target.value; await ensure(); draw(); } };
  $('#a-staff').onchange = (e) => { staff = e.target.value; draw(); };
  ensure().then(draw);
  const off = store.on('*', (evt) => { if (['appointments', 'vehicles', 'settings'].includes(evt)) draw(); });
  return () => off();
}
