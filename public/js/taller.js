// SanoTaller — Conocimiento del taller: vehículos, marcas, plan de mantenimiento por kilometraje y fecha,
// órdenes de trabajo, inspección de ingreso, autolavado, agenda, más presentaciones, lotes y equivalentes del inventario
import { round2, normalize, todayKey, dayKey, addDays, fromKey, qtyFmt, num } from './utils.js';

// ======================================================================
// VEHÍCULOS
// ======================================================================
export const VTYPES = {
  carro: { label: 'Carro', emoji: '🚗', color: '#2563eb' },
  camioneta: { label: 'Camioneta', emoji: '🚙', color: '#0d9488' },
  pickup: { label: 'Pickup', emoji: '🛻', color: '#ea580c' },
  moto: { label: 'Moto', emoji: '🏍️', color: '#db2777' },
  camion: { label: 'Camión', emoji: '🚚', color: '#ca8a04' },
  van: { label: 'Van / bus', emoji: '🚐', color: '#7c3aed' },
  otro: { label: 'Otro', emoji: '🔧', color: '#64748b' }
};
export const vtypeOf = (v) => VTYPES[v?.type] || VTYPES.carro;
export const BRANDS = {
  Toyota: ['Corolla', 'Yaris', 'Hilux', 'Fortuner', '4Runner', 'Land Cruiser (Machito)', 'Prado', 'Terios', 'Camry', 'RAV4', 'Starlet'],
  Chevrolet: ['Aveo', 'Optra', 'Spark', 'Cruze', 'Corsa', 'Silverado', 'Captiva', 'Grand Vitara', 'Tahoe', 'Malibu', 'Sail', 'Luv D-Max'],
  Ford: ['Fiesta', 'Focus', 'Ka', 'EcoSport', 'Explorer', 'Ranger', 'F-150', 'Fusion', 'Escape', 'Bronco'],
  Hyundai: ['Accent', 'Elantra', 'Getz', 'Tucson', 'Santa Fe', 'i10', 'Creta'],
  Kia: ['Rio', 'Picanto', 'Cerato', 'Sportage', 'Sorento', 'Soluto'],
  Mitsubishi: ['Lancer', 'Montero', 'Montero Sport', 'L200', 'Outlander', 'Signo'],
  Nissan: ['Sentra', 'Versa', 'Tiida', 'March', 'Frontier', 'X-Trail', 'Patrol'],
  Renault: ['Logan', 'Sandero', 'Duster', 'Clio', 'Symbol', 'Megane'],
  Volkswagen: ['Gol', 'Jetta', 'Fox', 'Polo', 'Golf', 'Amarok'],
  Mazda: ['Mazda 3', 'Mazda 6', 'Allegro', 'BT-50', 'CX-5'],
  Honda: ['Civic', 'Accord', 'Fit', 'CR-V'],
  Jeep: ['Grand Cherokee', 'Cherokee', 'Wrangler', 'Compass', 'Liberty'],
  Fiat: ['Palio', 'Siena', 'Uno', 'Strada', 'Fiorino'],
  Chery: ['Tiggo', 'Arauca', 'Orinoco', 'QQ'],
  Peugeot: ['206', '207', '307', '208', '2008'],
  Suzuki: ['Swift', 'Grand Vitara', 'Jimny', 'GN 125'],
  Bera: ['Cobra', 'SBR', 'Socialista', 'BR 200'],
  Empire: ['Keeway Horse', 'Owen', 'Speed'],
  Yamaha: ['YBR 125', 'DT 175', 'FZ', 'XTZ'],
  Otra: []
};
export const FUELS = { gasolina: 'Gasolina', diesel: 'Diésel', gas: 'Gas (GNV)', hibrido: 'Híbrido', electrico: 'Eléctrico' };
export const GEARS = { sincronico: 'Sincrónico', automatico: 'Automático' };
export const COLORS = ['Blanco', 'Negro', 'Gris', 'Plata', 'Rojo', 'Azul', 'Verde', 'Beige', 'Dorado', 'Vinotinto', 'Marrón', 'Amarillo', 'Naranja'];
export const OILS = ['5W-30 sintético', '10W-30 semisintético', '15W-40 mineral', '20W-50 mineral', '0W-20 sintético', '5W-40 sintético', '15W-40 diésel'];

