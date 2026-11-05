// SanoTaller — Vender: repuestos, lubricantes y servicios; cobro de órdenes de trabajo y del autolavado; equivalentes por referencia, planes y puntos
import { store } from '../store.js';
import { chargeSale, cartTotals, agreementCalc, pointsValue, orderLines, unitsByProduct, jobLines } from '../ops.js';
import { esc, usd, bs, num, toast, normalize, debounce, emptyState, parseNum, round2, promptDialog, openModal } from '../utils.js';
import { icon } from '../icons.js';
import { printReceipt, notifyLowStock, waClient } from '../shared.js';
import { openPay, showPaid } from '../pay.js';
import { pickVehicle, avatar, vehAvatar, plateHTML, pointsHTML, vehicleForm, dueBadge } from '../client.js';
import { PACKS, packsOf, packFactor, packPrice, packLabel, unitCost, stockText, upb, equivalents, searchText, productLine, nextExpiry, expBadge, lotsOf, vehicleName, vehicleLine } from '../taller.js';
import { requirePin } from '../auth.js';

const CAT_ICON = (c = '') => /aceite|lubric|aditiv|liquid/i.test(c) ? 'droplet' : /filtro/i.test(c) ? 'wind' : /freno/i.test(c) ? 'target' : /electric|bater|ilumin|encend/i.test(c) ? 'zap' : /cauch/i.test(c) ? 'gauge' : /lavado/i.test(c) ? 'spray' : /servic/i.test(c) ? 'wrench' : /accesor/i.test(c) ? 'star' : 'box';

