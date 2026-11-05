// SanoTaller — Recorrido guiado: ilumina zonas de la pantalla y explica para qué sirven
import { esc, openModal, closeAllModals } from './utils.js';
import { icon } from './icons.js';

// Cada paso: { route, sel: [selectores alternativos], title, text }. Sin elemento visible → tarjeta centrada.
export const TOURS = {
  general: {
    name: 'Recorrido general', desc: 'Lo esencial del sistema en 1 minuto', icon: 'sparkle',
    steps: [
      { route: 'inicio', title: '¡Bienvenido a SanoTaller! 🔧', text: 'En un minuto te mostramos cómo manejar tu taller aquí: recepción del vehículo, órdenes de trabajo en tablero, presupuesto que el cliente aprueba desde su teléfono, mantenimiento por kilometraje, autolavado, repuestos y caja. Usa “Siguiente” para avanzar o “Salir” cuando quieras. Puedes repetirlo desde el menú › Ayuda.' },
      { route: 'inicio', sel: ['.sb-nav', '.bottom-nav'], title: 'Menú principal', text: 'Órdenes, autolavado, agenda, vehículos, clientes, recordatorios, vender, pedidos en línea, repuestos, compras, facturas, caja, reportes y ajustes. Los números de colores son avisos: vehículos listos, presupuestos por responder, carros en el lavado o mantenimientos vencidos.' },
      { route: 'inicio', sel: ['#sb-search', '#tb-search'], title: 'Búsqueda rápida', text: 'Busca un vehículo por su placa, marca, modelo o el nombre del dueño; una orden por su número; un repuesto por nombre, referencia o código de barras. En la computadora: Ctrl + K.' },
      { route: 'inicio', sel: ['[data-tour="quick"]'], title: 'Accesos rápidos', text: 'Recibir un vehículo, mandarlo al lavado, agendar una cita, vender o registrar un vehículo nuevo. Atajos: F1 vender, F3 vehículos, F6 órdenes.' },
      { route: 'inicio', sel: ['[data-tour="kpis"]'], title: 'Tu taller hoy', text: 'Vehículos dentro del taller, ventas del día, citas, carros en el autolavado, mantenimientos por avisar y repuestos bajo el mínimo.' },
      { route: 'inicio', sel: ['[data-tour="due"]'], title: 'Mantenimientos por avisar', text: 'SanoTaller estima el kilometraje de cada vehículo según su uso y te dice a quién le toca cambio de aceite, frenos, correa o alineación. Escríbele al cliente por WhatsApp con el mensaje listo.' },
      { route: 'ordenes', sel: ['[data-tour="board"]'], title: 'Tablero de órdenes', text: 'Cada vehículo en su columna: recibido, diagnóstico, presupuesto, en reparación, esperando repuesto y listo. Abre una orden para ver la inspección de ingreso, los trabajos, los repuestos y la bitácora.' },
      { route: 'ordenes', title: 'Presupuesto desde el teléfono', text: 'Envías el presupuesto por WhatsApp; el cliente lo abre, marca qué trabajos aprueba y firma con su nombre. La orden cambia sola a “Aprobado” y te avisa. En la demo ya hay uno respondido.' },
      { route: 'lavado', sel: ['[data-tour="wash"]'], title: 'Autolavado', text: 'La cola por placa: en cola, lavando, secado y listo. Te dice cuánto falta para cada carro según tus bahías; al terminar avisas por WhatsApp y cobras.' },
      { route: 'recordatorios', sel: ['[data-tour="rem-tabs"]'], title: 'Recordatorios', text: 'Mantenimientos por kilometraje y fecha, revisiones, clientes que no vuelven, saldos pendientes, flotas y puntos. Cada uno con su mensaje de WhatsApp listo.' },
      { route: 'vender', sel: ['[data-tour="pos-client"]'], title: 'Vender y cobrar', text: 'Elige el vehículo y cobra la orden completa (mano de obra y repuestos), un lavado o una venta de mostrador. Filtra repuestos compatibles con ese vehículo. Varias formas de pago, crédito o convenio de flota.' },
      { route: 'inicio', title: '¡A trabajar! 🎉', text: 'Prueba ahora: en Órdenes abre la del Optra que está lista y entrégala, o en Vehículos abre el Corolla y mira su plan de mantenimiento y su ficha con QR. Más recorridos en el menú › Ayuda.', final: true }
    ]
  },
  ordenes: {
    name: 'Recepción y órdenes de trabajo', desc: 'Inspección, presupuesto, aprobación y entrega', icon: 'wrench',
    steps: [
      { route: 'ordenes', sel: ['[data-tour="job-new"]'], title: 'Recibir un vehículo', text: 'Busca la placa (o regístrala con su dueño), anota el kilometraje, el combustible, la revisión de luces, frenos y cauchos, los daños sobre el dibujo del carro, las pertenencias y fotos. Queda firmado en la orden.' },
      { route: 'ordenes', sel: ['[data-tour="board"]'], title: 'El tablero', text: 'Avanza cada orden de columna con un toque. El cliente ve el estado en la ficha pública de su vehículo sin llamarte.' },
      { route: 'ordenes', title: 'Trabajos y repuestos', text: 'Agrega mano de obra (con el mecánico que la hace) y repuestos del inventario o externos. El total se calcula solo; envía el presupuesto y el cliente aprueba todo o una parte.' },
      { route: 'ordenes', title: 'Entrega y garantía', text: 'Al entregar registras el kilometraje de salida: los servicios del plan quedan anotados con su próximo cambio, la garantía en días y km, y el historial del vehículo. Cobras en caja con la orden ya cargada.', final: true }
    ]
  },
  lavado: {
    name: 'Agenda y autolavado', desc: 'Citas, cola del lavado y avisos', icon: 'calendar',
    steps: [
      { route: 'agenda', sel: ['[data-tour="appt-new"]'], title: 'Nueva cita', text: 'Elige el vehículo, el servicio, el mecánico o lavador, el día y la hora. Si esa persona ya tiene una cita a esa hora, te avisa.' },
      { route: 'agenda', sel: ['[data-tour="agenda-list"]'], title: 'El día', text: 'Las citas con su estado: por confirmar, confirmada, llegó, recibido o no vino. Confirma por WhatsApp con un toque y con “Atender” abres la orden o el lavado.' },
      { route: 'lavado', sel: ['[data-tour="wash-new"]'], title: 'Entrar al lavado', text: 'Escribe la placa (registrada o de paso), marca los servicios y el precio se suma solo. Asigna al lavador.' },
      { route: 'lavado', sel: ['[data-tour="wash"]'], title: 'La cola', text: 'Avanza cada carro por etapa y avisa al cliente cuando esté listo. Al entregar, cobras.', final: true }
    ]
  },
  compras: {
    name: 'Repuestos, compras, caja y reportes', desc: 'Inventario, proveedores, cuentas por pagar y reportes', icon: 'truck',
    steps: [
      { route: 'inventario', sel: ['[data-tour="inv-tabs"]', '#i-tabs'], title: 'Repuestos', text: 'Aceites, filtros, frenos, baterías y cauchos con su referencia, marca y “compatible con”. Vende el aceite por galón o por litro y enlaza cada repuesto con su servicio del plan de mantenimiento.' },
      { route: 'compras', sel: ['#p-tabs'], title: 'Compras', text: 'El sugerido te arma el pedido con lo que está bajo el mínimo. Envía la orden al proveedor por WhatsApp y al recibirla registra el costo; las facturas a crédito quedan en cuentas por pagar.' },
      { route: 'pedidos', sel: ['#o-tabs', '#view'], title: 'Pedidos en línea', text: 'Tus clientes apartan repuestos desde tu catálogo en línea. Los preparas y los cobras con un toque, o los instalas con cita.' },
      { route: 'caja', sel: ['#view'], title: 'Caja', text: 'Abre la caja con el fondo inicial; cada cobro suma por forma de pago. Registra gastos e ingresos, y al cerrar compara lo contado con lo esperado.' },
      { route: 'caja', sel: ['.sb-nav [data-nav="reportes"]', '#view'], title: 'Reportes', text: 'Ventas por día, ganancia, órdenes entregadas por tipo, mano de obra y comisión de cada mecánico, autolavado y valor del inventario. Protegidos con el PIN (en la demo: 1234).', final: true }
    ]
  }
};
let state = null;