/** Placa normalizada: mayúsculas sin espacios ni guiones */
export const plateKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const vehicleName = (v) => [v?.brand, v?.model, v?.year].filter(Boolean).join(' ') || 'Vehículo';
export const vehicleLine = (v) => [vehicleName(v), v?.color, v?.km ? `${num(v.km, 0)} km` : ''].filter(Boolean).join(' · ');

// ======================================================================
// KILOMETRAJE: lectura y estimación por uso promedio
// ======================================================================
const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);
/** Km por día que recorre el vehículo según sus lecturas (entre 5 y 400), o el valor por defecto */
export function kmPerDay(v, fallback = 35) {
  const log = (v?.kmLog || []).filter((x) => Number(x.km) > 0).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (log.length >= 2) {
    const a = log[0], b = log[log.length - 1];
    const d = daysBetween(a.date, b.date);
    if (d >= 7 && b.km > a.km) return Math.min(400, Math.max(5, (b.km - a.km) / d));
  }
  return Number(fallback) || 35;
}
/** Kilometraje estimado hoy (última lectura + uso promedio) */
export function estKm(v, fallback) {
  const km = Number(v?.km) || 0;
  if (!km || !v?.kmAt) return km;
  const d = Math.max(0, daysBetween(String(v.kmAt).slice(0, 10), todayKey()));
  return Math.round(km + d * kmPerDay(v, fallback));
}

// ======================================================================
// PLAN DE MANTENIMIENTO (cada cuántos km o días se repite cada servicio)
// ======================================================================
export const MAINT_DEFAULT = [
  { id: 'm_aceite', name: 'Cambio de aceite y filtro', everyKm: 5000, everyDays: 180, icon: 'droplet' },
  { id: 'm_aire', name: 'Filtro de aire', everyKm: 15000, everyDays: 365, icon: 'wind' },
  { id: 'm_gasolina', name: 'Filtro de gasolina', everyKm: 20000, everyDays: 365, icon: 'fuel' },
  { id: 'm_bujias', name: 'Bujías', everyKm: 30000, everyDays: 730, icon: 'zap' },
  { id: 'm_frenos', name: 'Revisión de frenos (pastillas)', everyKm: 20000, everyDays: 365, icon: 'target' },
  { id: 'm_liqfrenos', name: 'Líquido de frenos', everyKm: 40000, everyDays: 730, icon: 'droplet' },
  { id: 'm_refrig', name: 'Refrigerante', everyKm: 40000, everyDays: 730, icon: 'snow' },
  { id: 'm_correa', name: 'Correa de tiempo', everyKm: 60000, everyDays: 1460, icon: 'refresh' },
  { id: 'm_alineacion', name: 'Alineación y balanceo', everyKm: 10000, everyDays: 180, icon: 'gauge' },
  { id: 'm_caja', name: 'Aceite de caja', everyKm: 60000, everyDays: 1095, icon: 'settings' },
  { id: 'm_bateria', name: 'Revisión de batería', everyKm: 0, everyDays: 365, icon: 'battery' }
];
/** Lo más reciente de cada servicio del plan (los anteriores quedan como historial) */
export function latestBy(list = [], key = (x) => x.name) {
  const m = new Map();
  for (const x of [...list].sort((a, b) => (a.date || '').localeCompare(b.date || ''))) m.set(normalize(key(x)), x);
  return [...m.values()];
}
/**
 * Pendientes del plan de un vehículo: [{ id, name, date, km, nextKm, next, d (días), left (km que faltan), urgency }]
 * La urgencia combina km y fecha: lo primero que se cumpla manda.
 */
