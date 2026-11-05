// SanoTaller — Configuración del taller: datos, equipo y comisiones, plan de mantenimiento, autolavado, agenda, convenios, pedidos en línea, puntos y seguridad
import { store, updateTenant, getShop } from '../store.js';
import { requirePin, changePassword, authErrorMessage, session } from '../auth.js';
import { esc, num, toast, parseNum, setBusy, toggleTheme, download, nowISO, round2, openModal, shortId, confirmDialog, emptyState, loc, flagImg, usd } from '../utils.js';
import { icon } from '../icons.js';
import { openCountryPicker, salesWa, SALES_PHONE_FMT, qrDataURL } from '../shared.js';
import { isStandalone, bindInstallButtons } from '../install.js';
import { CATEGORIES, STAFF_ROLES, MAINT_DEFAULT, WASH_TYPES_DEFAULT } from '../taller.js';
import { slugify, publishShop, resetPublished, shopUrl } from '../ops.js';

const SECTIONS = { farmacia: 'Taller', vendedores: 'Equipo', vacunas: 'Mantenimiento y agenda', moneda: 'Moneda y precios', convenios: 'Flotas y convenios', pedidos: 'Pedidos en línea', fidelidad: 'Puntos y alertas', recibos: 'Facturas', seguridad: 'Seguridad', apps: 'Instalar y respaldo' };
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const sw = (name, on, title, sub) => `<label class="check box box-white"><span class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span></span></span><span><b>${title}</b><br><small class="muted">${sub}</small></span></label>`;
const save = (t) => `<div class="row" style="justify-content:flex-end"><button class="btn btn-primary">${icon('check')} ${t || 'Guardar'}</button></div>`;