export function mount(el, { params = {}, navigate }) {
  let tab = 'todos'; let search = '';
  let cart = []; let client = null; let pet = null; let jobId = null; let washId = null; let agreementId = null; let pointsUsed = 0; let order = null; let delivery = 0;
  let sellerId = store.activeSellers[0]?.id || null;

  el.innerHTML = `<div class="pos">
    <div class="pos-main">
      <div class="pos-head">
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <label class="search search-scan" style="flex:1;min-width:220px" data-tour="pos-search">${icon('barcode')}<input id="pos-search" placeholder="Escanea el código o busca repuesto, referencia, vehículo o servicio…" autocomplete="off" autofocus></label>
          <button class="btn btn-secondary" id="pos-ms" title="Servicios de taller y lavado">${icon('wrench')}<span class="hide-sm"> Servicio</span></button>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center" id="pos-seller"></div>
        <div class="chips" id="pos-tabs"></div>
      </div>
      <div class="pos-grid-wrap"><div class="plist" id="pos-grid"></div></div>
    </div>
    <div class="cart-backdrop" id="cart-bd"></div>
    <aside class="cart" id="cart">
      <div class="cart-head"><div class="between"><b style="font-size:16px">Venta</b><button class="btn btn-ghost btn-sm" id="c-clear">${icon('trash')} Vaciar</button></div>
        <div class="cart-ctx" id="c-ctx" data-tour="pos-client"></div></div>
      <div class="cart-list" id="c-list"></div>
      <div class="cart-foot">
        <div class="cart-extra" id="c-extra"></div>
        <div class="cart-grand"><span class="lbl">Total</span><div class="val"><b id="c-total">${usd(0)}</b><small id="c-fx" class="pay-fx"></small></div></div>
        <button class="btn btn-success btn-xl btn-block" id="c-pay" data-tour="pos-pay">${icon('check')} Cobrar <kbd class="hide-sm">F9</kbd></button>
      </div>
    </aside>
    <button class="cart-fab" id="cart-fab"><span><span class="cnt" id="fab-n">0</span>Ver venta</span><b id="fab-t">$ 0,00</b></button>
  </div>`;
  const $ = (s) => el.querySelector(s);
  const markup = () => Number(store.settings.fractionMarkup) || 0;
  const unitsInCart = (id) => unitsByProduct(cart).get(id) || 0;
  const avail = (p) => p.trackStock === false ? Infinity : (Number(p.stock) || 0) - unitsInCart(p.id);

  function renderSeller() {
    const s = store.activeSellers;
    $('#pos-seller').innerHTML = s.length ? `<span class="small muted">Atiende:</span>${s.map((x) => `<button class="chip ${sellerId === x.id ? 'on' : ''}" data-sl="${x.id}">${esc(x.name.split(' ')[0])}</button>`).join('')}` : '';
    el.querySelectorAll('[data-sl]').forEach((b) => b.onclick = () => { sellerId = b.dataset.sl; renderSeller(); });
  }
  function renderTabs() {
    const cats = [...new Set(store.sellable.map((p) => p.category).filter(Boolean))].sort();
    $('#pos-tabs').innerHTML = [['todos', 'Todos'], ['top', '★ Más vendidos'], ['servicios', 'Servicios'], ...(pet ? [['veh', 'Para este vehículo']] : []), ...cats.map((c) => ['c:' + c, c])]
      .map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" data-tab="${esc(k)}">${esc(l)}</button>`).join('');
    el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; renderTabs(); renderGrid(); });
  }

  function renderGrid() {
    const t = normalize(search);
    let list = store.sellable;
    if (t) list = list.filter((p) => searchText(p).includes(t));
    else if (tab === 'top') list = [...list].sort((a, b) => (Number(b.sold) || 0) - (Number(a.sold) || 0)).slice(0, 40);
    else if (tab === 'veh' && pet) { const ws = normalize(`${pet.brand || ''} ${pet.model || ''}`).split(' ').filter((w) => w.length > 2); list = list.filter((p) => p.fits && ws.some((w) => normalize(p.fits).includes(w))); }
    else if (tab === 'servicios') list = list.filter((p) => p.trackStock === false);
    else if (tab.startsWith('c:')) list = list.filter((p) => p.category === tab.slice(2));
    list = list.slice(0, 120);
    $('#pos-grid').innerHTML = list.length ? list.map((p) => {
      const st = Number(p.stock) || 0; const tracked = p.trackStock !== false;
      const n = unitsInCart(p.id); const out = tracked && avail(p) <= 0;
      const exp = nextExpiry(p);
      return `<button class="prow ${out ? 'is-out' : ''}" data-p="${p.id}" ${out ? 'aria-disabled="true"' : ''}>
        <span class="prow-ic">${icon(CAT_ICON(p.category))}</span>
        <span class="prow-body"><b class="prow-name">${esc(p.name)}</b><span class="prow-sub">${esc(productLine(p))}</span>
          <span class="prow-tags">${tracked ? `<span class="badge ${st <= 0 ? 'badge-danger' : st <= (p.minStock || 0) ? 'badge-warning' : 'badge-neutral'}">${st <= 0 ? 'Agotado' : stockText(p)}</span>` : ''}${exp ? expBadge(exp) : ''}${p.location ? `<span class="badge badge-neutral">${icon('pin')} ${esc(p.location)}</span>` : ''}</span></span>
        <span class="prow-price"><b>${usd(p.price)}</b>${upb(p) > 1 && packsOf(p).includes('unidad') ? `<small>und ${usd(packPrice(p, 'unidad', markup()))}</small>` : ''}${n ? `<span class="pcard-qty">${stockText(p, n)}</span>` : ''}</span>
      </button>`;
    }).join('') : emptyState('box', t ? 'Sin resultados' : 'Sin productos para vender', t ? 'Prueba con la marca, el componente o el código de barras.' : 'Carga tus productos y servicios en Inventario.');
    el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { const p = store.product(b.dataset.p); if (p) choose(p); });
  }

  /** Elegir presentación, ver lotes y equivalentes */
  function choose(p, { quick = false } = {}) {
    const packs = packsOf(p);
    if (avail(p) <= 0) {
      const eq = equivalents(p, store.products).filter((x) => avail(x) > 0);
      if (eq.length) return showEquivalents(p, eq, true);
      toast(`${p.name} está agotado.`, 'warning'); return;
    }
    if (quick || packs.length === 1) { add(p, 'caja'); return; }
    const eq = equivalents(p, store.products).filter((x) => avail(x) > 0).slice(0, 4);
    const lots = lotsOf(p).slice(0, 4);
    const m = openModal({
      title: esc(p.name), sub: esc(productLine(p)), size: 'md',
      body: `<div class="stack">
        ${p.fits ? `<div class="small muted">${icon('car')} Compatible con: <b>${esc(p.fits)}</b></div>` : ''}
        <div class="pack-grid">${packs.map((k) => { const f = packFactor(p, k); const can = avail(p) >= f; return `<button class="pack-btn" data-k="${k}" ${can ? '' : 'disabled'}><span>${esc(PACKS[k])}</span><small>${esc(packLabel(p, k))}</small><b>${usd(packPrice(p, k, markup()))}</b></button>`; }).join('')}</div>
        <div class="small muted">Disponible: <b>${stockText(p, avail(p))}</b>${p.location ? ` · Ubicación: <b>${esc(p.location)}</b>` : ''}</div>
        ${lots.length ? `<div><div class="section-title">${icon('layers')} Lotes</div><div class="lot-list">${lots.map((l) => `<span class="lot-chip">${esc(l.lot || 's/l')} · ${stockText(p, l.qty)} ${expBadge(l.exp)}</span>`).join('')}</div></div>` : ''}
        ${eq.length ? `<div><div class="section-title">${icon('refresh')} Equivalentes (misma referencia o medida)</div><div class="list">${eq.map((x) => `<button class="list-item" data-eq="${x.id}"><div class="grow" style="min-width:0"><b class="ellipsis">${esc(x.name)}</b><div class="t-sub">${esc(x.lab || '')}${x.active ? ' · Ref. ' + esc(x.active) : ''} · ${stockText(x)}</div></div><b class="num ${Number(x.price) / upb(x) < Number(p.price) / upb(p) ? 'text-success' : ''}">${usd(x.price)}</b></button>`).join('')}</div></div>` : ''}
      </div>`,
      footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
    });
    m.el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { add(p, b.dataset.k); m.close(); });
    m.el.querySelectorAll('[data-eq]').forEach((b) => b.onclick = () => { m.close(); choose(store.product(b.dataset.eq)); });
  }
  function showEquivalents(p, eq, outMsg = false) {
    const m = openModal({
      title: outMsg ? `${esc(p.name)} está agotado` : 'Equivalentes', sub: outMsg ? 'Ofrece un equivalente con la misma referencia o medida:' : esc(productLine(p)), size: 'md',
      body: `<div class="list">${eq.map((x) => `<button class="list-item" data-eq="${x.id}"><span class="prow-ic">${icon('box')}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(x.name)}</b><div class="t-sub">${esc(productLine(x))} · ${stockText(x)}</div></div><b class="num">${usd(x.price)}</b></button>`).join('')}</div>`,
      footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
    });
    m.el.querySelectorAll('[data-eq]').forEach((b) => b.onclick = () => { m.close(); choose(store.product(b.dataset.eq)); });
  }

  function add(p, pack = 'caja', qty = 1) {
    const f = packFactor(p, pack);
    if (avail(p) < f * qty) { toast(`Solo quedan ${stockText(p, Math.max(0, avail(p)))} de ${p.name}`, 'warning'); return; }
    const key = `${p.id}:${pack}`;
    const line = cart.find((l) => l.key === key);
    if (line) line.qty += qty;
    else {
      const price = packPrice(p, pack, markup());
      cart.push({ key, productId: p.id, name: p.name, pack, factor: f, qty, price, listPrice: price, cost: round2(unitCost(p) * f * 10000) / 10000, kind: 'producto', detail: packLabel(p, pack) });
    }
    renderAll();
  }
  function addService({ name, price, productId = null, detail = 'Servicio' }) {
    cart.push({ key: 'sv:' + Date.now() + Math.random(), productId, name, pack: 'caja', factor: 1, qty: 1, price: round2(price), listPrice: round2(price), cost: 0, kind: 'servicio', detail });
    renderAll();
  }

  function totals() {
    const t = cartTotals(cart);
    const ag = agreementId ? store.agreement(agreementId) : null;
    const agc = agreementCalc(ag, cart);
    const pts = pointsValue(pointsUsed);
    const total = round2(Math.max(0, t.subtotal - agc.discount - pts) + delivery);
    const covered = round2(Math.min(total, agc.covered));
    return { ...t, ag, agc, pts, total, covered, patient: round2(total - covered) };
  }

  function renderCtx() {
    const c = client;
    const L = store.loyalty;
    const ags = store.activeAgreements;
    const pets = c ? store.vehiclesOf(c.id).filter((x) => x.active !== false) : [];
    $('#c-ctx').innerHTML = (c ? `<div class="cart-client">${pet ? vehAvatar(pet) : avatar(c)}<div class="grow" style="min-width:0"><b class="ellipsis">${pet ? `${plateHTML(pet.plate, 'plate-sm')} ${esc(vehicleName(pet))} <span class="t-sub">· ${esc(c.name)}</span>` : esc(c.name)}</b><div class="t-sub ellipsis">${pet ? esc(vehicleLine(pet)) : esc(c.number)}</div></div><button class="btn btn-ghost btn-icon btn-sm" id="c-unpick" title="Quitar cliente">${icon('x')}</button></div>
      ${pets.length > 1 || (pets.length && !pet) ? `<div class="chips chips-wrap">${pets.map((x) => `<button class="chip chip-sm ${pet?.id === x.id ? 'on' : ''}" data-pp="${x.id}">${esc(x.plate)}</button>`).join('')}</div>` : ''}
      ${pet ? dueBadge(pet) : ''}
      ${jobId ? `<div class="badge badge-info">${icon('wrench')} Cobro de la orden ${esc(store.job(jobId)?.number || '')}</div>` : ''}${washId ? `<div class="badge badge-info">${icon('spray')} Cobro del lavado</div>` : ''}
      <div class="row" style="gap:4px;flex-wrap:wrap">${pointsHTML(c)}${(Number(c.balance) || 0) > 0.009 ? `<span class="badge badge-danger">debe ${usd(c.balance)}</span>` : ''}</div>`
      : `<div class="row" style="gap:6px"><button class="btn btn-secondary btn-sm grow" id="c-pt">${icon('car')} Vehículo / cliente (placa, puntos, plan)</button><button class="btn btn-ghost btn-icon btn-sm" id="c-new" title="Vehículo nuevo">${icon('plus')}</button></div>`)
      + (order ? `<div class="badge badge-info mt-xs">${icon('bag')} Pedido en línea de ${esc(order.name)}${order.delivery ? ' · delivery' : ''}</div>` : '')
      + (ags.length ? `<select class="select select-sm mt-xs" id="c-ag"><option value="">Sin plan / convenio</option>${ags.map((a) => `<option value="${a.id}" ${agreementId === a.id ? 'selected' : ''}>${esc(a.name)}${a.discount ? ` · -${a.discount}%` : ''}${a.coverage ? ` · cubre ${a.coverage}%` : ''}</option>`).join('')}</select>` : '')
      + (c && L.enabled && Number(c.points) >= (Number(L.minRedeem) || 0) && Number(c.points) > 0 ? `<label class="check mt-xs"><input type="checkbox" id="c-pts" ${pointsUsed ? 'checked' : ''}> <span>Canjear ${Math.floor(c.points)} pts (−${usd(pointsValue(Math.floor(c.points)))})</span></label>` : '');
    $('#c-pt')?.addEventListener('click', pick);
    $('#c-new')?.addEventListener('click', async () => { const r = await vehicleForm(); if (r) setPet(r.vehicle, r.owner); });
    $('#c-unpick')?.addEventListener('click', () => { client = null; pet = null; pointsUsed = 0; agreementId = null; renderAll(); });
    el.querySelectorAll('[data-pp]').forEach((b) => b.onclick = () => { pet = store.vehicle(b.dataset.pp); renderAll(); });
    $('#c-ag')?.addEventListener('change', (e) => { agreementId = e.target.value || null; renderCart(); });
    $('#c-pts')?.addEventListener('change', (e) => { pointsUsed = e.target.checked ? Math.floor(Number(client.points) || 0) : 0; renderCart(); });
  }

  function renderCart() {
    renderCtx();
    const T = totals();
    $('#c-list').innerHTML = cart.length ? cart.map((l, i) => {
      const p = l.productId ? store.product(l.productId) : null;
      const packs = p ? packsOf(p) : [];
      return `<div class="cline">
        <div class="cline-name">${esc(l.name)}</div><div class="cline-total">${usd(l.price * l.qty)}</div>
        <div class="cline-meta"><button class="linkish" data-price="${i}">${usd(l.price)} c/u ${icon('edit')}</button>
          ${packs.length > 1 ? `<select class="select select-xs" data-pk="${i}">${packs.map((k) => `<option value="${k}" ${l.pack === k ? 'selected' : ''}>${esc(packLabel(p, k))}</option>`).join('')}</select>` : `<span class="t-sub">${esc(l.detail || '')}</span>`}</div>
        <div class="cline-actions"><div class="stepper"><button data-dec="${i}" aria-label="Menos">${icon('minus')}</button><span>${num(l.qty, 0)}</span><button data-inc="${i}" aria-label="Más">${icon('plus')}</button></div>
          ${p && equivalents(p, store.products).length ? `<button class="btn btn-ghost btn-icon btn-sm" data-eq="${i}" title="Equivalentes">${icon('refresh')}</button>` : ''}
          <button class="btn btn-ghost btn-icon btn-sm" data-del="${i}" aria-label="Quitar">${icon('x')}</button></div>
      </div>`;
    }).join('') : `<div class="empty">${icon('barcode')}<b>Escanea o busca un producto</b><span>Pasa el lector por el código de barras o escribe el nombre. Puedes vender la caja completa o por unidad, el aceite por litro y agregar servicios.</span></div>`;

    $('#c-extra').innerHTML = cart.length ? `
      <div class="between small"><span class="muted">Subtotal</span><b>${usd(T.subtotal)}</b></div>
      ${T.agc.discount ? `<div class="between small"><span class="muted">Descuento ${esc(T.ag.name)}</span><b class="text-success">−${usd(T.agc.discount)}</b></div>` : ''}
      ${T.pts ? `<div class="between small"><span class="muted">Puntos canjeados</span><b class="text-success">−${usd(T.pts)}</b></div>` : ''}
      ${delivery ? `<div class="between small"><span class="muted">Delivery</span><b>${usd(delivery)}</b></div>` : ''}
      ${T.covered ? `<div class="between small"><span class="muted">Cubre ${esc(T.ag.name)}</span><b>−${usd(T.covered)}</b></div>` : ''}` : '';
    $('#c-total').textContent = usd(T.patient);
    $('#c-fx').textContent = bs(T.patient);
    $('#fab-n').textContent = cart.length; $('#fab-t').textContent = usd(T.patient);
    $('#c-pay').disabled = !cart.length;

    const L = (i) => cart[+i];
    el.querySelectorAll('[data-inc]').forEach((b) => b.onclick = () => { const l = L(b.dataset.inc); const p = store.product(l.productId); if (p && avail(p) < l.factor) { toast(`Solo quedan ${stockText(p, Math.max(0, avail(p)))}`, 'warning'); return; } l.qty += 1; renderAll(); });
    el.querySelectorAll('[data-dec]').forEach((b) => b.onclick = () => { const l = L(b.dataset.dec); l.qty -= 1; if (l.qty <= 0) cart.splice(+b.dataset.dec, 1); renderAll(); });
    el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { cart.splice(+b.dataset.del, 1); renderAll(); });
    el.querySelectorAll('[data-pk]').forEach((s) => s.onchange = () => {
      const l = L(s.dataset.pk); const p = store.product(l.productId);
      const f = packFactor(p, s.value);
      if (avail(p) + l.factor * l.qty < f * l.qty) { toast('No alcanza el inventario para esa presentación', 'warning'); s.value = l.pack; return; }
      Object.assign(l, { pack: s.value, factor: f, key: `${p.id}:${s.value}`, price: packPrice(p, s.value, markup()), listPrice: packPrice(p, s.value, markup()), cost: unitCost(p) * f, detail: packLabel(p, s.value) });
      renderAll();
    });
    el.querySelectorAll('[data-eq]').forEach((b) => b.onclick = () => { const p = store.product(L(b.dataset.eq).productId); showEquivalents(p, equivalents(p, store.products)); });
    el.querySelectorAll('[data-price]').forEach((b) => b.onclick = async () => {
      const l = L(b.dataset.price);
      if (!(await requirePin('Cambiar un precio'))) return;
      const v = await promptDialog({ title: 'Precio', label: `${l.name} · ${l.detail || ''}`, value: num(l.price), confirmText: 'Aplicar' });
      if (v != null && parseNum(v) >= 0) { l.price = round2(parseNum(v)); renderCart(); }
    });
  }
  const renderAll = () => { renderCart(); renderGrid(); };

  async function pick() { const p = await pickVehicle({ title: '¿Para qué vehículo es?' }); if (p) setPet(p); }
  function setClient(c) {
    client = c;
    if (c.agreementId && store.agreement(c.agreementId)?.active !== false) agreementId = c.agreementId;
    if (pet && pet.ownerId !== c.id) pet = null;
    if (!pet) { const ps = store.vehiclesOf(c.id).filter((x) => x.active !== false); if (ps.length === 1) pet = ps[0]; }
    renderAll();
  }
  function setPet(p, owner = null) {
    pet = p;
    const c = owner || store.client(p.ownerId);
    if (c) setClient(c); else renderAll();
  }

  function askCredit(total) {
    return new Promise((resolve) => {
      let out = null;
      const m = openModal({
        title: 'Forma de cobro', sub: `${esc(client.name)} · ${usd(total)}`, size: 'sm',
        body: `<div class="stack"><button class="btn btn-primary btn-lg btn-block" data-full>${icon('cash')} Paga completo ahora</button>
          <div class="box"><div class="field"><label>Queda a deber (crédito)</label><input class="input" inputmode="decimal" data-amt placeholder="Monto pendiente"></div><button class="btn btn-secondary btn-block" data-part>${icon('wallet')} Registrar con saldo pendiente</button><div class="hint">Queda en su ficha para cobrarlo después.</div></div></div>`,
        footer: '<button class="btn btn-secondary" data-close>Cancelar</button>',
        onClose: () => resolve(out)
      });
      m.el.querySelector('[data-full]').onclick = () => { out = 0; m.close(); };
      m.el.querySelector('[data-part]').onclick = () => {
        const v = round2(parseNum(m.el.querySelector('[data-amt]').value) || 0);
        if (!(v > 0)) { toast('Indica el monto pendiente', 'warning'); return; }
        out = Math.min(v, total); m.close();
      };
    });
  }

  async function pay() {
    if (!cart.length) return;
    const lines = cart.map(({ key, ...l }) => l);
    const T = totals();
    let credit = 0;
    if (client && T.patient > 0.004) { const c = await askCredit(T.patient); if (c == null) return; credit = c; }
    const amount = round2(T.patient - credit);
    const run = async (res = { payments: [], discount: 0, print: false }) => {
      const out = await chargeSale({ lines, client, vehicle: pet, discount: res.discount, payments: res.payments, credit, agreementId, pointsUsed, sellerId, orderId: order?.id || null, delivery, jobId, washId });
      if (res.print) printReceipt(out.sale);
      return out;
    };
    let out;
    try {
      out = amount > 0.004
        ? await openPay({ title: 'Cobrar', sub: esc(client?.name || 'Cliente de mostrador'), amount, baseTotal: amount, discount: true, printLabel: 'Imprimir factura / ticket', onConfirm: async (r) => { if (r.discount > 0 && !(await requirePin('Aplicar un descuento'))) throw new Error('Descuento no autorizado.'); return run(r); } })
        : await run();
    } catch (e) { toast(e.message, 'danger', 5000); return; }
    if (!out) return;
    notifyLowStock(out.low);
    showPaid(out.sale, { title: 'Venta registrada', onPrint: () => printReceipt(out.sale) });
    const cl = out.client;
    const pt = pet;
    if (cl?.phone) setTimeout(() => offerThanks(cl, out.sale, pt), 300);
    reset();
    if (params.orderId || params.clientId || params.vehicleId || params.jobId || params.washId) navigate('vender', { replace: true, force: true });
  }

  function offerThanks(cl, sale, pt) {
    const m = openModal({
      title: 'Mensaje al cliente', sub: esc(cl.name), size: 'sm',
      body: `<p class="small">Envíale su comprobante${store.loyalty.enabled ? ', sus puntos' : ''}${pt?.cardCode ? ` y la ficha del ${esc(pt.plate)}` : ''} por WhatsApp.</p>${pointsHTML(cl)}`,
      footer: `<button class="btn btn-secondary" data-close>Ahora no</button><button class="btn btn-whatsapp" data-wa>${icon('whatsapp')} Enviar</button>`
    });
    m.el.querySelector('[data-wa]').onclick = () => { waClient('gracias', { client: cl, sale, vehicle: pt ? store.vehicle(pt.id) || pt : null }); m.close(); };
  }

  function serviceModal() {
    const svcs = store.products.filter((p) => p.active !== false && p.trackStock === false).sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name, 'es'));
    const m = openModal({
      title: 'Servicios', sub: 'Mano de obra, alineación, lavado… se cobran junto con la venta', size: 'sm',
      body: `<div class="list">${svcs.map((p) => `<button class="list-item" data-id="${p.id}">${icon(/lavado/i.test(p.category || '') ? 'spray' : 'wrench')}<div class="grow"><b>${esc(p.name)}</b><div class="t-sub">${esc(p.category || '')}</div></div><b class="num">${usd(p.price)}</b></button>`).join('')}<button class="list-item" data-other>${icon('plus')}<div class="grow"><b>Otro servicio</b><div class="t-sub">Escribe el nombre y el precio</div></div></button></div>`,
      footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
    });
    m.el.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { const p = store.product(b.dataset.id); m.close(); addService({ name: p.name, price: Number(p.price) || 0, productId: p.id, detail: p.category || 'Servicio' }); });
    m.el.querySelector('[data-other]').onclick = async () => {
      m.close();
      const n = await promptDialog({ title: 'Servicio', label: 'Nombre', value: '' }); if (!n) return;
      const v = await promptDialog({ title: n, label: 'Precio', value: '', confirmText: 'Agregar' }); if (v == null) return;
      addService({ name: n, price: parseNum(v) });
    };
  }

  function reset() { cart = []; client = null; pet = null; jobId = null; washId = null; agreementId = null; pointsUsed = 0; order = null; delivery = 0; closeCart(); renderAll(); setTimeout(() => $('#pos-search')?.focus(), 50); }
  const openCart = () => { $('#cart').classList.add('open'); $('#cart-bd').classList.add('open'); };
  const closeCart = () => { $('#cart').classList.remove('open'); $('#cart-bd').classList.remove('open'); };
  $('#cart-fab').onclick = openCart; $('#cart-bd').onclick = closeCart;
  $('#c-pay').onclick = pay;
  $('#c-clear').onclick = reset;
  $('#pos-ms').onclick = serviceModal;
  const sInp = $('#pos-search');
  sInp.oninput = debounce((e) => { search = e.target.value; renderGrid(); }, 90);
  sInp.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const v = sInp.value.trim(); if (!v) return;
    const exact = store.byBarcode(v);
    if (exact) { choose(exact, { quick: true }); sInp.value = ''; search = ''; renderGrid(); return; }
    const pp = store.findVehicle(v);
    if (pp) { setPet(pp); sInp.value = ''; search = ''; renderGrid(); toast(`Vehículo: ${pp.plate}`, 'info'); return; }
    const c = /^C-?\d+$/i.test(v) ? store.findClient(v) : null;
    if (c) { setClient(c); sInp.value = ''; search = ''; renderGrid(); toast(`Cliente: ${c.name}`, 'info'); return; }
    const list = store.sellable.filter((p) => searchText(p).includes(normalize(v)));
    if (list.length === 1) { choose(list[0]); sInp.value = ''; search = ''; renderGrid(); }
  };
  const onKey = (e) => { if (e.key === 'F9') { e.preventDefault(); pay(); } };
  window.addEventListener('keydown', onKey);

  // ---------- Viene desde un pedido en línea o desde una orden o el autolavado ----------
  if (params.orderId) {
    const o = store.orders.find((x) => x.id === params.orderId);
    if (o) {
      order = o;
      cart = orderLines(o).map((l) => ({ ...l, key: `${l.productId}:caja` }));
      client = (o.clientId && store.client(o.clientId)) || store.findByPhone(o.phone) || null;
      if (client?.agreementId) agreementId = client.agreementId;
      delivery = o.delivery ? round2(Number(o.deliveryFee) || 0) : 0;
      const missing = (o.items || []).length - cart.length;
      if (missing > 0) toast(`${missing} producto(s) del pedido ya no están en el catálogo.`, 'warning');
    }
  } else if (params.vehicleId || params.clientId || params.jobId || params.washId) {
    const p = params.vehicleId ? store.vehicle(params.vehicleId) : null;
    const c = store.client(params.clientId || p?.ownerId);
    if (p) setPet(p, c); else if (c) setClient(c);
    if (params.washId) {
      const w = store.washes.find((x) => x.id === params.washId);
      if (w && !w.charged) { washId = w.id; addService({ name: `Lavado ${w.plate}: ${(w.types || []).join(', ') || 'servicio'}`, price: Number(w.price) || 0, detail: 'Autolavado' }); }
      else if (w?.charged) toast('Ese lavado ya se cobró.', 'info');
    }
    if (params.jobId) {
      store.getJob(params.jobId).then((jb) => {
        if (!jb || jb.charged) { if (jb?.charged) toast('Esa orden ya se cobró.', 'info'); return; }
        jobId = jb.id;
        if (!pet && jb.vehicleId) { const v = store.vehicle(jb.vehicleId); if (v) setPet(v); }
        for (const l of jobLines(jb)) cart.push({ ...l, key: `j:${Math.random()}` });
        renderAll();
      }).catch((e) => console.error(e));
    }
  }
  renderSeller(); renderTabs(); renderAll();
  const off = store.on('*', (evt) => {
    if (evt === 'products') { renderTabs(); renderAll(); }
    if (evt === 'settings') { renderSeller(); renderTabs(); renderAll(); }
    if (evt === 'clients' && client?.id) { const fresh = store.client(client.id); if (fresh) { client = fresh; renderCtx(); } }
    if (evt === 'vehicles' && pet?.id) { const fresh = store.vehicle(pet.id); if (fresh) { pet = fresh; renderCtx(); } }
  });
  return () => { off(); window.removeEventListener('keydown', onKey); };
}