export function dueItems(v, { kmDay, kmWarn = 500, dayWarn = 7 } = {}) {
  if (!v || v.active === false) return [];
  const now = estKm(v, kmDay);
  const out = [];
  for (const s of latestBy(v.services || [])) {
    if (!s.next && !s.nextKm) continue;
    const d = s.next ? daysBetween(todayKey(), s.next) : null;
    const left = s.nextKm ? Math.round(s.nextKm - now) : null;
    // Días equivalentes por km para ordenar: km que faltan / km por día
    const dk = left != null ? left / Math.max(1, kmPerDay(v, kmDay)) : null;
    const urgency = Math.min(d ?? 99999, dk ?? 99999);
    const late = (d != null && d < 0) || (left != null && left < 0);
    const soon = !late && ((d != null && d <= dayWarn) || (left != null && left <= kmWarn));
    out.push({ id: s.id, name: s.name, date: s.date, km: s.km, nextKm: s.nextKm || null, next: s.next || '', d, left, urgency, late, soon });
  }
  return out.sort((a, b) => a.urgency - b.urgency);
}
export const dueTone = (it) => (!it ? 'neutral' : it.late ? 'danger' : it.soon ? 'warning' : it.urgency <= 30 ? 'info' : 'success');
export function dueText(it) {
  if (!it) return '';
  const bits = [];
  if (it.left != null) bits.push(it.left < 0 ? `pasado ${num(-it.left, 0)} km` : `faltan ${num(it.left, 0)} km`);
  if (it.d != null && (it.left == null || it.d <= 30)) bits.push(it.d < 0 ? `vencido hace ${-it.d} d` : it.d === 0 ? 'toca hoy' : `en ${it.d} d`);
  return bits.join(' · ');
}