const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };
async function findTarget(sels = [], timeout = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    for (const s of sels) { const el = [...document.querySelectorAll(s)].find(visible); if (el) return el; }
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
}

/** Inicia un recorrido (por defecto el general). */
export async function startTour(id = 'general') {
  stopTour();
  const tour = TOURS[id];
  if (!tour) return;
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = '<div class="tour-block"></div><div class="tour-spot"></div><div class="tour-tip" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(root);
  state = { id, tour, i: 0, root, target: null };
  const onKey = (e) => {
    if (!state) return;
    if (e.key === 'Escape') { e.stopPropagation(); stopTour(); }
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  };
  const onResize = () => place();
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);
  state.cleanup = () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onResize, true); };
  await show();
}

export function stopTour() {
  if (!state) return;
  state.cleanup?.();
  state.root.remove();
  state = null;
  try { localStorage.setItem('sg_tour_done', '1'); } catch (_) {}
}
export const tourActive = () => !!state;

async function go(d) {
  if (!state) return;
  const n = state.i + d;
  if (n < 0) return;
  if (n >= state.tour.steps.length) { stopTour(); return; }
  state.i = n;
  await show();
}

async function show() {
  const s = state.tour.steps[state.i];
  const tip = state.root.querySelector('.tour-tip');
  tip.classList.add('busy');
  const { navigate } = await import('./main.js');
  if (s.route && location.hash.replace(/^#\/?/, '') !== s.route) {
    await navigate(s.route);
    await new Promise((r) => setTimeout(r, 350));
  }
  if (!state) return;
  closeAllModals();
  state.target = s.sel ? await findTarget(s.sel) : null;
  if (!state) return;
  if (state.target) state.target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const total = state.tour.steps.length;
  tip.innerHTML = `
    <div class="tour-step">${state.i + 1} de ${total}</div>
    <div class="tour-title">${esc(s.title)}</div>
    <div class="tour-text">${esc(s.text)}</div>
    <div class="tour-dots">${Array.from({ length: total }, (_, k) => `<i class="${k === state.i ? 'on' : ''}"></i>`).join('')}</div>
    <div class="tour-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-t="stop">${s.final ? 'Cerrar' : 'Salir'}</button>
      <span class="grow"></span>
      ${state.i > 0 ? `<button type="button" class="btn btn-secondary btn-sm" data-t="prev">${icon('arrowLeft')}</button>` : ''}
      ${s.final && videoOk ? `<button type="button" class="btn btn-secondary btn-sm" data-t="video">${icon('eye')} Ver video</button>` : ''}
      <button type="button" class="btn btn-primary btn-sm" data-t="next">${state.i === total - 1 ? 'Terminar' : 'Siguiente'} ${state.i === total - 1 ? '' : icon('arrowRight')}</button>
    </div>`;
  tip.querySelector('[data-t="stop"]').onclick = stopTour;
  tip.querySelector('[data-t="next"]').onclick = () => go(1);
  const pv = tip.querySelector('[data-t="prev"]'); if (pv) pv.onclick = () => go(-1);
  const vd = tip.querySelector('[data-t="video"]'); if (vd) vd.onclick = () => { stopTour(); openVideo(); };
  tip.classList.remove('busy');
  place();
  tip.querySelector('[data-t="next"]').focus({ preventScroll: true });
}

function place() {
  if (!state) return;
  const spot = state.root.querySelector('.tour-spot');
  const tip = state.root.querySelector('.tour-tip');
  const vw = innerWidth, vh = innerHeight, pad = 8;
  const el = state.target;
  if (!el || !document.contains(el)) {
    spot.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0;`;
    tip.className = 'tour-tip center';
    tip.style.left = `${Math.max(12, (vw - tip.offsetWidth) / 2)}px`;
    tip.style.top = `${Math.max(12, (vh - tip.offsetHeight) / 2)}px`;
    return;
  }
  const r = el.getBoundingClientRect();
  const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
  const w = Math.min(vw - x - 4, r.width + pad * 2), h = Math.min(vh - y - 4, r.height + pad * 2);
  spot.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
  const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 14;
  let left, top, side;
  if (y + h + gap + th <= vh - 8) { side = 'bottom'; top = y + h + gap; left = x + w / 2 - tw / 2; }
  else if (y - gap - th >= 8) { side = 'top'; top = y - gap - th; left = x + w / 2 - tw / 2; }
  else if (x + w + gap + tw <= vw - 8) { side = 'right'; left = x + w + gap; top = y + h / 2 - th / 2; }
  else if (x - gap - tw >= 8) { side = 'left'; left = x - gap - tw; top = y + h / 2 - th / 2; }
  else { side = 'inside'; left = vw / 2 - tw / 2; top = vh - th - 16; }
  left = Math.max(10, Math.min(vw - tw - 10, left));
  top = Math.max(10, Math.min(vh - th - 10, top));
  tip.className = `tour-tip side-${side}`;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

// ======================================================================
// Ayuda: lista de recorridos y video tutorial
// ======================================================================
export const VIDEO_URL = '/tutorial/sano-taller-tutorial.mp4';

export function openVideo() {
  const m = openModal({
    title: 'Video tutorial', sub: 'Cómo usar SanoTaller, paso a paso', size: 'xl',
    body: `<video class="tutorial-video" src="${VIDEO_URL}" poster="/tutorial/portada.jpg" controls autoplay playsinline preload="metadata"></video>`,
    footer: '<a class="btn btn-secondary" href="' + VIDEO_URL + '" download>' + icon('download') + ' Descargar</a><button class="btn btn-primary" data-close>Cerrar</button>'
  });
  return m;
}

let videoOk = null;
async function hasVideo() {
  if (videoOk != null) return videoOk;
  try { const r = await fetch(VIDEO_URL, { method: 'HEAD' }); videoOk = r.ok && /video/.test(r.headers.get('content-type') || ''); } catch (_) { videoOk = false; }
  return videoOk;
}

export async function openHelp() {
  const video = await hasVideo();
  const m = openModal({
    title: 'Ayuda', sub: video ? 'Elige un recorrido guiado o mira el video tutorial' : 'Elige un recorrido guiado', size: 'md',
    body: `<div class="stack">
      ${video ? `<button type="button" class="help-video" data-video><span class="help-play">${icon('arrowRight')}</span><span><b>Video tutorial</b><small>Las funciones principales explicadas con voz</small></span></button>` : ''}
      <div class="section-title">Recorridos guiados</div>
      <div class="help-list">${Object.entries(TOURS).map(([k, t]) => `<button type="button" class="help-item" data-tour-id="${k}"><span class="kpi-icon tone-brand" style="width:36px;height:36px">${icon(t.icon)}</span><span class="grow"><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></span>${icon('arrowRight')}</button>`).join('')}</div>
    </div>`,
    footer: '<button class="btn btn-primary" data-close>Cerrar</button>'
  });
  const vb = m.el.querySelector('[data-video]'); if (vb) vb.onclick = () => { m.close(); openVideo(); };
  m.el.querySelectorAll('[data-tour-id]').forEach((b) => b.onclick = () => { m.close(); startTour(b.dataset.tourId); });
}
