// SanoTaller — Vehículos: lista con filtros por tipo y plan de mantenimiento, búsqueda por placa, importar y exportar
import { store } from '../store.js';
import { saveVehicle } from '../ops.js';
import { esc, normalize, debounce, emptyState, toast, download, toCSV, parseCSV, openModal, setBusy, todayKey, fmtDate, parseNum, num } from '../utils.js';
import { icon } from '../icons.js';
import { VTYPES, vtypeOf, vehicleName, FUELS, plateKey, estKm } from '../taller.js';
import { vehAvatar, plateHTML, openVehicle, vehicleForm, dueBadge, inShopBadge } from '../client.js';

const FILTERS = {
  all: ['Todos', () => true],
  taller: ['En el taller', (v) => !!store.jobOfVehicle(v.id)],
  due: ['Mantenimiento por tocar', (v) => store.dueFor(v).some((x) => x.soon)],
  late: ['Mantenimiento vencido', (v) => store.dueFor(v).some((x) => x.late)],
  noplan: ['Sin plan', (v) => !store.dueFor(v).length],
  garantia: ['En garantía', (v) => !!v.warrantyUntil && v.warrantyUntil >= todayKey()],
  control: ['Con revisión pendiente', (v) => !!v.nextControl && v.nextControl >= todayKey()],
  inactivos: ['Sin venir hace 6 meses', (v) => !v.lastVisitAt || (Date.now() - new Date(v.lastVisitAt)) > 182 * 864e5],
  baja: ['De baja', (v) => v.active === false]
};