// ======================================================================
// ÓRDENES DE TRABAJO
// ======================================================================
export const JOB_TYPES = {
  mantenimiento: { label: 'Mantenimiento', icon: 'droplet', tone: 'info' },
  reparacion: { label: 'Reparación', icon: 'wrench', tone: 'brand' },
  diagnostico: { label: 'Diagnóstico', icon: 'cpu', tone: 'violet' },
  frenos: { label: 'Frenos y suspensión', icon: 'target', tone: 'warning' },
  electricidad: { label: 'Electricidad', icon: 'zap', tone: 'warning' },
  aire: { label: 'Aire acondicionado', icon: 'snow', tone: 'info' },
  latoneria: { label: 'Latonería y pintura', icon: 'spray', tone: 'violet' },
  cauchos: { label: 'Cauchos y alineación', icon: 'gauge', tone: 'neutral' },
  garantia: { label: 'Garantía', icon: 'shieldCheck', tone: 'success' }
};
export const JOB_STATUS = {
  recibido: { label: 'Recibido', tone: 'neutral', icon: 'door' },
  diagnostico: { label: 'En diagnóstico', tone: 'violet', icon: 'cpu' },
  presupuesto: { label: 'Esperando aprobación', tone: 'warning', icon: 'file' },
  aprobado: { label: 'Aprobado', tone: 'info', icon: 'check' },
  reparacion: { label: 'En reparación', tone: 'info', icon: 'wrench' },
  repuesto: { label: 'Esperando repuesto', tone: 'danger', icon: 'truck' },
  listo: { label: 'Listo para entregar', tone: 'success', icon: 'bell' },
  entregado: { label: 'Entregado', tone: 'neutral', icon: 'checkCircle' },
  cancelado: { label: 'Cancelado', tone: 'neutral', icon: 'x' }
};
export const OPEN_JOB = ['recibido', 'diagnostico', 'presupuesto', 'aprobado', 'reparacion', 'repuesto', 'listo'];
/** Columnas del tablero (aprobado se muestra junto a "en reparación") */
export const BOARD = [
  ['recibido', ['recibido', 'diagnostico']],
  ['presupuesto', ['presupuesto']],
  ['reparacion', ['aprobado', 'reparacion']],
  ['repuesto', ['repuesto']],
  ['listo', ['listo']]
];
export const jobBadge = (s) => { const st = JOB_STATUS[s] || { label: s, tone: 'neutral' }; return `<span class="badge badge-${st.tone}"><i class="dotc"></i>${st.label}</span>`; };
export const FUEL_LEVELS = ['Reserva', '1/4', '1/2', '3/4', 'Lleno'];
/** Inspección de ingreso: lo que se revisa y lo que trae el vehículo */
export const CHECK_ITEMS = ['Luces', 'Frenos', 'Cauchos', 'Limpiaparabrisas', 'Batería', 'Aceite de motor', 'Refrigerante', 'Aire acondicionado', 'Vidrios', 'Tapicería'];
export const CHECK_STATE = { ok: { label: 'Bien', tone: 'success' }, obs: { label: 'Revisar', tone: 'warning' }, mal: { label: 'Mal', tone: 'danger' } };
export const BELONGINGS = ['Caucho de repuesto', 'Gato', 'Llave de cauchos', 'Triángulo', 'Extintor', 'Radio / reproductor', 'Alfombras', 'Herramientas', 'Documentos', 'Control de alarma'];
/** Zonas de la carrocería para marcar daños en el diagrama */
export const ZONES = {
  frente: 'Parachoques delantero', capo: 'Capó', parabrisas: 'Parabrisas', techo: 'Techo', maleta: 'Maleta', trasero: 'Parachoques trasero',
  izq_del: 'Lateral izquierdo delantero', izq_tras: 'Lateral izquierdo trasero', der_del: 'Lateral derecho delantero', der_tras: 'Lateral derecho trasero'
};
export const DAMAGE = { rayon: 'Rayón', golpe: 'Golpe / abolladura', roto: 'Roto / partido', oxido: 'Óxido' };
/** Fallas frecuentes para escribir con un toque */
export const COMPLAINTS = ['Cambio de aceite', 'Ruido al frenar', 'Se recalienta', 'No enciende', 'Vibra en el volante', 'Check engine encendido', 'Falla el aire acondicionado', 'Pierde aceite', 'Ruido en la suspensión', 'Jala hacia un lado', 'Batería descargada', 'Consume mucha gasolina'];
export const LINE_KINDS = { mano: 'Mano de obra', repuesto: 'Repuesto', externo: 'Repuesto externo', servicio: 'Servicio' };

/** Totales de las líneas de una orden (solo las aprobadas si `approvedOnly`) */
export function jobTotals(job, approvedOnly = false) {
  const lines = (job?.lines || []).filter((l) => !approvedOnly || l.approved !== false);
  const labor = round2(lines.filter((l) => l.kind === 'mano').reduce((a, l) => a + (Number(l.price) || 0) * (Number(l.qty) || 0), 0));
  const parts = round2(lines.filter((l) => l.kind !== 'mano').reduce((a, l) => a + (Number(l.price) || 0) * (Number(l.qty) || 0), 0));
  return { labor, parts, total: round2(labor + parts), count: lines.length };
}