export function mount(el, { params = {} }) {
  let sec = SECTIONS[params.tab || params.sec] ? (params.tab || params.sec) : 'farmacia';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Configuración</h1><p class="view-sub">Datos del taller, equipo, plan de mantenimiento, autolavado y agenda, moneda, convenios, catálogo en línea, puntos, facturas y seguridad.</p></div></div>
    <div class="tabs">${Object.entries(SECTIONS).map(([k, v]) => `<button data-s="${k}">${v}</button>`).join('')}</div>
    <div id="s-body" class="mt" style="max-width:980px"></div>`;
  const $ = (q) => el.querySelector(q);
  const s = () => store.settings;

  function render() {
    el.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === sec));
    const body = $('#s-body');

    if (sec === 'farmacia') {
      body.innerHTML = `<form class="card stack" id="f-biz">
        <div class="form-grid">
          <div class="field full"><label>Nombre del taller</label><input class="input" name="businessName" value="${esc(s().businessName || store.tenant?.name || '')}" placeholder="Ej.: Taller y Autolavado El Pistón"></div>
          <div class="field"><label>${esc(loc().tax)} (identificación fiscal)</label><input class="input" name="rif" value="${esc(s().rif)}"></div>
          <div class="field"><label>Jefe de taller / responsable</label><input class="input" name="chiefName" value="${esc(s().chiefName || '')}"><span class="hint">Firma las órdenes de trabajo y los presupuestos.</span></div>
          <div class="field"><label>Teléfono</label><input class="input" name="phone" value="${esc(s().phone)}"></div>
          <div class="field"><label>WhatsApp del taller</label><input class="input" name="whatsapp" value="${esc(s().whatsapp || '')}"><span class="hint">Aparece en la ficha del vehículo, el presupuesto y el catálogo en línea.</span></div>
          <div class="field"><label>Instagram</label><input class="input" name="instagram" value="${esc(s().instagram)}" placeholder="@tutaller"></div>
          <div class="field"><label>Correo</label><input class="input" name="email" value="${esc(s().email || '')}"></div>
          <div class="field full"><label>Dirección</label><input class="input" name="address" value="${esc(s().address)}"></div>
          <div class="field full"><label>Horario de atención</label><input class="input" name="schedule" value="${esc(s().schedule || '')}" placeholder="Ej.: Lunes a sábado 7:30 a 17:30"></div>
        </div>
        <div class="section-title">${icon('grid')} Categorías de repuestos y servicios</div>
        <textarea class="textarea" name="categories" style="min-height:90px">${esc((s().categories || CATEGORIES).join('\n'))}</textarea><span class="hint">Una por línea.</span>
        ${save()}
      </form>
      <div class="card mt-lg between row-wrap"><div class="row" style="gap:12px"><span class="flag">${flagImg(loc().code, 30)}</span><div><div class="bold">País: ${esc(loc().name)} · ${esc(loc().curName)} (${esc(loc().sym)})</div><div class="small muted">Moneda, formas de pago y prefijo de WhatsApp.</div></div></div><button class="btn btn-secondary" id="s-rate">${icon('globe')} Cambiar país</button></div>
      <div class="card mt-lg between row-wrap"><div><div class="bold">Tema de la aplicación</div><div class="small muted">Claro u oscuro, según tu preferencia.</div></div><button class="btn btn-secondary" id="s-theme">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')} Cambiar tema</button></div>`;
      $('#f-biz').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        const patch = {}; for (const k of ['businessName', 'rif', 'chiefName', 'phone', 'whatsapp', 'instagram', 'email', 'address', 'schedule']) patch[k] = F[k].value.trim();
        patch.categories = F.categories.value.split('\n').map((x) => x.trim()).filter(Boolean);
        await store.saveSettings(patch);
        if (patch.businessName && patch.businessName !== store.tenant?.name && !store.isDemo) updateTenant(store.tenantId, { name: patch.businessName, updatedAt: nowISO() }).catch(() => {});
        toast('Datos del taller guardados');
      };
      $('#s-rate').onclick = async () => { if (!(await requirePin('Cambiar el país y la moneda'))) return; if (await openCountryPicker({ force: true })) location.reload(); };
      $('#s-theme').onclick = (e) => { const n = toggleTheme(); e.currentTarget.innerHTML = `${icon(n === 'dark' ? 'sun' : 'moon')} Cambiar tema`; };
    }

    if (sec === 'moneda') {
      const X = s().fx || {};
      body.innerHTML = `<form class="card stack" id="f-fx">
        <div class="card-title">${icon('dollar')} Segunda moneda (tasa de cambio)</div>
        <p class="small muted" style="margin:0">Los precios se guardan en ${esc(loc().curName)} (${esc(loc().sym)}). Si cobras también en otra moneda (por ejemplo bolívares con precios en dólares), activa la segunda moneda: el total, el vuelto, el ticket y el catálogo en línea muestran el equivalente con la tasa del día.</p>
        ${sw('enabled', X.enabled, 'Mostrar equivalente en otra moneda', 'Actualiza la tasa cada día.')}
        <div class="form-grid">
          <div class="field"><label>Símbolo</label><input class="input" name="sym" value="${esc(X.sym || 'Bs')}" maxlength="4"></div>
          <div class="field"><label>Nombre</label><input class="input" name="name" value="${esc(X.name || 'Bolívares')}"></div>
          <div class="field"><label>Tasa: 1 ${esc(loc().sym)} =</label><input class="input input-lg" name="rate" inputmode="decimal" value="${X.rate ? num(X.rate, 2) : ''}" placeholder="0,00"></div>
        </div>
        ${save()}
      </form>
      <form class="card stack mt-lg" id="f-pr">
        <div class="card-title">${icon('percent')} Precios fraccionados e impuesto</div>
        <div class="form-grid">
          <div class="field"><label>Recargo al vender suelto: por unidad o por litro (%)</label><input class="input" name="fractionMarkup" inputmode="decimal" value="${num(s().fractionMarkup ?? 10, 0)}"><span class="hint">Ej.: 10% → un juego de 4 bujías a ${usd(10)}: la bujía suelta a ${usd(2.75)}. Puedes fijar precios propios en cada producto.</span></div>
          <div class="field"><label>Impuesto incluido en los precios (%)</label><input class="input" name="iva" inputmode="decimal" value="${num(s().iva || 0, 0)}"><span class="hint">Solo para mostrarlo desglosado en la factura. 0 para no mostrarlo.</span></div>
        </div>
        ${save()}
      </form>`;
      $('#f-fx').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        const rate = parseNum(F.rate.value);
        if (F.enabled.checked && !(rate > 0)) { toast('Escribe la tasa de cambio', 'warning'); return; }
        await store.saveSettings({ fx: { enabled: F.enabled.checked, sym: F.sym.value.trim() || 'Bs', name: F.name.value.trim(), rate, updatedAt: nowISO() } });
        toast('Tasa actualizada');
      };
      $('#f-pr').onsubmit = async (e) => { e.preventDefault(); const F = e.target.elements; await store.saveSettings({ fractionMarkup: parseNum(F.fractionMarkup.value), iva: parseNum(F.iva.value) }); toast('Guardado'); };
    }

    if (sec === 'convenios') {
      const list = s().agreements || [];
      body.innerHTML = `<div class="card stack">
        <div class="between row-wrap"><div><div class="card-title">${icon('handshake')} Flotas, empresas y aseguradoras</div><p class="small muted" style="margin:4px 0 0">Descuento para los clientes afiliados y el porcentaje que paga la empresa o aseguradora (queda por cobrar en Recordatorios › Flotas y convenios).</p></div><button class="btn btn-primary btn-sm" id="ag-add">${icon('plus')} Nuevo</button></div>
        ${list.length ? `<div class="list">${list.map((a) => `<div class="list-item" style="${a.active === false ? 'opacity:.5' : ''}"><span class="kpi-icon tone-info" style="width:38px;height:38px">${icon('handshake')}</span><div class="grow"><b>${esc(a.name)}</b><div class="t-sub">${a.discount ? `${a.discount}% de descuento` : 'sin descuento'} · ${a.coverage ? `cubre ${a.coverage}%` : 'paga el cliente'}${a.scope === 'medicamentos' ? ' · solo repuestos' : ''} · ${store.clients.filter((c) => c.agreementId === a.id).length} afiliado(s)</div></div><button class="btn btn-ghost btn-sm" data-ag="${a.id}">${icon('edit')} Editar</button></div>`).join('')}</div>`
          : emptyState('handshake', 'Sin flotas ni convenios', 'Ej.: “Flota Distribuidora Andina: 10% y paga a 30 días”, “Aseguradora: cubre el 100% del siniestro”, “Taxistas de la línea: 15%”.')}
      </div>`;
      $('#ag-add').onclick = () => agreementForm();
      body.querySelectorAll('[data-ag]').forEach((b) => b.onclick = () => agreementForm(list.find((x) => x.id === b.dataset.ag)));
    }

    if (sec === 'vendedores') {
      const list = s().sellers || [];
      body.innerHTML = `<div class="card stack">
        <div class="between row-wrap"><div><div class="card-title">${icon('users')} Equipo</div><p class="small muted" style="margin:4px 0 0">Mecánicos, lavadores, asesores y caja: se asignan en las órdenes, el autolavado y la agenda. En Reportes verás la mano de obra de cada mecánico y su comisión.</p></div><button class="btn btn-primary btn-sm" id="sl-add">${icon('plus')} Agregar</button></div>
        ${list.length ? `<div class="list">${list.map((x) => `<div class="list-item" style="${x.active === false ? 'opacity:.5' : ''}"><span class="avatar">${esc(x.name[0] || '?')}</span><div class="grow"><b>${esc(x.name)}</b><div class="t-sub">${esc(STAFF_ROLES[x.role] || x.role || '')}${Number(x.commission) ? ` · comisión ${num(x.commission, 0)}% de la mano de obra` : ''}</div></div><button class="btn btn-ghost btn-icon btn-sm" data-ed="${x.id}">${icon('edit')}</button><button class="btn btn-ghost btn-sm" data-sl="${x.id}">${x.active === false ? 'Activar' : 'Desactivar'}</button><button class="btn btn-ghost btn-icon btn-sm" data-del="${x.id}">${icon('trash')}</button></div>`).join('')}</div>` : emptyState('users', 'Sin equipo registrado', 'Agrega a tus mecánicos para asignarles las órdenes de trabajo.')}
      </div>`;
      const form = (x0 = null) => {
        const m = openModal({ title: x0 ? 'Editar' : 'Agregar al equipo', size: 'sm', body: `<div class="stack"><div class="field"><label>Nombre</label><input class="input" data-n value="${esc(x0?.name || '')}" autofocus placeholder="Ej.: Carlos Rodríguez"></div><div class="field"><label>Rol</label><select class="select" data-r>${Object.entries(STAFF_ROLES).map(([k, v]) => `<option value="${k}" ${(x0?.role || 'mecanico') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label>Comisión sobre la mano de obra (%)</label><input class="input" data-c inputmode="decimal" value="${x0?.commission ? num(x0.commission, 0) : ''}" placeholder="0"><span class="hint">Se calcula en Reportes › Mecánicos con las órdenes entregadas.</span></div></div>`, footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>` });
        m.el.querySelector('[data-ok]').onclick = async () => {
          const n = m.el.querySelector('[data-n]').value.trim(); if (!n) return;
          const role = m.el.querySelector('[data-r]').value; const commission = Math.max(0, Math.min(100, parseNum(m.el.querySelector('[data-c]').value) || 0));
          await store.saveSettings({ sellers: x0 ? list.map((y) => (y.id === x0.id ? { ...y, name: n, role, commission } : y)) : [...list, { id: 's' + shortId(6), name: n, role, commission, active: true }] });
          m.close(); toast('Equipo actualizado');
        };
      };
      $('#sl-add').onclick = () => form();
      body.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => form(list.find((x) => x.id === b.dataset.ed)));
      body.querySelectorAll('[data-sl]').forEach((b) => b.onclick = () => store.saveSettings({ sellers: list.map((x) => (x.id === b.dataset.sl ? { ...x, active: x.active === false } : x)) }));
      body.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirmDialog({ title: 'Quitar del equipo', message: 'Sus órdenes, citas y ventas anteriores se conservan.', confirmText: 'Quitar', danger: true })) store.saveSettings({ sellers: list.filter((x) => x.id !== b.dataset.del) }); });
    }

    if (sec === 'vacunas') {
      const plan = s().maintPlan?.length ? s().maintPlan : MAINT_DEFAULT;
      const wt = s().washTypes?.length ? s().washTypes : WASH_TYPES_DEFAULT;
      const A = s().agenda || {};
      body.innerHTML = `<div class="card stack">
        <div class="between row-wrap"><div><div class="card-title">${icon('droplet')} Plan de mantenimiento</div><p class="small muted" style="margin:4px 0 0">Cada cuántos kilómetros o meses toca cada servicio (lo que llegue primero). Al registrarlo en un vehículo, el próximo se calcula solo y aparece en Recordatorios.</p></div><button class="btn btn-primary btn-sm" id="v-add">${icon('plus')} Agregar</button></div>
        <div class="list">${plan.map((v) => `<div class="list-item" style="${v.active === false ? 'opacity:.5' : ''}"><span class="kpi-icon tone-brand" style="width:34px;height:34px">${icon(v.icon || 'wrench')}</span><div class="grow" style="min-width:0"><b>${esc(v.name)}</b><div class="t-sub">${v.everyKm ? `cada ${num(v.everyKm, 0)} km` : ''}${v.everyKm && v.everyDays ? ' o ' : ''}${v.everyDays ? `cada ${Math.round(v.everyDays / 30)} meses` : ''}</div></div><button class="btn btn-ghost btn-icon btn-sm" data-ve="${v.id}">${icon('edit')}</button></div>`).join('')}</div>
      </div>
      <form class="card stack mt-lg" id="f-tl"><div class="card-title">${icon('wrench')} Taller y autolavado</div>
        <div class="form-grid">
          <div class="field"><label>Kilómetros por día (promedio)</label><input class="input" name="kmPerDay" inputmode="numeric" value="${s().kmPerDay ?? 35}"><span class="hint">Para estimar el kilometraje de hoy si el vehículo aún no tiene historial.</span></div>
          <div class="field"><label>Avisar cuando falten (km)</label><input class="input" name="reminderKm" inputmode="numeric" value="${s().reminderKm ?? 500}"></div>
          <div class="field"><label>… o cuando falten (días)</label><input class="input" name="reminderDays" inputmode="numeric" value="${s().reminderDays ?? 7}"></div>
          <div class="field"><label>Precio por hora de mano de obra (${esc(loc().sym)})</label><input class="input" name="laborRate" inputmode="decimal" value="${s().laborRate ? num(s().laborRate) : ''}" placeholder="0,00"><span class="hint">Sugiere el precio al cargar horas de trabajo en la orden.</span></div>
          <div class="field"><label>Garantía (días)</label><input class="input" name="warrantyDays" inputmode="numeric" value="${s().warrantyDays ?? 30}"></div>
          <div class="field"><label>Garantía (km)</label><input class="input" name="warrantyKm" inputmode="numeric" value="${s().warrantyKm ?? 1000}"></div>
          <div class="field"><label>Bahías de lavado</label><input class="input" name="washBays" inputmode="numeric" value="${s().washBays ?? 2}"><span class="hint">Para calcular el tiempo de espera del autolavado.</span></div>
          <div class="field full"><label>Nota al pie del presupuesto</label><input class="input" name="quoteNote" value="${esc(s().quoteNote || '')}" placeholder="Ej.: Presupuesto válido por 7 días. Los repuestos se piden al aprobar."></div>
        </div>
        <div class="field"><label>Servicios de lavado (uno por línea: nombre | minutos)</label><textarea class="textarea" name="washTypes" style="min-height:110px">${esc(wt.map((w) => `${w.name} | ${w.minutes || 30}`).join('\n'))}</textarea><span class="hint">El precio de cada uno se toma del servicio con el mismo nombre en el inventario.</span></div>
        ${save()}</form>
      <form class="card stack mt-lg" id="f-ag"><div class="card-title">${icon('calendar')} Horario de la agenda</div>
        <div class="form-grid">
          <div class="field"><label>Abre</label><input class="input" type="time" name="start" value="${esc(A.start || '07:30')}"></div>
          <div class="field"><label>Cierra</label><input class="input" type="time" name="end" value="${esc(A.end || '17:30')}"></div>
          <div class="field"><label>Intervalo de citas (min)</label><select class="select" name="slot">${[15, 20, 30, 45, 60].map((n) => `<option ${Number(A.slot || 30) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Días de atención</label><div class="chips">${DAYS.map((d, i) => `<label class="chip"><input type="checkbox" name="d${i}" ${(A.days || [1, 2, 3, 4, 5, 6]).includes(i) ? 'checked' : ''} style="margin-right:4px">${d}</label>`).join('')}</div></div>
        ${save()}</form>`;
      const vform = (v0 = null) => {
        const m = openModal({ title: v0 ? 'Editar servicio del plan' : 'Nuevo servicio del plan', size: 'sm', body: `<div class="stack"><div class="field"><label>Nombre</label><input class="input" data-n value="${esc(v0?.name || '')}" autofocus placeholder="Ej.: Cambio de aceite de caja"></div><div class="form-grid"><div class="field"><label>Cada (km)</label><input class="input" data-k inputmode="numeric" value="${v0?.everyKm || ''}" placeholder="0 = solo por fecha"></div><div class="field"><label>Cada (meses)</label><input class="input" data-d inputmode="numeric" value="${v0?.everyDays ? Math.round(v0.everyDays / 30) : ''}" placeholder="0 = solo por km"></div></div>${v0 ? `<label class="check"><input type="checkbox" data-a ${v0.active !== false ? 'checked' : ''}> <span>Activo</span></label>` : ''}</div>`, footer: `${v0 ? `<button class="btn btn-ghost text-danger" data-del style="margin-right:auto">${icon('trash')}</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>` });
        const q = (x) => m.el.querySelector(x);
        q('[data-ok]').onclick = async () => {
          const n = q('[data-n]').value.trim(); if (!n) return;
          const km = Math.max(0, Math.round(parseNum(q('[data-k]').value) || 0)); const days = Math.max(0, Math.round((parseNum(q('[data-d]').value) || 0) * 30));
          if (!km && !days) { toast('Indica los km o los meses', 'warning'); return; }
          const item = { icon: 'wrench', ...(v0 || {}), id: v0?.id || 'm_' + shortId(6), name: n, everyKm: km, everyDays: days, active: q('[data-a]') ? q('[data-a]').checked : true };
          await store.saveSettings({ maintPlan: v0 ? plan.map((y) => (y.id === v0.id ? item : y)) : [...plan, item] }); m.close(); toast('Plan actualizado'); render();
        };
        q('[data-del]')?.addEventListener('click', async () => { await store.saveSettings({ maintPlan: plan.filter((y) => y.id !== v0.id) }); m.close(); render(); });
      };
      $('#v-add').onclick = () => vform();
      body.querySelectorAll('[data-ve]').forEach((b) => b.onclick = () => vform(plan.find((v) => v.id === b.dataset.ve)));
      $('#f-tl').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements; const n = (k, d) => Math.max(0, Math.round(parseNum(F[k].value) || d));
        const washTypes = F.washTypes.value.split('\n').map((l) => l.split('|')).filter((x) => x[0].trim()).map(([name, min], i) => ({ id: (wt.find((w) => w.name === name.trim())?.id) || 'w_' + i + shortId(4), name: name.trim(), minutes: Math.max(5, Math.round(parseNum(min) || 30)) }));
        await store.saveSettings({ kmPerDay: n('kmPerDay', 35), reminderKm: n('reminderKm', 500), reminderDays: Math.max(1, n('reminderDays', 7)), laborRate: round2(parseNum(F.laborRate.value) || 0), warrantyDays: n('warrantyDays', 30), warrantyKm: n('warrantyKm', 1000), washBays: Math.max(1, n('washBays', 1)), quoteNote: F.quoteNote.value.trim(), ...(washTypes.length ? { washTypes } : {}) });
        toast('Ajustes del taller guardados');
      };
      $('#f-ag').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        const days = DAYS.map((_, i) => (F['d' + i].checked ? i : -1)).filter((i) => i >= 0);
        await store.saveSettings({ agenda: { start: F.start.value || '07:30', end: F.end.value || '17:30', slot: Number(F.slot.value) || 30, days } });
        toast('Horario guardado');
      };
    }

    if (sec === 'pedidos') {
      const S = s().shop || {}; const url = S.slug ? shopUrl(S.slug) : '';
      body.innerHTML = `<form class="card stack" id="f-shop">
        <div class="card-title">${icon('bag')} Catálogo en línea</div>
        <p class="small muted" style="margin:0">Una página de tu tienda donde el cliente busca aceites, filtros, bujías, baterías y accesorios, ve el precio y te hace el pedido para retirar o instalar. Se actualiza sola con tus precios y existencias. Nunca muestra costos ni datos de tus clientes.</p>
        ${sw('enabled', S.enabled !== false, 'Catálogo activo', 'Recibe pedidos en Pedidos en línea.')}
        <div class="form-grid">
          <div class="field full"><label>Dirección de tu catálogo</label><div class="input-group"><span class="prefix">/pedido/</span><input class="input" name="slug" value="${esc(S.slug || '')}" style="padding-left:78px"></div>${url ? `<span class="hint"><a href="${url}" target="_blank" rel="noopener">${esc(url)}</a></span>` : ''}</div>
          <div class="field"><label>Costo del delivery</label><input class="input" name="deliveryFee" inputmode="decimal" value="${S.deliveryFee ? num(S.deliveryFee) : ''}" placeholder="0 = gratis"></div>
          <div class="field full"><label>Aviso para el cliente</label><input class="input" name="note" value="${esc(S.note || '')}" placeholder="Ej.: Delivery gratis en compras mayores a ${usd(20)}"></div>
        </div>
        ${sw('delivery', S.delivery !== false, 'Ofrecer delivery', 'El cliente puede pedir que se lo lleves.')}
        ${sw('showStock', S.showStock !== false, 'Mostrar disponibilidad', 'Disponible / pocas unidades / agotado (nunca la cantidad exacta).')}
        ${sw('hideControlled', S.hideControlled !== false, 'Ocultar productos controlados', 'Recomendado: los psicotrópicos no aparecen en el catálogo.')}
        <div class="error-msg" data-err></div>
        ${save()}
      </form>
      ${url ? `<div class="card mt-lg row row-wrap" style="gap:16px;align-items:center"><img id="sh-qr" class="qr-img" alt="QR"><div class="grow"><b>Comparte tu catálogo</b><p class="small muted" style="margin:4px 0 8px">Imprime el QR para el mostrador o compártelo por WhatsApp e Instagram.</p><a class="btn btn-primary btn-sm" href="${url}" target="_blank" rel="noopener">${icon('external')} Abrir catálogo</a></div></div>` : ''}`;
      if (url) qrDataURL(url, 4).then((q) => { const i = $('#sh-qr'); if (i) i.src = q; });
      $('#f-shop').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements; const err = e.target.querySelector('[data-err]'); err.textContent = '';
        const btn = e.target.querySelector('button.btn-primary'); setBusy(btn, true);
        const slug = slugify(F.slug.value) || S.slug;
        try {
          if (!/^[a-z0-9-]{4,60}$/.test(slug)) throw new Error('La dirección debe tener de 4 a 60 letras, números o guiones.');
          if (slug !== S.slug) { const taken = await getShop(slug).catch(() => null); if (taken && taken.tenantId !== store.tenantId) throw new Error('Esa dirección ya la usa otro negocio. Prueba con otra.'); }
          const old = S.slug;
          await store.saveSettings({ shop: { ...S, enabled: F.enabled.checked, slug, deliveryFee: parseNum(F.deliveryFee.value), note: F.note.value.trim(), delivery: F.delivery.checked, showStock: F.showStock.checked, hideControlled: F.hideControlled.checked } });
          if (old && slug !== old) { const b = store.batch(); b.delete(store.shopRef(old)); await store.commit(b); }
          resetPublished(); await publishShop({ force: true });
          toast('Catálogo actualizado');
        } catch (ex) { err.textContent = ex.message; }
        setBusy(btn, false);
      };
    }

    if (sec === 'fidelidad') {
      const L = s().loyalty || {};
      body.innerHTML = `<form class="card stack" id="f-loy">
        <div class="card-title">${icon('star')} Programa de puntos</div>
        ${sw('enabled', L.enabled !== false, 'Puntos activos', 'Se suman solos al cobrarle a un cliente registrado.')}
        <div class="form-grid">
          <div class="field"><label>1 punto por cada (${esc(loc().sym)})</label><input class="input" name="per" inputmode="decimal" value="${num(L.per ?? 1)}"></div>
          <div class="field"><label>Valor de cada punto (${esc(loc().sym)})</label><input class="input" name="pointValue" inputmode="decimal" value="${num(L.pointValue ?? 0.05, 3)}"></div>
          <div class="field"><label>Canje desde (puntos)</label><input class="input" name="minRedeem" inputmode="numeric" value="${L.minRedeem ?? 100}"></div>
        </div>
        <div class="box small" id="loy-ex"></div>
        <div class="card-title mt">${icon('bell')} Alertas</div>
        <div class="form-grid">
          <div class="field"><label>Alertar vencimientos con (días)</label><select class="select" name="expiryAlertDays">${[30, 60, 90, 120, 180].map((d) => `<option ${Number(s().expiryAlertDays || 90) === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
        </div>
        <p class="small muted" style="margin:0">Los avisos de mantenimiento (km y días) se ajustan en Mantenimiento y agenda.</p>
        ${save()}
      </form>`;
      const ex = () => { const F = $('#f-loy').elements; const per = parseNum(F.per.value) || 1; const pv = parseNum(F.pointValue.value) || 0; $('#loy-ex').innerHTML = `Ejemplo: una compra de ${usd(50)} suma <b>${Math.floor(50 / per)} pts</b>. 100 pts = <b>${usd(100 * pv)}</b> de descuento (${num(pv / per * 100, 1)}% de retorno).`; };
      ['per', 'pointValue'].forEach((k) => $('#f-loy').elements[k].addEventListener('input', ex)); ex();
      $('#f-loy').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        await store.saveSettings({ loyalty: { enabled: F.enabled.checked, per: parseNum(F.per.value) || 1, pointValue: parseNum(F.pointValue.value), minRedeem: Math.round(parseNum(F.minRedeem.value)) }, expiryAlertDays: Number(F.expiryAlertDays.value) || 90 });
        toast('Guardado');
      };
    }

    if (sec === 'recibos') {
      body.innerHTML = `<form class="card stack" id="f-docs">
        <div class="form-grid">
          <div class="field"><label>Título del documento</label><input class="input" name="docTitle" value="${esc(s().docTitle || 'FACTURA')}"><span class="hint">Ej.: FACTURA, NOTA DE ENTREGA, TICKET.</span></div>
          <div class="field"><label>Formato</label><select class="select" name="receiptFormat">${[['80mm', 'Ticket 80 mm'], ['58mm', 'Ticket 58 mm'], ['carta', 'Hoja carta']].map(([v, l]) => `<option value="${v}" ${s().receiptFormat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Prefijo de numeración</label><input class="input" name="invoicePrefix" value="${esc(s().invoicePrefix || 'F')}" maxlength="4"></div>
          <div class="field full"><label>Mensaje al pie</label><input class="input" name="receiptFooter" value="${esc(s().receiptFooter || '')}" placeholder="Ej.: Gracias por confiar en nosotros. ¡Buen viaje!"></div>
        </div>
        ${save()}</form>`;
      $('#f-docs').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        await store.saveSettings({ docTitle: F.docTitle.value.trim().toUpperCase() || 'FACTURA', receiptFormat: F.receiptFormat.value, invoicePrefix: F.invoicePrefix.value.trim().toUpperCase() || 'F', receiptFooter: F.receiptFooter.value.trim() });
        toast('Guardado');
      };
    }

    if (sec === 'seguridad') {
      body.innerHTML = `<div class="grid-2">
        <form class="card stack" id="f-pin"><div class="card-title">${icon('lock')} PIN de administrador</div><p class="small muted" style="margin:0">Protege reportes, anulaciones, cambios de precio y descuentos, salidas y ajustes de inventario, gastos, cierre de caja y salir de la consulta de precios.</p>
          <div class="field"><label>Nuevo PIN (4 a 12 dígitos)</label><input class="input" name="pin" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
          <div class="field"><label>Repetir PIN</label><input class="input" name="pin2" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
          <button class="btn btn-primary">${icon('check')} Cambiar PIN</button></form>
        ${session.user?.isAnonymous ? `<div class="card stack"><div class="card-title">${icon('shield')} Contraseña</div><p class="muted" style="margin:0">En la demo no hay contraseña. Contrata SanoTaller para tener tu propia cuenta.</p><a class="btn btn-whatsapp" href="${salesWa()}" target="_blank" rel="noopener">${icon('whatsapp')} ${SALES_PHONE_FMT}</a></div>`
          : `<form class="card stack" id="f-pass"><div class="card-title">${icon('shield')} Contraseña de acceso</div>
          <div class="field"><label>Contraseña actual</label><input class="input" name="cur" type="password" autocomplete="current-password"></div>
          <div class="field"><label>Nueva contraseña (mínimo 8)</label><input class="input" name="next" type="password" autocomplete="new-password"></div>
          <div class="error-msg" data-err></div>
          <button class="btn btn-primary">${icon('check')} Cambiar contraseña</button></form>`}
      </div>
      <div class="box small mt-lg">${icon('shieldCheck')} Los clientes, vehículos y órdenes solo son visibles con tu usuario. La ficha pública de cada vehículo muestra solo la placa, el modelo, su mantenimiento y el estado de la orden; el catálogo en línea solo repuestos, precio y disponibilidad.</div>`;
      $('#f-pin').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        if (store.isDemo) { toast('En la demo el PIN siempre es 1234.', 'info'); return; }
        if (!/^\d{4,12}$/.test(F.pin.value)) { toast('El PIN debe tener de 4 a 12 dígitos', 'warning'); return; }
        if (F.pin.value !== F.pin2.value) { toast('Los PIN no coinciden', 'warning'); return; }
        if (store.hasPin() && !(await requirePin('Cambiar el PIN', { always: true }))) return;
        await store.setPin(F.pin.value); e.target.reset(); toast('PIN actualizado');
      };
      const fp = $('#f-pass');
      if (fp) fp.onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements; const err = fp.querySelector('[data-err]'); err.textContent = '';
        if (F.next.value.length < 8) { err.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.'; return; }
        const btn = fp.querySelector('button'); setBusy(btn, true);
        try { await changePassword(F.cur.value, F.next.value); e.target.reset(); toast('Contraseña actualizada'); }
        catch (ex) { err.textContent = authErrorMessage(ex); }
        setBusy(btn, false);
      };
    }

    if (sec === 'apps') {
      body.innerHTML = `<div class="grid-2">
        <div class="card stack"><div class="card-title">${icon('install')} Instalar la app</div>
          <p class="small muted" style="margin:0">Instala SanoTaller en la computadora de recepción, en el teléfono del jefe de taller y en una tablet en el área de trabajo. Todo conectado en tiempo real.</p>
          ${isStandalone() ? `<div class="pay-status ok"><span>${icon('check')} Estás usando la app instalada</span><span></span></div>` : `<button class="btn btn-primary btn-lg" data-install>${icon('install')} Instalar en este equipo</button>`}
          <div class="list">
            <div class="list-item"><span class="kpi-icon tone-success" style="width:34px;height:34px">${icon('phone')}</span><div class="grow"><b>Android</b><div class="t-sub">Chrome › menú ⋮ › Instalar app</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-info" style="width:34px;height:34px">${icon('laptop')}</span><div class="grow"><b>Computadora</b><div class="t-sub">Chrome o Edge › ícono de instalar en la barra de direcciones. Funciona con lector de código de barras USB.</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-violet" style="width:34px;height:34px">${icon('phone')}</span><div class="grow"><b>iPhone / iPad</b><div class="t-sub">Safari › Compartir › Agregar a inicio</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-warning" style="width:34px;height:34px">${icon('tablet')}</span><div class="grow"><b>Consulta de precios</b><div class="t-sub">Una tablet con lector en la tienda: menú › Consulta de precios.</div></div></div>
          </div></div>
        <div class="card stack"><div class="card-title">${icon('download')} Respaldo de datos</div>
          <p class="small muted" style="margin:0">Descarga una copia de clientes, vehículos, órdenes de trabajo, lavados, citas, repuestos, ventas, compras, proveedores, caja y configuración (archivo JSON). Protegido con PIN.</p>
          <button class="btn btn-secondary" id="s-backup">${icon('download')} Descargar respaldo completo</button>
          <div class="divider"></div>
          <div class="card-title">${icon('whatsapp')} Soporte</div>
          <p class="small muted" style="margin:0">¿Dudas o sugerencias? Escríbenos.</p>
          <a class="btn btn-whatsapp" href="${salesWa('Hola, necesito soporte con SanoTaller.')}" target="_blank" rel="noopener">${icon('whatsapp')} ${SALES_PHONE_FMT}</a></div>
      </div>`;
      bindInstallButtons(body);
      $('#s-backup').onclick = async (e) => {
        const btn = e.currentTarget;
        if (!(await requirePin('Descargar el respaldo'))) return;
        setBusy(btn, true, 'Preparando…');
        try {
          const { getDocs } = await import('../firebase.js');
          const all = async (n) => (await getDocs(store.col(n))).docs.map((d) => ({ id: d.id, ...d.data() }));
          const names = ['jobs', 'washes', 'appointments', 'sales', 'purchases', 'suppliers', 'cash_shifts', 'cash_movements', 'inventory_logs'];
          const got = await Promise.all(names.map(all));
          const data = { app: 'SanoTaller', exportedAt: nowISO(), business: store.businessName, settings: store.settings, clients: store.clients, vehicles: store.vehicles, products: store.products };
          names.forEach((n, i) => { data[n] = got[i]; });
          download(`respaldo-${slugify(store.businessName || 'sanotaller')}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
          toast('Respaldo descargado');
        } catch (ex) { toast('No se pudo generar el respaldo: ' + ex.message, 'danger'); }
        setBusy(btn, false);
      };
    }
  }

  function agreementForm(a = null) {
    const x = a || { id: '', name: '', discount: 10, coverage: 0, scope: 'todo', active: true, contact: '' };
    const m = openModal({
      title: a ? 'Editar plan o convenio' : 'Nuevo plan o convenio', size: 'md',
      body: `<form class="form-grid" data-f>
        <div class="field full"><label>Nombre *</label><input class="input" name="name" value="${esc(x.name)}" autofocus placeholder="Ej.: Flota Distribuidora Andina · Aseguradora · Línea de taxis"></div>
        <div class="field"><label>Descuento al cliente (%)</label><input class="input" name="discount" inputmode="decimal" value="${num(x.discount || 0, 0)}"></div>
        <div class="field"><label>Cubre el convenio (%)</label><input class="input" name="coverage" inputmode="decimal" value="${num(x.coverage || 0, 0)}"><span class="hint">0 = paga todo el cliente. 80 = la empresa o aseguradora paga el 80% (queda por cobrar).</span></div>
        <div class="field"><label>Aplica a</label><select class="select" name="scope"><option value="todo" ${x.scope !== 'medicamentos' ? 'selected' : ''}>Toda la compra</option><option value="medicamentos" ${x.scope === 'medicamentos' ? 'selected' : ''}>Solo repuestos (no mano de obra ni delivery)</option></select></div>
        <div class="field"><label>Contacto</label><input class="input" name="contact" value="${esc(x.contact || '')}"></div>
        <label class="check full"><input type="checkbox" name="active" ${x.active !== false ? 'checked' : ''}> <span>Activo</span></label>
      </form>`,
      footer: `${a ? `<button class="btn btn-ghost text-danger" data-del style="margin-right:auto">${icon('trash')} Eliminar</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`
    });
    const F = m.el.querySelector('[data-f]').elements;
    m.el.querySelector('[data-ok]').onclick = async () => {
      if (!F.name.value.trim()) { toast('Escribe el nombre', 'warning'); return; }
      const item = { ...x, id: x.id || 'a' + shortId(6), name: F.name.value.trim(), discount: Math.min(100, Math.max(0, round2(parseNum(F.discount.value)))), coverage: Math.min(100, Math.max(0, round2(parseNum(F.coverage.value)))), scope: F.scope.value, contact: F.contact.value.trim(), active: F.active.checked };
      const list = s().agreements || [];
      await store.saveSettings({ agreements: a ? list.map((y) => (y.id === a.id ? item : y)) : [...list, item] });
      m.close(); toast('Guardado');
    };
    m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Eliminar', message: 'Los clientes afiliados quedan sin convenio. Las ventas anteriores se conservan.', confirmText: 'Eliminar', danger: true }))) return;
      await store.saveSettings({ agreements: (s().agreements || []).filter((y) => y.id !== a.id) }); m.close();
    });
  }

  el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { sec = b.dataset.s; render(); });
  render();
  return store.on('*', (evt) => { if (evt === 'settings' && ['convenios', 'vendedores', 'vacunas'].includes(sec)) render(); });
}