export function mount(el, { params = {} }) {
  let filter = params.filter || 'all'; let q = ''; let sort = 'plate'; let tp = '';
  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Vehículos</h1><p class="view-sub" id="v-sub"></p></div>
    <div class="view-actions"><button class="btn btn-secondary" id="v-imp">${icon('upload')} Importar</button><button class="btn btn-secondary" id="v-exp">${icon('download')} Exportar</button><button class="btn btn-primary" id="v-new" data-tour="veh-new">${icon('plus')} Nuevo vehículo</button></div></div>
    <div class="card card-flush">
      <div class="toolbar"><label class="search">${icon('search')}<input id="v-q" placeholder="Placa, marca, modelo, dueño, teléfono o VIN…" autocapitalize="characters"></label>
        <div class="row" style="gap:6px"><select class="select select-sm" id="v-tp" style="width:auto"><option value="">Todos los tipos</option>${Object.entries(VTYPES).map(([k, v]) => `<option value="${k}">${v.emoji} ${v.label}</option>`).join('')}</select>
        <select class="select select-sm" id="v-sort" style="width:auto"><option value="plate">Placa</option><option value="due">Próximo mantenimiento</option><option value="recent">Última visita</option><option value="new">Recién registrados</option></select></div></div>
      <div class="chips" id="v-chips" data-tour="veh-filters" style="padding:0 14px 12px"></div>
      <div id="v-list"></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  const firstDue = (v) => store.dueFor(v)[0]?.urgency ?? 99999;
  const rows = () => {
    const t = normalize(q); const d = q.replace(/\D/g, ''); const pk = plateKey(q);
    const f = FILTERS[filter][1];
    const list = store.vehicles.filter((v) => (filter === 'baja' ? f(v) : v.active !== false && f(v)) && (!tp || (v.type || 'carro') === tp)
      && (!t || (pk.length >= 2 && plateKey(v.plate).includes(pk)) || normalize(`${v.plate} ${v.number || ''} ${v.ownerName || ''} ${v.brand || ''} ${v.model || ''} ${v.year || ''} ${v.color || ''} ${v.vin || ''}`).includes(t) || (d.length >= 4 && String(v.ownerPhone || '').replace(/\D/g, '').includes(d))));
    const S = {
      plate: (a, b) => (a.plate || '').localeCompare(b.plate || ''),
      due: (a, b) => firstDue(a) - firstDue(b),
      recent: (a, b) => (b.lastVisitAt || '').localeCompare(a.lastVisitAt || ''),
      new: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')
    };
    return list.sort(S[sort]);
  };
  function draw() {
    const live = store.liveVehicles;
    const byT = Object.keys(VTYPES).map((k) => [k, live.filter((v) => (v.type || 'carro') === k).length]).filter(([, n]) => n);
    $('#v-sub').textContent = `${live.length} vehículo(s) · ${byT.map(([k, n]) => `${n} ${VTYPES[k].label.toLowerCase()}${n === 1 ? '' : 's'}`).join(' · ')}`;
    $('#v-chips').innerHTML = Object.entries(FILTERS).map(([k, [l, fn]]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l} <span class="count">${k === 'baja' ? store.vehicles.filter(fn).length : live.filter(fn).length}</span></button>`).join('');
    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; draw(); });
    const list = rows();
    $('#v-list').innerHTML = list.length ? `<div class="table-wrap"><table class="table table-hover table-cards"><thead><tr><th>Vehículo</th><th class="hide-sm">Dueño</th><th>Mantenimiento</th><th class="hide-sm">Última visita</th></tr></thead><tbody>
      ${list.slice(0, 300).map((v) => `<tr data-id="${v.id}" style="cursor:pointer">
        <td><div class="row">${vehAvatar(v)}<div style="min-width:0"><div class="row" style="gap:6px">${plateHTML(v.plate, 'plate-sm')}<span class="t-name ellipsis">${esc(vehicleName(v))}</span></div><div class="t-sub ellipsis">${esc([v.color, v.km ? `${num(estKm(v, store.settings.kmPerDay), 0)} km` : '', v.fuel ? FUELS[v.fuel] : ''].filter(Boolean).join(' · '))}</div>${inShopBadge(v)}</div></div></td>
        <td class="hide-sm small"><b>${esc(v.ownerName || '')}</b><div class="t-sub">${esc(v.ownerPhone || '')}</div></td>
        <td>${v.active === false ? '<span class="badge badge-neutral">De baja</span>' : dueBadge(v)}</td>
        <td class="hide-sm small">${v.lastVisitAt ? fmtDate(v.lastVisitAt) : '<span class="faint">—</span>'}${(v.history || []).length ? `<div class="t-sub ellipsis" style="max-width:220px">${esc(v.history[v.history.length - 1].work || '')}</div>` : ''}</td></tr>`).join('')}
    </tbody></table></div>${list.length > 300 ? `<div class="small muted center" style="padding:10px">Mostrando 300 de ${list.length}. Usa la búsqueda.</div>` : ''}`
      : `<div style="padding:8px 16px 20px">${store.vehicles.length ? emptyState('car', 'Ningún vehículo en este filtro', q ? 'Prueba con otra búsqueda.' : '') : emptyState('car', 'Aún no hay vehículos', 'Registra el primero con “Nuevo vehículo” o impórtalos desde Excel (CSV).')}</div>`;
    el.querySelectorAll('[data-id]').forEach((r) => r.onclick = () => openVehicle(r.dataset.id));
  }
  $('#v-q').oninput = debounce((e) => { q = e.target.value; draw(); }, 100);
  $('#v-q').onkeydown = (e) => { if (e.key === 'Enter') { const v = store.findVehicle(e.target.value); if (v) openVehicle(v.id); } };
  $('#v-sort').onchange = (e) => { sort = e.target.value; draw(); };
  $('#v-tp').onchange = (e) => { tp = e.target.value; draw(); };
  $('#v-new').onclick = async () => { const r = await vehicleForm(); if (r) openVehicle(r.vehicle.id); };
  $('#v-exp').onclick = () => exportCSV(rows());
  $('#v-imp').onclick = () => importCSV();
  draw();
  const off = store.on('*', (evt) => { if (['vehicles', 'clients', 'jobs', 'settings'].includes(evt)) draw(); });
  return () => off();
}

function exportCSV(list) {
  const head = ['N°', 'Placa', 'Tipo', 'Marca', 'Modelo', 'Año', 'Color', 'Kilometraje', 'Combustible', 'Aceite', 'VIN', 'Dueño', 'Teléfono', 'Próximo mantenimiento', 'Próximo km', 'Próxima fecha', 'Visitas', 'Última visita', 'Ficha'];
  const data = list.map((v) => { const d = store.dueFor(v)[0]; return [v.number, v.plate, vtypeOf(v).label, v.brand || '', v.model || '', v.year || '', v.color || '', v.km || '', FUELS[v.fuel] || '', v.oil || '', v.vin || '', v.ownerName || '', v.ownerPhone || '', d?.name || '', d?.nextKm || '', d?.next || '', v.visits || 0, (v.lastVisitAt || '').slice(0, 10), v.cardCode || '']; });
  download(`vehiculos-${todayKey()}.csv`, toCSV([head, ...data]), 'text/csv;charset=utf-8');
  toast(`${data.length} vehículo(s) exportados`);
}

const T_ALIAS = { carro: 'carro', auto: 'carro', automovil: 'carro', sedan: 'carro', camioneta: 'camioneta', suv: 'camioneta', jeep: 'camioneta', pickup: 'pickup', 'pick-up': 'pickup', moto: 'moto', motocicleta: 'moto', camion: 'camion', van: 'van', bus: 'van', autobus: 'van' };
function importCSV() {
  const m = openModal({
    title: 'Importar vehículos', sub: 'Con su dueño, desde Excel guardado como CSV', size: 'md',
    body: `<div class="stack"><p class="small" style="margin:0">La primera fila debe tener los títulos. Se reconocen: <b>Placa</b> (obligatorio), <b>Tipo</b>, <b>Marca</b>, <b>Modelo</b>, <b>Año</b>, <b>Color</b>, <b>Kilometraje</b>, <b>VIN</b>, <b>Dueño</b> (obligatorio), <b>Teléfono</b>. Si el teléfono ya existe, el vehículo se agrega a ese cliente; las placas repetidas se saltan.</p>
      <input type="file" accept=".csv,text/csv" class="input" data-file><div data-prev></div><div class="error-msg" data-err></div></div>`,
    footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok disabled>${icon('upload')} Importar</button>`
  });
  let parsed = [];
  const pick = (h, ...keys) => h.findIndex((x) => keys.some((k) => normalize(x).includes(k)));
  m.el.querySelector('[data-file]').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rowsIn = parseCSV(await f.text()).filter((r) => r.some((x) => String(x).trim()));
    const h = rowsIn.shift() || [];
    const ix = { plate: pick(h, 'placa', 'matricula', 'patente'), type: pick(h, 'tipo'), brand: pick(h, 'marca'), model: pick(h, 'modelo'), year: pick(h, 'ano', 'año'), color: pick(h, 'color'), km: pick(h, 'kilomet', 'km'), vin: pick(h, 'vin', 'serial'), owner: pick(h, 'dueno', 'propietario', 'cliente', 'nombre'), phone: pick(h, 'telefono', 'celular', 'whatsapp') };
    if (ix.plate < 0 || ix.owner < 0) { m.el.querySelector('[data-err]').textContent = 'Necesito al menos las columnas “Placa” y “Dueño”.'; return; }
    parsed = rowsIn.map((r) => {
      const g = (k) => (ix[k] >= 0 ? String(r[ix[k]] ?? '').trim() : '');
      return { plate: g('plate'), type: T_ALIAS[normalize(g('type')).split(' ')[0]] || 'carro', brand: g('brand'), model: g('model'), year: g('year'), color: g('color'), km: parseNum(g('km')), vin: g('vin'), owner: { name: g('owner'), phone: g('phone') } };
    }).filter((x) => x.plate && x.owner.name);
    m.el.querySelector('[data-prev]').innerHTML = `<div class="box small"><b>${parsed.length}</b> vehículo(s) listos para importar.<div class="t-sub mt-xs">${parsed.slice(0, 4).map((x) => `${esc(x.plate)} (${esc(x.owner.name)})`).join(' · ')}${parsed.length > 4 ? '…' : ''}</div></div>`;
    m.el.querySelector('[data-ok]').disabled = !parsed.length;
  };
  m.el.querySelector('[data-ok]').onclick = async (e) => {
    const btn = e.currentTarget; setBusy(btn, true, 'Importando…');
    const owners = new Map(); let ok = 0;
    for (const x of parsed) {
      const k = x.owner.phone.replace(/\D/g, '').slice(-8) || normalize(x.owner.name);
      try { const { owner, ...data } = x; const r = await saveVehicle(data, null, owners.get(k) || owner); owners.set(k, r.owner); ok++; btn.textContent = `Importando ${ok}/${parsed.length}…`; } catch (err) { console.warn(err.message); }
    }
    m.close(); toast(`${ok} vehículo(s) importados`);
  };
}