// ======================================================================
// EQUIPO Y AGENDA
// ======================================================================
export const STAFF_ROLES = { mecanico: 'Mecánico', lavador: 'Lavador(a)', asesor: 'Asesor de servicio', caja: 'Recepción y caja' };
export const SERVICES = {
  mantenimiento: { label: 'Mantenimiento', icon: 'droplet', minutes: 60, role: 'mecanico', color: '#2563eb' },
  diagnostico: { label: 'Diagnóstico', icon: 'cpu', minutes: 60, role: 'mecanico', color: '#7c3aed' },
  reparacion: { label: 'Reparación', icon: 'wrench', minutes: 120, role: 'mecanico', color: '#ea580c' },
  frenos: { label: 'Frenos', icon: 'target', minutes: 90, role: 'mecanico', color: '#dc2626' },
  cauchos: { label: 'Alineación y balanceo', icon: 'gauge', minutes: 45, role: 'mecanico', color: '#0d9488' },
  lavado: { label: 'Lavado', icon: 'spray', minutes: 40, role: 'lavador', color: '#0891b2' },
  revision: { label: 'Revisión general', icon: 'clipboard', minutes: 45, role: 'mecanico', color: '#ca8a04' }
};
export const APPT_STATUS = {
  pendiente: { label: 'Por confirmar', tone: 'neutral', icon: 'clock' },
  confirmada: { label: 'Confirmada', tone: 'info', icon: 'check' },
  llego: { label: 'Llegó al taller', tone: 'warning', icon: 'door' },
  atendida: { label: 'Recibido', tone: 'success', icon: 'checkCircle' },
  no_vino: { label: 'No vino', tone: 'danger', icon: 'x' },
  cancelada: { label: 'Cancelada', tone: 'neutral', icon: 'x' }
};
export const OPEN_APPT = ['pendiente', 'confirmada', 'llego'];
export const apptBadge = (s) => { const st = APPT_STATUS[s] || { label: s, tone: 'neutral' }; return `<span class="badge badge-${st.tone}"><i class="dotc"></i>${st.label}</span>`; };

// ======================================================================
// AUTOLAVADO
// ======================================================================
export const WASH_STATUS = {
  espera: { label: 'En cola', tone: 'neutral', icon: 'clock' },
  lavando: { label: 'Lavando', tone: 'info', icon: 'droplet' },
  secado: { label: 'Secado y aspirado', tone: 'violet', icon: 'wind' },
  listo: { label: 'Listo para retirar', tone: 'success', icon: 'bell' },
  entregado: { label: 'Entregado', tone: 'neutral', icon: 'check' }
};
export const WASH_FLOW = ['espera', 'lavando', 'secado', 'listo', 'entregado'];
export const WASH_TYPES_DEFAULT = [
  { id: 'w_sencillo', name: 'Lavado sencillo', minutes: 20 },
  { id: 'w_completo', name: 'Lavado completo', minutes: 40 },
  { id: 'w_motor', name: 'Lavado de motor', minutes: 25 },
  { id: 'w_aspirado', name: 'Aspirado', minutes: 15 },
  { id: 'w_pulitura', name: 'Pulitura y encerado', minutes: 90 },
  { id: 'w_tapiceria', name: 'Limpieza de tapicería', minutes: 120 }
];

// ======================================================================
// INVENTARIO (repuestos, lubricantes y accesorios)
// ======================================================================
export const FORMS = ['Unidad', 'Juego', 'Kit', 'Litro', 'Galón', 'Pipote / tambor', 'Caja', 'Par', 'Metro', 'Servicio', 'Otro'];
export const CATEGORIES = ['Aceites y lubricantes', 'Filtros', 'Frenos', 'Suspensión y dirección', 'Encendido (bujías y cables)', 'Correas y tensores', 'Refrigeración', 'Electricidad y baterías', 'Cauchos', 'Iluminación', 'Aditivos y líquidos', 'Accesorios', 'Productos de lavado', 'Servicios de taller', 'Servicios de lavado', 'Otros'];

/** Condición de venta: en el taller todo es venta libre (se conserva por compatibilidad con el punto de venta) */
export const RX = { libre: { label: 'Venta libre', short: 'Libre', tone: 'success', icon: 'checkCircle', needs: false } };
export const rxOf = () => RX.libre;
export const needsRx = () => false;
export const rxBadge = () => '';

export const LOYALTY_DEFAULT = { enabled: true, per: 1, pointValue: 0.05, minRedeem: 100 };

