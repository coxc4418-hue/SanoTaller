// SanoTaller — Búsqueda global (Ctrl + K): vehículos por placa, órdenes, clientes, repuestos, facturas y pedidos
import { store, clientBadge, orderBadge } from '../store.js';
import { openModal, esc, usd, normalize, debounce } from '../utils.js';
import { icon } from '../icons.js';
import { avatar, clientLine, vehAvatar, plateHTML, dueBadge, inShopBadge } from '../client.js';
import { searchText, productLine, stockText, vehicleName, vehicleLine, jobBadge, plateKey } from '../taller.js';

export function openSearch() {
  if (document.querySelector('.search-modal')) return;
  const m = openModal({
    size: 'lg',
    body: `<div class="search search-big">${icon('search')}<input data-q placeholder="Placa, cliente, teléfono, repuesto, referencia, orden (OT-00012) o factura…" autofocus autocomplete="off"><kbd>Esc</kbd></div><div data-res class="search-results"></div>`
  });
  m.el.querySelector('.modal').classList.add('search-modal');
  const input = m.el.querySelector('[data-q]');
  const res = m.el.querySelector('[data-res]');
  let token = 0;
  const go = async (route, params = {}) => { m.close(); (await import('../main.js')).navigate(route, { params, force: true }); };

  async function run() {
    const raw = input.value.trim();
    const t = normalize(raw);
    const digits = raw.replace(/\D/g, '');
    const my = ++token;
    if (!t) { res.innerHTML = hint(); return; }
    const bc = store.byBarcode(raw);
    const prods = [...(bc ? [bc] : []), ...store.products.filter((p) => p !== bc && searchText(p).includes(t))].slice(0, 8);
    const exact = store.findClient(raw);
    const cls = [...(exact ? [exact] : []), ...store.clients.filter((p) => p !== exact && (normalize(`${p.name} ${p.number} ${p.email || ''} ${p.cardCode || ''} ${p.idDoc || ''}`).includes(t)
      || (digits.length >= 3 && (`${p.phone || ''}`.replace(/\D/g, '').includes(digits) || `${p.idDoc || ''}`.replace(/\D/g, '').includes(digits)))))].slice(0, 6);
    const ep = store.findVehicle(raw); const pk = plateKey(raw);
    const pets = [...(ep ? [ep] : []), ...store.vehicles.filter((p) => p !== ep && p.active !== false && ((pk.length >= 2 && plateKey(p.plate).includes(pk)) || normalize(`${p.brand || ''} ${p.model || ''} ${p.number || ''} ${p.ownerName || ''} ${p.vin || ''} ${p.color || ''}`).includes(t) || (digits.length >= 4 && String(p.ownerPhone || '').replace(/\D/g, '').includes(digits))))].slice(0, 8);
    const jobs = store.jobs.filter((j) => normalize(`${j.number} ${j.plate} ${j.ownerName || ''} ${j.complaint || ''}`).includes(t) || (pk.length >= 3 && plateKey(j.plate).includes(pk))).slice(0, 5);
    const orders = store.orders.filter((o) => normalize(`${o.name} ${o.number || ''} ${o.phone || ''}`).includes(t)).slice(0, 4);
    const sales = store.recentSales.filter((s) => normalize(`${s.number} ${s.memberName || ''}`).includes(t)).slice(0, 5);
    draw(prods, cls, orders, sales, pets, jobs);
    const up = raw.toUpperCase().replace(/\s/g, '');
    const pre = (store.settings.invoicePrefix || 'F').toUpperCase();
    if (!new RegExp(`^${pre}-?\\d+$`).test(up)) return;
    const num = `${pre}-` + up.replace(/\D/g, '').padStart(6, '0');
    let found = [];
    try { found = await store.listEq('sales', 'number', num); } catch (_) {}
    if (my !== token) return;
    const extra = found.filter((s) => !sales.some((x) => x.id === s.id));
    if (extra.length) draw(prods, cls, orders, [...extra, ...sales], pets, jobs);
  }

  function hint() {
    return `<div class="empty">${icon('search')}<b>Busca en todo el taller</b><span>Busca un vehículo por su placa, modelo o el nombre del dueño; una orden por su número; un repuesto por nombre, referencia o código de barras; o una factura.</span></div>`;
  }

  function draw(prods, cls, orders, sales, pets = [], jobs = []) {
    res.innerHTML = (prods.length || cls.length || orders.length || sales.length || pets.length || jobs.length) ? `
      ${pets.length ? `<div class="section-title">Vehículos</div>${pets.map((p) => `<button class="sitem" data-pt="${p.id}">${vehAvatar(p)}<div class="grow" style="min-width:0"><div class="row" style="gap:6px">${plateHTML(p.plate, 'plate-sm')}<b class="ellipsis">${esc(vehicleName(p))}</b></div><div class="t-sub ellipsis">${esc(vehicleLine(p))} · ${esc(p.ownerName || '')}</div></div>${inShopBadge(p) || dueBadge(p)}</button>`).join('')}` : ''}
      ${jobs.length ? `<div class="section-title">Órdenes de trabajo</div>${jobs.map((j) => `<button class="sitem" data-j="${j.id}">${icon('wrench')}<div class="grow" style="min-width:0"><b>${esc(j.number)}</b> ${plateHTML(j.plate, 'plate-sm')}<div class="t-sub ellipsis">${esc(j.vehicleName || '')} · ${esc(j.complaint || '')}</div></div>${jobBadge(j.status)}</button>`).join('')}` : ''}
      ${prods.length ? `<div class="section-title">Repuestos y servicios</div>${prods.map((p) => `<button class="sitem" data-p="${p.id}"><span class="kpi-icon tone-brand" style="width:36px;height:36px">${icon(p.trackStock === false ? 'wrench' : 'box')}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(p.name)}</b><div class="t-sub ellipsis">${esc(productLine(p))} · ${(Number(p.stock) || 0) > 0 ? stockText(p) : '<span class="text-danger">agotado</span>'}${p.location ? ` · ${esc(p.location)}` : ''}</div></div><b class="num">${usd(p.price)}</b></button>`).join('')}` : ''}
      ${cls.length ? `<div class="section-title">Clientes</div>${cls.map((c) => `<button class="sitem" data-m="${c.id}">${avatar(c)}<div class="grow" style="min-width:0"><b class="ellipsis">${esc(c.name)}</b><div class="t-sub ellipsis">${esc(c.number)}${c.idDoc ? ' · ' + esc(c.idDoc) : ''} · ${clientLine(c)}</div></div>${clientBadge(store.clientStatus(c))}</button>`).join('')}` : ''}
      ${orders.length ? `<div class="section-title">Pedidos en línea</div>${orders.map((o) => `<button class="sitem" data-o="${o.id}">${icon('bag')}<div class="grow"><b>${esc(o.name)}</b><div class="t-sub">${esc(o.number || '')} · ${(o.items || []).length} producto(s)</div></div>${orderBadge(o.status || 'nueva')}<b class="num">${usd(o.total || 0)}</b></button>`).join('')}` : ''}
      ${sales.length ? `<div class="section-title">Facturas</div>${sales.map((s) => `<button class="sitem" data-s="${esc(s.number)}">${icon('receipt')}<div class="grow"><b>${esc(s.number)}</b><div class="t-sub">${esc(s.memberName || 'Cliente de mostrador')}</div></div><b class="num">${usd(s.total)}</b></button>`).join('')}` : ''}`
      : `<div class="empty">${icon('search')}<b>Sin resultados</b><span>Prueba con parte de la placa, el nombre, el teléfono del cliente o la marca.</span></div>`;
    res.querySelectorAll('[data-pt]').forEach((b) => b.onclick = async () => { m.close(); (await import('../client.js')).openVehicle(b.dataset.pt); });
    res.querySelectorAll('[data-j]').forEach((b) => b.onclick = async () => { m.close(); (await import('./jobs.js')).openJob(b.dataset.j); });
    res.querySelectorAll('[data-m]').forEach((b) => b.onclick = async () => { m.close(); (await import('../client.js')).openClient(b.dataset.m); });
    res.querySelectorAll('[data-p]').forEach((b) => b.onclick = async () => { m.close(); (await import('./inventory.js')).openProduct(b.dataset.p); });
    res.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => go('pedidos'));
    res.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => go('facturas', { q: b.dataset.s }));
  }

  input.oninput = debounce(run, 140);
  input.onkeydown = (e) => { if (e.key === 'Enter') { const first = res.querySelector('.sitem'); if (first) first.click(); } };
  res.innerHTML = hint();
}