// ======================================================================
// FRACCIONADO: el stock se guarda en UNIDADES (bujías sueltas, litros de aceite de un pipote…)
// ======================================================================
export const PACKS = { caja: 'Completo', blister: 'Blíster / tira', unidad: 'Suelto' };
/** Unidades por caja */
export const upb = (p) => Math.max(1, Math.round(Number(p?.unitsPerBox) || 1));
export const fractionable = (p) => upb(p) > 1 && p?.fraction !== false;
export const hasBlister = (p) => fractionable(p) && Number(p?.blister) > 1 && Number(p.blister) < upb(p);
/** Cuántas unidades trae cada presentación */
export function packFactor(p, pack) {
  if (pack === 'unidad') return 1;
  if (pack === 'blister') return hasBlister(p) ? Math.round(Number(p.blister)) : upb(p);
  return upb(p);
}
/** Presentaciones que se pueden vender de este producto */
export function packsOf(p) {
  const out = ['caja'];
  if (hasBlister(p)) out.push('blister');
  if (fractionable(p)) out.push('unidad');
  return out;
}
/** Precio de venta de una presentación (la caja es el precio base; fraccionar tiene un recargo opcional) */
export function packPrice(p, pack, markup = 0) {
  const box = Number(p?.price) || 0;
  if (pack === 'caja' || !fractionable(p)) return round2(box);
  if (pack === 'unidad' && Number(p.unitPrice) > 0) return round2(p.unitPrice);
  if (pack === 'blister' && Number(p.blisterPrice) > 0) return round2(p.blisterPrice);
  const k = 1 + (Number(markup) || 0) / 100;
  return round2((box / upb(p)) * packFactor(p, pack) * k);
}
export const unitCost = (p) => (Number(p?.cost) || 0) / upb(p);
/** Nombre de la unidad suelta (unidad, litro…) y del empaque completo (juego, pipote…) */
export const unitName = (p) => String(p?.unitName || '').trim() || 'und';
export const boxName = (p) => String(p?.boxName || '').trim() || 'Caja';
export const packLabel = (p, pack) => {
  if (!fractionable(p) || pack === 'caja') return upb(p) > 1 ? `${boxName(p)} x${upb(p)} ${unitName(p)}` : 'Unidad';
  if (pack === 'blister') return `Blíster x${packFactor(p, 'blister')}`;
  return `Por ${unitName(p)}`;
};
/** "3 cajas + 5 und" */
export function stockText(p, units = p?.stock) {
  const u = Math.max(0, Math.round(Number(units) || 0));
  const k = upb(p);
  if (k <= 1) return `${qtyFmt(u)}`;
  const b = Math.floor(u / k); const r = u % k; const un = unitName(p); const bx = boxName(p).toLowerCase();
  if (!b) return `${r} ${un}`;
  return `${b} ${bx}${b === 1 ? '' : 's'}${r ? ` + ${r} ${un}` : ''}`;
}
export const boxesOf = (p, units = p?.stock) => (Number(units) || 0) / upb(p);

// ======================================================================
// LOTES Y VENCIMIENTOS (FEFO: lo que vence primero, sale primero)
// ======================================================================
export const lotsOf = (p) => (p?.lots || []).filter((l) => (Number(l.qty) || 0) > 0).sort((a, b) => (a.exp || '9999').localeCompare(b.exp || '9999'));
export const nextExpiry = (p) => lotsOf(p).find((l) => l.exp)?.exp || '';
/** Saca `units` de los lotes empezando por el que vence primero. Devuelve los lotes nuevos y lo que salió de cada uno. */
export function consumeLots(lots, units) {
  const list = (lots || []).map((l) => ({ ...l })).sort((a, b) => (a.exp || '9999').localeCompare(b.exp || '9999'));
  let left = Math.max(0, Number(units) || 0);
  const used = [];
  for (const l of list) {
    if (left <= 0) break;
    const q = Math.min(Number(l.qty) || 0, left);
    if (q <= 0) continue;
    l.qty = (Number(l.qty) || 0) - q; left -= q;
    used.push({ lot: l.lot || '', exp: l.exp || '', qty: q });
  }
  return { lots: list.filter((l) => l.qty > 0), used, missing: left };
}
/** Devuelve unidades a sus lotes (anulación o devolución) */
export function restoreLots(lots, used) {
  const list = (lots || []).map((l) => ({ ...l }));
  for (const u of used || []) {
    const hit = list.find((l) => (l.lot || '') === (u.lot || '') && (l.exp || '') === (u.exp || ''));
    if (hit) hit.qty = (Number(hit.qty) || 0) + u.qty; else list.push({ lot: u.lot || '', exp: u.exp || '', qty: u.qty });
  }
  return list.sort((a, b) => (a.exp || '9999').localeCompare(b.exp || '9999'));
}
/** Agrega una entrada a un lote (si ya existe el mismo lote y fecha, suma) */
export function addLot(lots, { lot = '', exp = '', qty = 0, cost = 0 }) {
  const list = (lots || []).map((l) => ({ ...l }));
  const hit = list.find((l) => (l.lot || '') === lot && (l.exp || '') === exp);
  if (hit) hit.qty = (Number(hit.qty) || 0) + qty; else list.push({ lot, exp, qty, cost: round2(cost), in: todayKey() });
  return list.filter((l) => l.qty > 0).sort((a, b) => (a.exp || '9999').localeCompare(b.exp || '9999'));
}
/** Días que faltan para vencer (negativo = vencido) */
export const daysToExpiry = (exp) => (exp ? Math.round((fromKey(exp) - fromKey(todayKey())) / 864e5) : null);
export function expiryTone(exp) {
  const d = daysToExpiry(exp);
  if (d == null) return ['', 'neutral'];
  if (d < 0) return ['Vencido', 'danger'];
  if (d <= 30) return [`Vence en ${d} d`, 'danger'];
  if (d <= 60) return [`Vence en ${d} d`, 'warning'];
  if (d <= 90) return [`Vence en ${d} d`, 'info'];
  return [`Vence ${exp.slice(5, 7)}/${exp.slice(2, 4)}`, 'neutral'];
}
export const expBadge = (exp) => { if (!exp) return ''; const [t, tone] = expiryTone(exp); return `<span class="badge badge-${tone}">${t}</span>`; };
export const limitDay = (days) => dayKey(addDays(new Date(), days));

// ======================================================================
// EQUIVALENTES (misma referencia OEM y misma medida: otra marca del mismo repuesto)
// ======================================================================
const key = (s) => normalize(s).replace(/[^a-z0-9]+/g, ' ').trim();
export const molecule = (p) => key(p?.active || '');
export const strengthKey = (p) => key(p?.strength || '').replace(/\s+/g, '');
export function equivalents(p, products) {
  const m = molecule(p);
  if (!m) return [];
  const s = strengthKey(p);
  return products.filter((x) => x.id !== p.id && x.active !== false && x.sellable !== false && molecule(x) === m && (!s || !strengthKey(x) || strengthKey(x) === s))
    .sort((a, b) => (Number(a.price) / upb(a)) - (Number(b.price) / upb(b)));
}
/** Texto de búsqueda de un producto */
export const searchText = (p) => normalize(`${p.name} ${p.active || ''} ${p.strength || ''} ${p.form || ''} ${p.lab || ''} ${p.barcode || ''} ${p.sku || ''} ${p.category || ''} ${p.location || ''} ${p.fits || ''}`);
export const productLine = (p) => [p.active && p.active !== p.name ? `Ref. ${p.active}` : '', p.strength, p.lab, upb(p) > 1 ? `x${upb(p)}` : '', p.fits ? `para ${p.fits}` : ''].filter(Boolean).join(' · ');
