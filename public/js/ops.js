// SanoTaller — Operaciones: clientes y vehículos, plan de mantenimiento, órdenes de trabajo y presupuestos, agenda, autolavado, ventas, inventario, compras, pedidos y caja
import { auth } from './firebase.js';
import { store } from './store.js';
import { round2, round4, nowISO, todayKey, dayKey, PAY_METHODS, addDays, loc, usd, fmtDate, normalize, num } from './utils.js';
import { consumeLots, restoreLots, addLot, nextExpiry, upb, packFactor, rxOf, needsRx, unitCost, stockText, productLine, latestBy, kmPerDay, vehicleName, plateKey, JOB_STATUS, JOB_TYPES, LINE_KINDS, WASH_STATUS, jobTotals } from './taller.js';

export const APP_URL = 'https://sano-taller.web.app';
export const by = () => (auth.currentUser?.isAnonymous ? 'demo' : (auth.currentUser?.email || '').split('@')[0] || '—');
const FLOW0 = () => ({ inUSD: 0, inBs: 0, outUSD: 0, outBs: 0 });

const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function genCode(n = 8) { return Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => CODE_ALPHA[x % CODE_ALPHA.length]).join(''); }
export const cardUrl = (code) => `${APP_URL}/vehiculo/${code}`;
export const shopUrl = (slug) => `${APP_URL}/pedido/${slug}`;
export const fmtSeq = (prefix, n, len = 5) => `${prefix}-${String(n).padStart(len, '0')}`;
export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'taller';
}

// ======================================================================
// PAGOS Y CAJA
// ======================================================================
export function normalizePays(payments) {
  return (payments || []).filter((p) => p.amount > 0.004).map((p) => ({ method: p.method, currency: loc().cur, amount: round2(p.amount), usd: round4(p.amount) }));
}
export function methodNet(sale) {
  const m = {};
  (sale.payments || []).forEach((p) => { m[p.method] = round4((m[p.method] || 0) + (p.usd || 0)); });
  const ch = Number(sale.changeUSD) || 0;
  if (ch > 0.004) m.efectivo = round4((m.efectivo || 0) - ch);
  return m;
}
export function cashFlowOf(payments, changeUSD) {
  const f = FLOW0();
  for (const p of payments) if (PAY_METHODS[p.method]?.cash) f.inUSD += p.amount;
  if (changeUSD > 0.004) f.outUSD += round2(changeUSD);
  for (const k in f) f[k] = round2(f[k]);
  return f;
}
function shiftIncrements(flow, extra = {}) {
  const u = {};
  for (const k of ['inUSD', 'inBs', 'outUSD', 'outBs']) if (flow[k]) u[k] = store.inc(flow[k]);
  for (const [k, v] of Object.entries(extra)) if (v) u[k] = store.inc(round4(v));
  u.updatedAt = nowISO();
  return u;
}
function preparePayment({ amount, payments }) {
  const shift = store.openShift;
  if (!shift) throw new Error('Abre la caja antes de cobrar (menú Caja).');
  const pays = normalizePays(payments);
  const paidUSD = round4(pays.reduce((a, p) => a + p.usd, 0));
  if (paidUSD < amount - 0.01) throw new Error(`Falta por cobrar ${usd(amount - paidUSD)}.`);
  const changeUSD = round2(Math.max(0, paidUSD - amount));
  return { shift, pays, paidUSD, changeUSD, flow: cashFlowOf(pays, changeUSD), received: round2(paidUSD - changeUSD) };
}
const NO_PAY = () => ({ shift: store.openShift || null, pays: [], paidUSD: 0, changeUSD: 0, flow: FLOW0(), received: 0 });
function addToShift(b, pay) {
  if (!pay.shift || !(pay.received > 0)) return;
  const byMethod = {};
  for (const [k, v] of Object.entries(methodNet({ payments: pay.pays, changeUSD: pay.changeUSD }))) byMethod[`byMethod.${k}`] = v;
  b.update(store.ref('cash_shifts', pay.shift.id), shiftIncrements(pay.flow, { salesCount: 1, salesTotal: pay.received, ...byMethod }));
}
function paymentFields(pay) {
  return {
    rate: 1, payments: pay.pays, paidUSD: pay.paidUSD, changeUSD: pay.changeUSD, changeCurrency: 'USD',
    method: pay.pays.length === 1 ? pay.pays[0].method : pay.pays.length ? 'mixto' : 'ninguno', received: pay.received,
    shiftId: pay.shift?.id || null, cashFlow: pay.flow, fxRate: Number(store.settings.fx?.enabled ? store.settings.fx.rate : 0) || 0
  };
}
export function clientFields(c) {
  return { memberId: c?.id || null, memberName: c?.name || 'Cliente de mostrador', memberPhone: c?.phone || '', memberIdDoc: c?.idDoc || '', memberNumber: c?.number || '' };
}
function newSaleDoc(b, { kind, items, subtotal, discount = 0, pay, client, extra = {} }) {
  const seq = store.nextSeq(b, 'inv');
  const number = fmtSeq(store.settings.invoicePrefix || 'F', seq, 6);
  const ref = store.newRef('sales');
  const total = round2(subtotal - discount);
  const sale = {
    number, seq, kind, date: nowISO(), dayKey: todayKey(), items, subtotal: round2(subtotal), discount: round2(discount), total,
    cost: round2(items.reduce((a, i) => a + (Number(i.cost) || 0) * (Number(i.qty) || 0), 0)),
    ...paymentFields(pay), ...clientFields(client), status: 'completed', by: by(), ...extra
  };
  b.set(ref, sale);
  addToShift(b, pay);
  return { id: ref.id, ...sale };
}

// ======================================================================
// FICHA PÚBLICA DEL VEHÍCULO (colección pública cards/{código}: datos mínimos, sin datos personales del cliente)
// ======================================================================
export function cardData(v, extra = {}) {
  const owner = v.ownerId ? store.client(v.ownerId) : null;
  const first = String(owner?.name || v.ownerName || '').trim().split(/\s+/)[0] || '';
  const job = store.jobOfVehicle(v.id);
  const services = latestBy(v.services || []).map((s) => ({ name: s.name, date: s.date || '', km: Number(s.km) || null, next: s.next || '', nextKm: Number(s.nextKm) || null }));
  return {
    tenantId: store.tenantId, shop: store.businessName, shopPhone: store.settings.whatsapp || store.settings.phone || '', shopAddress: store.settings.address || '',
    instagram: store.settings.instagram || '', country: store.settings.country || '', shopSlug: store.settings.shop?.enabled ? store.settings.shop.slug || '' : '',
    plate: v.plate || '', number: v.number || '', type: v.type || 'carro', brand: v.brand || '', model: v.model || '', year: v.year || '', color: v.color || '',
    fuel: v.fuel || '', oil: v.oil || '', km: Number(v.km) || null, kmAt: v.kmAt || '', kmDay: kmPerDay(v, store.settings.kmPerDay), photo: v.photo && v.photo.length < 60000 ? v.photo : '',
    owner: first, active: v.active !== false, services, nextControl: v.nextControl || '',
    history: (v.history || []).slice(-12).reverse(),
    job: job ? { number: job.number, status: job.status, promisedAt: job.promisedAt || '', quoteCode: job.status === 'presupuesto' ? job.quoteCode || '' : '', inAt: job.inAt || '' } : null,
    warrantyUntil: v.warrantyUntil || '', warrantyKm: v.warrantyKm || null, warrantyJob: v.warrantyJob || '',
    lastVisitAt: v.lastVisitAt || null, updatedAt: nowISO(), ...extra
  };
}
function putCard(b, v, extra = {}) { if (v?.cardCode) b.set(store.cardRef(v.cardCode), cardData(v, extra), { merge: false }); }
export async function refreshCard(v) { if (!v?.cardCode) return; const b = store.batch(); putCard(b, store.vehicle(v.id) || v); await store.commit(b); }

// ======================================================================
// CLIENTES (dueños de los vehículos)
// ======================================================================
const CLIENT_FIELDS = ['name', 'phone', 'phone2', 'email', 'idDoc', 'address', 'notes', 'agreementId', 'agreementNumber', 'tags', 'howFound', 'company'];
export function cleanClient(data) {
  const out = {};
  for (const k of CLIENT_FIELDS) {
    if (data[k] === undefined) continue;
    out[k] = Array.isArray(data[k]) ? data[k].map((x) => String(x).trim()).filter(Boolean) : String(data[k] ?? '').trim();
  }
  if (out.name) out.name = out.name.replace(/\s+/g, ' ');
  if (out.idDoc) out.idDoc = out.idDoc.toUpperCase().replace(/\s+/g, '');
  return out;
}
function newClientDoc(b, data) {
  const clean = cleanClient(data);
  if (!clean.name) throw new Error('Escribe el nombre del cliente.');
  const dup = clean.phone && store.findByPhone(clean.phone);
  if (dup) throw new Error(`Ya existe un cliente con ese teléfono: ${dup.name} (${dup.number}).`);
  const ref = store.newRef('clients');
  const seq = store.nextSeq(b, 'cli');
  const date = nowISO();
  const c = { ...clean, number: fmtSeq('C', seq, 4), seq, active: true, visits: 0, totalSpent: 0, balance: 0, points: 0, lastVisitAt: null, createdAt: date, updatedAt: date, by: by() };
  b.set(ref, c);
  return { id: ref.id, ...c };
}
export async function saveClient(data, id = null) {
  const b = store.batch();
  if (!id) { const c = newClientDoc(b, data); await store.commit(b); return c; }
  const clean = cleanClient(data);
  const dup = clean.phone && store.findByPhone(clean.phone, id);
  if (dup) throw new Error(`Ya existe un cliente con ese teléfono: ${dup.name} (${dup.number}).`);
  b.set(store.ref('clients', id), { ...clean, updatedAt: nowISO() }, { merge: true });
  // El nombre del cliente se repite en sus vehículos (para buscar y para la ficha pública)
  if (clean.name) for (const v of store.vehiclesOf(id)) { b.set(store.vehRef(v.id), { ownerName: clean.name, ownerPhone: clean.phone ?? v.ownerPhone ?? '' }, { merge: true }); putCard(b, { ...v, ownerName: clean.name }); }
  const c = { ...(store.client(id) || {}), ...clean, id };
  await store.commit(b);
  return c;
}
export async function setClientActive(c, active) {
  await store.save('clients', c.id, { active, updatedAt: nowISO() });
}
function resolveClient(b, client) {
  if (!client) return null;
  if (client.id) return store.client(client.id) || client;
  const dup = client.phone && store.findByPhone(client.phone);
  if (dup) return dup;
  if (!String(client.name || '').trim()) return null;
  return newClientDoc(b, client);
}

// ======================================================================
// VEHÍCULOS
// ======================================================================
const VEH_FIELDS = ['plate', 'type', 'brand', 'model', 'year', 'color', 'vin', 'engine', 'fuel', 'gear', 'oil', 'tires', 'notes', 'photo', 'insurance'];
export function cleanVehicle(d) {
  const out = {};
  for (const k of VEH_FIELDS) if (d[k] !== undefined) out[k] = String(d[k] ?? '').trim();
  if (out.plate != null) out.plate = out.plate.toUpperCase().replace(/\s+/g, ' ');
  if (out.vin) out.vin = out.vin.toUpperCase().replace(/\s+/g, '');
  if (out.year) out.year = out.year.replace(/\D/g, '').slice(0, 4);
  return out;
}
/** Nueva lectura del odómetro (se guarda el historial para estimar el uso diario) */
function kmPatch(cur, km, date = todayKey()) {
  const n = Math.round(Number(km) || 0);
  if (!(n > 0) || n === Number(cur?.km)) return {};
  return { km: n, kmAt: date, kmLog: [...(cur?.kmLog || []).filter((x) => x.date !== date), { date, km: n }].sort((a, b) => a.date.localeCompare(b.date)).slice(-40) };
}
function newVehicleDoc(b, owner, data) {
  const clean = cleanVehicle(data);
  if (!clean.plate) throw new Error('Escribe la placa del vehículo.');
  const dup = store.byPlate(clean.plate);
  if (dup) throw new Error(`La placa ${dup.plate} ya está registrada (${dup.brand || ''} ${dup.model || ''} de ${dup.ownerName || 'otro cliente'}).`);
  if (!owner?.id) throw new Error('Elige el dueño del vehículo.');
  const ref = store.newRef('vehicles');
  const seq = store.nextSeq(b, 'veh');
  const date = nowISO();
  const v = {
    type: 'carro', ...clean, ownerId: owner.id, ownerName: owner.name || '', ownerPhone: owner.phone || '',
    number: fmtSeq('V', seq, 4), seq, cardCode: genCode(8), active: true, km: null, kmAt: '', kmLog: [], ...kmPatch(null, data.km),
    services: [], history: [], visits: 0, lastVisitAt: null, nextControl: '', createdAt: date, updatedAt: date, by: by()
  };
  b.set(ref, v);
  const out = { id: ref.id, ...v };
  putCard(b, out);
  return out;
}
/** Crea (con su dueño, nuevo o existente) o edita un vehículo */
export async function saveVehicle(data, id = null, owner = null) {
  const b = store.batch();
  if (!id) {
    const o = resolveClient(b, owner);
    if (!o) throw new Error('Registra o elige al dueño del vehículo.');
    const vehicle = newVehicleDoc(b, o, data);
    await store.commit(b);
    return { vehicle, owner: o };
  }
  const cur = store.vehicle(id) || {};
  const clean = cleanVehicle(data);
  if (clean.plate) { const dup = store.byPlate(clean.plate, id); if (dup) throw new Error(`La placa ${dup.plate} ya está registrada.`); }
  const patch = { ...clean, ...kmPatch(cur, data.km), updatedAt: nowISO() };
  if (owner?.id && owner.id !== cur.ownerId) Object.assign(patch, { ownerId: owner.id, ownerName: owner.name || '', ownerPhone: owner.phone || '' });
  b.set(store.vehRef(id), patch, { merge: true });
  const vehicle = { ...cur, ...patch, id };
  putCard(b, vehicle);
  await store.commit(b);
  return { vehicle, owner: store.client(vehicle.ownerId) };
}
export async function updateKm(v, km) {
  const cur = store.vehicle(v.id) || v;
  const p = kmPatch(cur, km);
  if (!p.km) return;
  const b = store.batch();
  b.set(store.vehRef(v.id), { ...p, updatedAt: nowISO() }, { merge: true });
  putCard(b, { ...cur, ...p });
  await store.commit(b);
}
export async function setVehicleActive(v, active) {
  const b = store.batch();
  const patch = { active, updatedAt: nowISO() };
  b.set(store.vehRef(v.id), patch, { merge: true });
  putCard(b, { ...v, ...patch });
  await store.commit(b);
}
export async function renewCardCode(v) {
  const b = store.batch(); const code = genCode(8);
  if (v.cardCode) b.delete(store.cardRef(v.cardCode));
  b.set(store.vehRef(v.id), { cardCode: code, updatedAt: nowISO() }, { merge: true });
  putCard(b, { ...v, cardCode: code });
  await store.commit(b);
  return code;
}
const nextFrom = (date, days) => (Number(days) > 0 ? dayKey(addDays(new Date((date || todayKey()) + 'T12:00:00'), Number(days))) : '');
/** Servicio del plan de mantenimiento hecho (calcula el próximo por km y por fecha) */
export function serviceItem(s, v = null) {
  const plan = store.maintPlan.find((m) => m.id === s.maintId || normalize(m.name) === normalize(s.name || ''));
  const km = Math.round(Number(s.km) || Number(v?.km) || 0);
  return {
    id: s.id || 's' + genCode(6).toLowerCase(), maintId: s.maintId || plan?.id || null, name: String(s.name || plan?.name || '').trim(), date: s.date || todayKey(), km: km || null,
    nextKm: s.nextKm !== undefined ? (Number(s.nextKm) || null) : (km && Number(plan?.everyKm) > 0 ? km + Number(plan.everyKm) : null),
    next: s.next !== undefined ? s.next : nextFrom(s.date, plan?.everyDays), note: String(s.note || '').trim(), jobId: s.jobId || null, jobNumber: s.jobNumber || '', at: nowISO()
  };
}
export async function addService(v, s, b0 = null) {
  const b = b0 || store.batch();
  const cur = store.vehicle(v.id) || v;
  const item = serviceItem(s, cur);
  if (!item.name) throw new Error('Elige el servicio.');
  const list = [...(cur.services || []).filter((x) => x.id !== item.id), item].slice(-200);
  const patch = { services: list, updatedAt: nowISO(), ...(item.km && item.km > (Number(cur.km) || 0) ? kmPatch(cur, item.km, item.date) : {}) };
  b.set(store.vehRef(v.id), patch, { merge: true });
  putCard(b, { ...cur, ...patch });
  if (!b0) await store.commit(b);
  return item;
}
export async function removeService(v, sid) {
  const cur = store.vehicle(v.id) || v;
  const list = (cur.services || []).filter((x) => x.id !== sid);
  const b = store.batch();
  b.set(store.vehRef(v.id), { services: list, updatedAt: nowISO() }, { merge: true });
  putCard(b, { ...cur, services: list });
  await store.commit(b);
}
export async function markReminded(v, key) {
  await store.save('vehicles', v.id, { reminded: { ...(v.reminded || {}), [key]: nowISO() } });
}

// ======================================================================
// ÓRDENES DE TRABAJO
// ======================================================================
const logEntry = (text) => ({ at: nowISO(), text, by: by() });
function cleanLines(lines) {
  return (lines || []).filter((l) => l && String(l.name || '').trim()).map((l) => ({
    id: l.id || 'l' + genCode(6).toLowerCase(), kind: LINE_KINDS[l.kind] ? l.kind : (l.productId ? 'repuesto' : 'mano'), productId: l.productId || null, name: String(l.name).trim(),
    qty: Math.max(0.01, Number(l.qty) || 1), price: round2(Number(l.price) || 0), cost: round4(Number(l.cost) || 0), pack: l.pack || 'caja', factor: Math.max(1, Number(l.factor) || 1),
    mechanicId: l.mechanicId || null, maintId: l.maintId || null, approved: l.approved === false ? false : l.approved === true ? true : null, detail: String(l.detail || '').trim()
  }));
}
/**
 * Recibe un vehículo en el taller y abre su orden de trabajo.
 * data: { vehicleId, type, complaint, km, fuel, checks {item: ok|obs|mal}, belongings [], damages [{zone, kind, note}], photos [], mechanicId, promisedAt, apptId, notes }
 */
export async function openJob(data) {
  const v = store.vehicle(data.vehicleId);
  if (!v) throw new Error('Elige el vehículo.');
  if (store.jobOfVehicle(v.id)) throw new Error(`${v.plate} ya tiene una orden abierta (${store.jobOfVehicle(v.id).number}).`);
  if (!String(data.complaint || '').trim()) throw new Error('Escribe lo que pide o reporta el cliente.');
  const owner = store.client(v.ownerId);
  const b = store.batch();
  const ref = store.newRef('jobs');
  const seq = store.nextSeq(b, 'ot');
  const mech = store.staff(data.mechanicId);
  const date = nowISO();
  const job = {
    number: fmtSeq('OT', seq, 5), seq, open: true, status: 'recibido', type: data.type || 'reparacion',
    vehicleId: v.id, plate: v.plate || '', vehicleName: vehicleName(v), vtype: v.type || 'carro', ownerId: v.ownerId || null, ownerName: owner?.name || v.ownerName || '', phone: owner?.phone || v.ownerPhone || '',
    complaint: String(data.complaint || '').trim(), diagnosis: '', recommendations: '', notes: String(data.notes || '').trim(),
    kmIn: Math.round(Number(data.km) || 0) || null, fuel: data.fuel || '', checks: data.checks || {}, belongings: data.belongings || [], damages: (data.damages || []).slice(0, 20), photos: (data.photos || []).slice(0, 4),
    mechanicId: data.mechanicId || null, mechanicName: mech?.name || '', promisedAt: data.promisedAt || '', apptId: data.apptId || null,
    lines: cleanLines(data.lines), quoteCode: '', quoteStatus: '', charged: false, saleId: null,
    inAt: date, dayKey: todayKey(), log: [logEntry(`Vehículo recibido${data.km ? ` con ${num(data.km, 0)} km` : ''}`)], by: by()
  };
  b.set(ref, job);
  const vp = { lastVisitAt: date, visits: store.inc(1), updatedAt: date, ...kmPatch(v, data.km) };
  b.set(store.vehRef(v.id), vp, { merge: true });
  if (data.apptId) b.set(store.ref('appointments', data.apptId), { status: 'atendida', jobId: ref.id, doneAt: date }, { merge: true });
  store.jobs = [...store.jobs, { id: ref.id, ...job }]; store._jMap = null; // para que la ficha pública ya muestre la orden
  putCard(b, { ...v, ...vp, visits: (v.visits || 0) + 1 });
  await store.commit(b);
  return { id: ref.id, ...job };
}
/** Guarda cambios de la orden (diagnóstico, líneas, mecánico, fecha prometida…) */
export async function saveJob(job, patch) {
  const allowed = ['type', 'complaint', 'diagnosis', 'recommendations', 'notes', 'mechanicId', 'promisedAt', 'fuel', 'checks', 'belongings', 'damages', 'photos', 'kmIn'];
  const p = {};
  for (const k of allowed) if (patch[k] !== undefined) p[k] = typeof patch[k] === 'string' ? patch[k].trim() : patch[k];
  if (patch.lines) p.lines = cleanLines(patch.lines);
  if (p.mechanicId !== undefined) p.mechanicName = store.staff(p.mechanicId)?.name || '';
  p.updatedAt = nowISO();
  await store.save('jobs', job.id, p);
  return { ...job, ...p };
}
export async function setJobStatus(job, status, text = '') {
  const log = [...(job.log || []), logEntry(text || `Estado: ${JOB_STATUS[status]?.label || status}`)].slice(-100);
  const patch = { status, log, updatedAt: nowISO() };
  if (status === 'listo') patch.readyAt = nowISO();
  if (status === 'reparacion' && !job.startedAt) patch.startedAt = nowISO();
  const b = store.batch();
  b.set(store.ref('jobs', job.id), patch, { merge: true });
  const v = store.vehicle(job.vehicleId);
  store._jMap = null; store.jobs = store.jobs.map((j) => (j.id === job.id ? { ...j, ...patch } : j));
  if (v) putCard(b, v);
  await store.commit(b);
}
export async function addJobNote(job, text) {
  if (!String(text || '').trim()) return;
  const log = [...(job.log || []), logEntry(String(text).trim())].slice(-100);
  await store.save('jobs', job.id, { log, updatedAt: nowISO() });
}
/** Datos del presupuesto público (sin datos personales salvo el primer nombre) */
function quoteDoc(job, code) {
  const v = store.vehicle(job.vehicleId) || {};
  const lines = (job.lines || []).map((l, i) => ({ i, kind: l.kind, name: l.name, qty: l.qty, price: l.price, total: round2(l.price * l.qty), detail: l.detail || '' }));
  const t = jobTotals(job);
  const s = store.settings;
  return {
    tenantId: store.tenantId, code, jobId: job.id, number: job.number, shop: store.businessName, shopPhone: s.whatsapp || s.phone || '', shopAddress: s.address || '', country: s.country || '',
    sym: loc().sym, fx: s.fx?.enabled && Number(s.fx.rate) > 0 ? { sym: s.fx.sym, rate: Number(s.fx.rate) } : null,
    owner: String(job.ownerName || '').split(/\s+/)[0], plate: job.plate, vehicle: job.vehicleName || vehicleName(v), km: job.kmIn || null,
    complaint: job.complaint || '', diagnosis: job.diagnosis || '', recommendations: job.recommendations || '', lines, labor: t.labor, parts: t.parts, total: t.total,
    note: s.quoteNote || '', warrantyDays: Number(s.warrantyDays) || 0, promisedAt: job.promisedAt || '', iva: Number(s.iva) || 0,
    decision: '', approved: [], decisionNote: '', signName: '', decidedAt: '', synced: false, sentAt: nowISO(), demo: store.isDemo
  };
}
/** Envía el presupuesto: queda publicado en /presupuesto/CÓDIGO para que el cliente lo apruebe desde su teléfono */
export async function sendQuote(job) {
  const cur = store.job(job.id) || job;
  if (!(cur.lines || []).length) throw new Error('Agrega al menos una línea (mano de obra o repuesto) al presupuesto.');
  const code = cur.quoteCode || genCode(8);
  const b = store.batch();
  b.set(store.quoteRef(code), quoteDoc(cur, code));
  const log = [...(cur.log || []), logEntry(`Presupuesto enviado por ${usd(jobTotals(cur).total)}`)].slice(-100);
  const patch = { status: 'presupuesto', quoteCode: code, quoteStatus: 'pendiente', quoteSentAt: nowISO(), quoteTotal: jobTotals(cur).total, log, updatedAt: nowISO() };
  b.set(store.ref('jobs', cur.id), patch, { merge: true });
  store._jMap = null; store.jobs = store.jobs.map((j) => (j.id === cur.id ? { ...j, ...patch } : j));
  const v = store.vehicle(cur.vehicleId); if (v) putCard(b, v);
  await store.commit(b);
  return { ...cur, ...patch };
}
export const quoteUrl = (code) => `${APP_URL}/presupuesto/${code}`;
/** Aplica la decisión del cliente (desde su teléfono o de palabra en el taller) a la orden */
export async function applyDecision(job, { decision, approved = null, note = '', via = 'cliente' }) {
  const cur = store.job(job.id) || job;
  const set = approved ? new Set(approved.map(Number)) : null;
  const lines = (cur.lines || []).map((l, i) => ({ ...l, approved: decision === 'rechazado' ? false : set ? set.has(i) : true }));
  const ok = lines.filter((l) => l.approved !== false);
  const st = decision === 'rechazado' || !ok.length ? 'diagnostico' : 'aprobado';
  const text = decision === 'rechazado' ? `Presupuesto rechazado${via === 'cliente' ? ' por el cliente' : ''}${note ? ': ' + note : ''}` : `Presupuesto aprobado${via === 'cliente' ? ' por el cliente desde su teléfono' : ''}${set && ok.length < lines.length ? ` (${ok.length} de ${lines.length} trabajos)` : ''}${note ? ': ' + note : ''}`;
  const patch = { lines, status: st, quoteStatus: decision, approvedAt: nowISO(), log: [...(cur.log || []), logEntry(text)].slice(-100), updatedAt: nowISO() };
  const b = store.batch();
  b.set(store.ref('jobs', cur.id), patch, { merge: true });
  if (cur.quoteCode) b.set(store.quoteRef(cur.quoteCode), { synced: true, ...(via !== 'cliente' ? { decision, approved: lines.map((l, i) => (l.approved !== false ? i : null)).filter((x) => x != null), decidedAt: nowISO(), decisionNote: note || 'Aprobado en el taller' } : {}) }, { merge: true });
  store._jMap = null; store.jobs = store.jobs.map((j) => (j.id === cur.id ? { ...j, ...patch } : j));
  const v = store.vehicle(cur.vehicleId); if (v) putCard(b, v);
  await store.commit(b);
  return { ...cur, ...patch };
}
/** Revisa los presupuestos que el cliente ya respondió y los pasa a su orden (se llama al llegar cambios) */
let syncing = false;
export async function syncQuotes() {
  if (syncing) return [];
  syncing = true;
  const done = [];
  try {
    for (const q of store.quotes) {
      if (q.synced || !['aprobado', 'rechazado'].includes(q.decision)) continue;
      const job = store.job(q.jobId);
      if (!job || job.quoteCode !== q.id || job.status !== 'presupuesto') continue;
      await applyDecision(job, { decision: q.decision, approved: q.approved || null, note: [q.decisionNote, q.signName ? `firmó ${q.signName}` : ''].filter(Boolean).join(' · '), via: 'cliente' });
      done.push({ job, quote: q });
    }
  } finally { syncing = false; }
  return done;
}
/** Líneas de la orden para el punto de venta (solo lo aprobado) */
export function jobLines(job) {
  return (job.lines || []).filter((l) => l.approved !== false).map((l) => {
    const p = l.productId ? store.product(l.productId) : null;
    return {
      productId: p ? p.id : null, name: l.name, pack: l.pack || 'caja', factor: p ? Math.max(1, Number(l.factor) || 1) : 1, qty: l.qty, price: l.price, listPrice: l.price,
      cost: p ? (Number(l.cost) || Number(p.cost) || 0) : (Number(l.cost) || 0), kind: l.kind === 'mano' ? 'servicio' : p ? 'producto' : 'servicio',
      detail: l.kind === 'mano' ? (store.staff(l.mechanicId || job.mechanicId)?.name || '') : l.kind === 'externo' ? 'Repuesto externo' : l.detail || ''
    };
  });
}
/**
 * Entrega del vehículo: cierra la orden, registra los servicios del plan hechos, la garantía y el historial del vehículo.
 * opts: { km (salida), nextControl, text, warrantyDays, warrantyKm }
 */
export async function deliverJob(job, { km = 0, nextControl = '', text = '', warrantyDays = null, warrantyKm = null } = {}) {
  const cur = store.job(job.id) || job;
  const v = store.vehicle(cur.vehicleId) || (await store.getVehicle(cur.vehicleId)) || {};
  const date = nowISO();
  const b = store.batch();
  const kmOut = Math.round(Number(km) || 0) || Number(cur.kmIn) || Number(v.km) || 0;
  const wd = warrantyDays == null ? Number(store.settings.warrantyDays) || 0 : Number(warrantyDays) || 0;
  const wk = warrantyKm == null ? Number(store.settings.warrantyKm) || 0 : Number(warrantyKm) || 0;
  const done = (cur.lines || []).filter((l) => l.approved !== false);
  const t = jobTotals(cur, true);
  const patch = {
    open: false, status: 'entregado', outAt: date, kmOut: kmOut || null, total: t.total, labor: t.labor, parts: t.parts,
    warrantyUntil: wd ? nextFrom(todayKey(), wd) : '', warrantyKmUntil: wk && kmOut ? kmOut + wk : null,
    log: [...(cur.log || []), logEntry(text || 'Entregado al cliente')].slice(-100), updatedAt: date
  };
  b.set(store.ref('jobs', cur.id), patch, { merge: true });
  // Servicios del plan de mantenimiento incluidos en la orden
  let services = [...(v.services || [])];
  const seen = new Set();
  for (const l of done) {
    const plan = store.maintPlan.find((m) => (l.maintId && m.id === l.maintId) || normalize(l.name).includes(normalize(m.name).split(' (')[0]));
    if (!plan || seen.has(plan.id)) continue;
    seen.add(plan.id);
    services.push(serviceItem({ maintId: plan.id, name: plan.name, km: kmOut, date: todayKey(), jobId: cur.id, jobNumber: cur.number }, v));
  }
  services = services.slice(-200);
  const hist = { number: cur.number, date: todayKey(), km: kmOut || null, type: JOB_TYPES[cur.type]?.label || 'Servicio', work: done.filter((l) => l.kind !== 'repuesto' || true).map((l) => l.name).slice(0, 8).join(', '), total: t.total };
  const vp = { services, history: [...(v.history || []), hist].slice(-40), updatedAt: date, ...kmPatch(v, kmOut), ...(nextControl ? { nextControl } : {}),
    ...(wd ? { warrantyUntil: patch.warrantyUntil, warrantyKm: patch.warrantyKmUntil, warrantyJob: cur.number } : {}) };
  if (v.id) b.set(store.vehRef(v.id), vp, { merge: true });
  store._jMap = null; store.jobs = store.jobs.filter((j) => j.id !== cur.id);
  if (v.id) putCard(b, { ...v, ...vp });
  await store.commit(b);
  return { ...cur, ...patch };
}
export async function cancelJob(job, reason = '') {
  const b = store.batch();
  b.set(store.ref('jobs', job.id), { open: false, status: 'cancelado', outAt: nowISO(), cancelReason: reason, log: [...(job.log || []), logEntry(`Orden cancelada${reason ? ': ' + reason : ''}`)].slice(-100) }, { merge: true });
  store._jMap = null; store.jobs = store.jobs.filter((j) => j.id !== job.id);
  const v = store.vehicle(job.vehicleId); if (v) putCard(b, v);
  await store.commit(b);
}
/** Comisión de cada mecánico sobre la mano de obra de las órdenes entregadas */
export function laborByMechanic(jobs) {
  const m = new Map();
  for (const j of jobs) {
    if (j.status !== 'entregado') continue;
    for (const l of j.lines || []) {
      if (l.kind !== 'mano' || l.approved === false) continue;
      const id = l.mechanicId || j.mechanicId || '';
      const st = store.staff(id);
      const row = m.get(id) || { id, name: st?.name || j.mechanicName || 'Sin asignar', pct: Number(st?.commission) || 0, labor: 0, jobs: new Set() };
      row.labor = round2(row.labor + l.price * l.qty); row.jobs.add(j.id);
      m.set(id, row);
    }
  }
  return [...m.values()].map((r) => ({ ...r, jobs: r.jobs.size, commission: round2(r.labor * r.pct / 100) })).sort((a, b) => b.labor - a.labor);
}

// ======================================================================
// AGENDA
// ======================================================================
export async function saveAppt(data, id = null) {
  const v = data.vehicleId ? store.vehicle(data.vehicleId) : null;
  const owner = v ? store.client(v.ownerId) : (data.ownerId ? store.client(data.ownerId) : null);
  if (!data.date || !data.time) throw new Error('Elige el día y la hora.');
  if (!v && !String(data.plate || '').trim()) throw new Error('Elige el vehículo.');
  const st = store.staff(data.staffId);
  const d = {
    date: data.date, time: data.time, minutes: Math.max(5, Number(data.minutes) || 60), service: data.service || 'mantenimiento', staffId: data.staffId || null, staffName: st?.name || '',
    vehicleId: v?.id || null, plate: v?.plate || String(data.plate || '').trim().toUpperCase(), vehicleName: v ? vehicleName(v) : String(data.vehicleName || '').trim(),
    ownerId: owner?.id || null, ownerName: owner?.name || String(data.ownerName || '').trim(), phone: owner?.phone || String(data.phone || '').trim(),
    note: String(data.note || '').trim(), updatedAt: nowISO()
  };
  const clash = store.appointments.find((a) => a.id !== id && a.date === d.date && a.staffId && a.staffId === d.staffId && !['cancelada', 'no_vino'].includes(a.status) && overlap(a, d));
  if (clash && !data.force) { const e = new Error(`${st?.name || 'Esa persona'} ya tiene una cita a las ${clash.time} (${clash.plate}).`); e.clash = true; throw e; }
  if (id) { await store.save('appointments', id, d); return { id, ...(store.appointments.find((a) => a.id === id) || {}), ...d }; }
  const ref = store.newRef('appointments');
  const full = { ...d, status: data.status || 'confirmada', createdAt: nowISO(), by: by() };
  await store.save('appointments', ref.id, full, false);
  return { id: ref.id, ...full };
}
const mins = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
function overlap(a, b) { const a0 = mins(a.time), a1 = a0 + (Number(a.minutes) || 60), b0 = mins(b.time), b1 = b0 + (Number(b.minutes) || 60); return a0 < b1 && b0 < a1; }
export async function setApptStatus(a, status) {
  const patch = { status, updatedAt: nowISO() };
  if (status === 'llego') patch.arrivedAt = nowISO();
  await store.save('appointments', a.id, patch);
}
export async function deleteAppt(a) { await store.remove('appointments', a.id); }

// ======================================================================
// AUTOLAVADO
// ======================================================================
/** Entra un vehículo a la cola del lavado. Puede ser un vehículo registrado o solo la placa (cliente de paso). */
export async function openWash({ vehicleId = null, plate = '', desc = '', ownerName = '', phone = '', types = [], price = 0, staffId = null, note = '', apptId = null }) {
  const v = vehicleId ? store.vehicle(vehicleId) : store.byPlate(plate);
  const p = v?.plate || String(plate || '').trim().toUpperCase();
  if (!p) throw new Error('Escribe la placa o elige el vehículo.');
  if (!types.length) throw new Error('Marca al menos un tipo de lavado.');
  if (store.washes.some((w) => plateKey(w.plate) === plateKey(p))) throw new Error(`${p} ya está en el autolavado.`);
  const owner = v ? store.client(v.ownerId) : null;
  const st = store.staff(staffId);
  const minutes = types.reduce((a, t) => a + (Number(store.washTypes.find((w) => w.name === t)?.minutes) || 20), 0);
  const b = store.batch();
  const ref = store.newRef('washes');
  const seq = store.nextSeq(b, 'wash');
  const d = {
    number: fmtSeq('L', seq, 5), seq, open: true, status: 'espera', vehicleId: v?.id || null, plate: p, vehicleName: v ? vehicleName(v) : String(desc || '').trim(), vtype: v?.type || 'carro',
    ownerId: owner?.id || null, ownerName: owner?.name || String(ownerName || '').trim(), phone: owner?.phone || String(phone || '').trim(),
    types, minutes, price: round2(Number(price) || 0), staffId, staffName: st?.name || '', note: String(note || '').trim(), apptId, charged: false,
    inAt: nowISO(), dayKey: todayKey(), log: [logEntry('En cola')], by: by()
  };
  b.set(ref, d);
  if (apptId) b.set(store.ref('appointments', apptId), { status: 'atendida', washId: ref.id, doneAt: nowISO() }, { merge: true });
  await store.commit(b);
  return { id: ref.id, ...d };
}
export async function setWashStatus(w, status) {
  const patch = { status, log: [...(w.log || []), logEntry(WASH_STATUS[status]?.label || status)].slice(-30), updatedAt: nowISO() };
  if (status === 'lavando') patch.startAt = nowISO();
  if (status === 'listo') patch.readyAt = nowISO();
  await store.save('washes', w.id, patch);
}
export async function closeWash(w, { saleId = null } = {}) {
  await store.save('washes', w.id, { open: false, status: 'entregado', outAt: nowISO(), log: [...(w.log || []), logEntry('Entregado')].slice(-30), ...(saleId ? { saleId } : {}) });
}
/** Minutos que faltan para que le toque a un vehículo de la cola (según las bahías de lavado) */
export function washEta(w) {
  const bays = Math.max(1, Number(store.settings.washBays) || 1);
  const q = store.washQueue.filter((x) => ['espera', 'lavando', 'secado'].includes(x.status));
  const i = q.findIndex((x) => x.id === w.id);
  if (i < 0 || w.status !== 'espera') return 0;
  const ahead = q.slice(0, i).reduce((a, x) => a + Math.max(5, (Number(x.minutes) || 20) - (x.startAt ? Math.round((Date.now() - new Date(x.startAt)) / 60000) : 0)), 0);
  return Math.round(ahead / bays);
}

// ======================================================================
// VENTA
// ======================================================================
export function cartTotals(lines, discount = 0) {
  const subtotal = round2((lines || []).reduce((a, l) => a + (Number(l.price) || 0) * (Number(l.qty) || 0), 0));
  const disc = round2(Math.min(subtotal, Math.max(0, Number(discount) || 0)));
  return { subtotal, discount: disc, total: round2(subtotal - disc) };
}
/** Descuento y cobertura de un convenio sobre el carrito */
export function agreementCalc(ag, lines) {
  if (!ag) return { discount: 0, covered: 0 };
  const base = round2((lines || []).filter((l) => ag.scope !== 'medicamentos' || l.kind !== 'servicio').reduce((a, l) => a + l.price * l.qty, 0));
  const discount = round2(base * (Number(ag.discount) || 0) / 100);
  const covered = round2((base - discount) * (Number(ag.coverage) || 0) / 100);
  return { discount, covered, base };
}
export const pointsValue = (pts) => round2(Math.max(0, Number(pts) || 0) * (Number(store.loyalty?.pointValue) || 0));

/** Unidades del carrito por producto */
export function unitsByProduct(lines) {
  const m = new Map();
  for (const l of lines || []) if (l.productId) m.set(l.productId, (m.get(l.productId) || 0) + (Number(l.qty) || 0) * (Number(l.factor) || 1));
  return m;
}
export function checkStock(lines) {
  for (const [id, units] of unitsByProduct(lines)) {
    const p = store.product(id);
    if (p && p.trackStock !== false && (Number(p.stock) || 0) < units - 1e-9) throw new Error(`No hay suficiente ${p.name}: quedan ${stockText(p)}.`);
  }
}
/** Los productos del carrito que exigen récipe */
export const rxLines = (lines) => (lines || []).filter((l) => l.productId && needsRx(store.product(l.productId) || l));

/**
 * Cobra una venta de mostrador.
 * lines: [{ productId, name, pack ('caja'|'blister'|'unidad'), factor (unidades por presentación), qty, price (por presentación), cost (por presentación), kind }]
 * rx: datos de la receta { doctor, license, patient, patientId, number, date, retained, note } (si hay medicamentos con receta)
 * agreementId: convenio/seguro → descuento y parte que cubre el convenio (queda por cobrar al convenio)
 * credit: parte que queda a deber el paciente · pointsUsed: puntos canjeados
 */
export async function chargeSale({ lines, client = null, vehicle = null, discount = 0, payments = [], note = '', credit = 0, rx = null, agreementId = null, pointsUsed = 0, sellerId = null, orderId = null, delivery = 0, jobId = null, washId = null }) {
  const clean = (lines || []).filter((l) => l && l.name && Number(l.qty) > 0).map((l) => ({
    productId: l.productId || null, name: String(l.name), pack: l.pack || 'caja', factor: Math.max(1, Number(l.factor) || 1), qty: round4(Number(l.qty)),
    price: round2(Number(l.price) || 0), listPrice: round2(Number(l.listPrice ?? l.price) || 0), cost: round4(Number(l.cost) || 0), kind: l.kind || (l.productId ? 'producto' : 'servicio'),
    rx: l.productId ? (store.product(l.productId)?.rx || 'libre') : 'libre', detail: l.detail || ''
  }));
  if (Number(delivery) > 0) clean.push({ productId: null, name: 'Delivery', pack: 'servicio', factor: 1, qty: 1, price: round2(delivery), listPrice: round2(delivery), cost: 0, kind: 'servicio', rx: 'libre', detail: '' });
  if (!clean.length) throw new Error('No hay nada para cobrar.');
  checkStock(clean);
  const needRx = clean.filter((l) => l.productId && RX_NEEDS(l.rx));
  if (needRx.length && store.settings.requireRxData === true && !(rx && String(rx.doctor || '').trim())) throw new Error('Registra los datos del récipe para vender estos productos.');

  const b = store.batch();
  const cl = resolveClient(b, client);
  const ag = agreementId ? store.agreement(agreementId) : null;
  const t = cartTotals(clean, 0);
  const agc = agreementCalc(ag, clean);
  const ptsUsed = Math.max(0, Math.floor(Number(pointsUsed) || 0));
  if (ptsUsed && !(cl && Number(cl.points) >= ptsUsed)) throw new Error('El cliente no tiene esos puntos.');
  const ptsDisc = pointsValue(ptsUsed);
  const disc = round2(Math.min(t.subtotal, (Number(discount) || 0) + agc.discount + ptsDisc));
  const total = round2(t.subtotal - disc);
  const covered = round2(Math.min(total, agc.covered));
  const owe = round2(Math.min(total - covered, Math.max(0, Number(credit) || 0)));
  if (owe > 0 && !cl) throw new Error('Para dejar saldo pendiente elige o registra al cliente.');
  const toPay = round2(total - covered - owe);
  const pay = toPay > 0.004 ? preparePayment({ amount: toPay, payments }) : NO_PAY();

  // Inventario: salida por lotes (FEFO)
  const date = nowISO();
  const low = [];
  const usedBy = {};
  for (const [id, units] of unitsByProduct(clean)) {
    const p = store.product(id);
    if (!p || p.trackStock === false) continue;
    const r = consumeLots(p.lots || [], units);
    usedBy[id] = r.used;
    const left = (Number(p.stock) || 0) - units;
    b.update(store.ref('products', id), { stock: store.inc(-units), sold: store.inc(units), lots: r.lots, expiresAt: nextExpiry({ lots: r.lots }) || '', updatedAt: date });
    if (left <= (Number(p.minStock) || 0)) low.push({ ...p, stock: left });
  }
  const items = clean.map((l) => {
    const it = { ...l, total: round2(l.price * l.qty) };
    if (l.productId && usedBy[l.productId]?.length) it.lots = usedBy[l.productId].map((u) => `${u.lot || 's/l'}${u.exp ? ' ' + u.exp.slice(5, 7) + '/' + u.exp.slice(2, 4) : ''}`).join(', ');
    return it;
  });
  const extra = {
    note, credit: owe, agreementId: ag?.id || null, agreementName: ag?.name || '', agreementDue: covered, agreementPaid: covered > 0 ? false : null,
    agreementDiscount: agc.discount, pointsUsed: ptsUsed, pointsDiscount: ptsDisc, manualDiscount: round2(Number(discount) || 0),
    sellerId: sellerId || null, sellerName: store.seller(sellerId)?.name || '', orderId: orderId || null, usedLots: usedBy,
    vehicleId: vehicle?.id || null, plate: vehicle?.plate || '', vehicleName: vehicle ? vehicleName(vehicle) : '', km: vehicle?.km || null, jobId: jobId || null, jobNumber: jobId ? (store.job(jobId)?.number || '') : '', washId: washId || null
  };
  const sale = newSaleDoc(b, { kind: 'venta', items, subtotal: t.subtotal, discount: disc, pay, client: cl, extra });

  for (const [id, used] of Object.entries(usedBy)) {
    const p = store.product(id);
    const units = used.reduce((a, u) => a + u.qty, 0) + 0;
    const total = unitsByProduct(clean).get(id) || units;
    b.set(store.newRef('inventory_logs'), { productId: id, name: p.name, date, dayKey: todayKey(), type: 'venta', qty: -total, cost: unitCost(p), lots: used, reason: `Venta ${sale.number}`, by: by() });
  }

  // Receta: libro de recetas y de controlados
  if (needRx.length) {
    const seq = store.nextSeq(b, 'rx');
    const ref = store.newRef('prescriptions');
    const controlled = needRx.some((l) => l.rx === 'controlado');
    b.set(ref, {
      number: fmtSeq('RX', seq, 5), seq, date, dayKey: todayKey(), saleId: sale.id, saleNumber: sale.number,
      doctor: String(rx?.doctor || '').trim(), license: String(rx?.license || '').trim(), rxNumber: String(rx?.number || '').trim(), rxDate: rx?.date || todayKey(),
      patient: String(rx?.patient || vehicle?.plate || cl?.name || '').trim(), patientId: String(rx?.patientId || cl?.idDoc || '').trim(), clientId: cl?.id || null, vehicleId: vehicle?.id || null, ownerName: cl?.name || '',
      retained: !!rx?.retained || needRx.some((l) => rxOf({ rx: l.rx }).retain), controlled, note: String(rx?.note || '').trim(),
      items: needRx.map((l) => ({ productId: l.productId, name: l.name, rx: l.rx, qty: l.qty, pack: l.pack, units: l.qty * l.factor, lots: (usedBy[l.productId] || []).map((u) => u.lot).filter(Boolean).join(', '), active: store.product(l.productId)?.active || '' })),
      status: 'dispensada', by: by()
    });
    sale.rxId = ref.id;
    b.update(store.ref('sales', sale.id), { rxId: ref.id });
  }

  // Cliente: gasto, saldo y puntos
  let after = cl ? { ...cl } : null;
  if (cl) {
    const L = store.loyalty;
    const earned = L?.enabled && Number(L.per) > 0 ? Math.floor((toPay + owe) / Number(L.per)) : 0;
    const points = Math.max(0, (Number(cl.points) || 0) - ptsUsed + earned);
    const tr = (cl.treatments || []).map((x) => {
      const units = x.productId ? unitsByProduct(clean).get(x.productId) : 0;
      if (!units) return x;
      const days = x.dailyUnits > 0 ? Math.max(1, Math.floor(units / x.dailyUnits)) : (Number(x.everyDays) || 30);
      const base = x.nextAt && x.nextAt > todayKey() ? x.nextAt : todayKey();
      return { ...x, lastAt: todayKey(), nextAt: dayKey(addDays(new Date(base + 'T12:00:00'), days)), notifiedAt: null };
    });
    const patch = { totalSpent: store.inc(toPay), visits: store.inc(1), lastVisitAt: date, points, treatments: tr, updatedAt: date };
    if (owe > 0) { patch.balance = store.inc(owe); after.balance = (Number(cl.balance) || 0) + owe; }
    Object.assign(after, { points, treatments: tr, visits: (Number(cl.visits) || 0) + 1, lastVisitAt: date });
    b.set(store.ref('clients', cl.id), patch, { merge: true });
    sale.pointsEarned = earned;
    b.update(store.ref('sales', sale.id), { pointsEarned: earned });
  }
  if (orderId) b.update(store.orderRef(orderId), { status: 'entregada', saleId: sale.id, saleNumber: sale.number, deliveredAt: date });
  if (jobId) b.set(store.ref('jobs', jobId), { charged: true, saleId: sale.id, saleNumber: sale.number, paidTotal: total }, { merge: true });
  if (washId) b.set(store.ref('washes', washId), { charged: true, saleId: sale.id, saleNumber: sale.number }, { merge: true });
  if (vehicle?.id) b.set(store.vehRef(vehicle.id), { lastSaleAt: date }, { merge: true });
  await store.commit(b);
  return { sale, low, client: after };
}
const RX_NEEDS = (rx) => !!rxOf({ rx }).needs;

/** Cobra la deuda del cliente */
export async function payBalance(c, { amount, payments, note = '' }) {
  const bal = round2(Number(c.balance) || 0);
  const amt = round2(Math.min(bal, Number(amount) || 0));
  if (!(amt > 0)) throw new Error('Indica el monto a abonar.');
  const b = store.batch();
  const p = preparePayment({ amount: amt, payments });
  const sale = newSaleDoc(b, { kind: 'abono', items: [{ productId: null, name: 'Abono a saldo pendiente', pack: 'servicio', factor: 1, qty: 1, price: amt, cost: 0, kind: 'abono', total: amt }], subtotal: amt, pay: p, client: c, extra: { note } });
  b.set(store.ref('clients', c.id), { balance: store.inc(-amt), totalSpent: store.inc(amt), updatedAt: nowISO() }, { merge: true });
  await store.commit(b);
  return { sale };
}
export async function adjustPoints(c, points, reason = '') {
  const b = store.batch();
  const v = Math.max(0, Math.round(Number(points) || 0));
  b.set(store.ref('clients', c.id), { points: v, pointsLog: [...(c.pointsLog || []), { at: nowISO(), by: by(), from: c.points || 0, to: v, reason }].slice(-20), updatedAt: nowISO() }, { merge: true });
  await store.commit(b);
}

/** Anula un recibo: devuelve el inventario a sus lotes, revierte caja, saldo, puntos, receta y convenio. */
export async function voidSale(sale, reason = '') {
  if (sale.status === 'voided') throw new Error('El documento ya está anulado.');
  const b = store.batch();
  const date = nowISO();
  b.update(store.ref('sales', sale.id), { status: 'voided', voidedAt: date, voidReason: reason || '', voidedBy: by() });
  if (sale.kind === 'venta') {
    const units = unitsByProduct(sale.items);
    for (const [id, u] of units) {
      const p = store.product(id);
      if (!p || p.trackStock === false) continue;
      const used = sale.usedLots?.[id] || [{ lot: '', exp: '', qty: u }];
      const lots = restoreLots(p.lots || [], used);
      b.update(store.ref('products', id), { stock: store.inc(u), sold: store.inc(-u), lots, expiresAt: nextExpiry({ lots }) || '', updatedAt: date });
      b.set(store.newRef('inventory_logs'), { productId: id, name: p.name, date, dayKey: todayKey(), type: 'devolucion', qty: u, cost: unitCost(p), lots: used, reason: `Anulación ${sale.number}`, by: by() });
    }
  }
  const c = sale.memberId ? store.client(sale.memberId) : null;
  if (c) {
    const patch = { totalSpent: store.inc(-(sale.received || 0)), updatedAt: date };
    const after = { ...c };
    if (sale.kind === 'abono') { patch.balance = store.inc(sale.total || 0); patch.totalSpent = store.inc(-(sale.total || 0)); }
    if (sale.credit > 0) patch.balance = store.inc(-sale.credit);
    if (sale.kind === 'venta') {
      patch.visits = store.inc(-1);
      const pts = Math.max(0, (Number(c.points) || 0) + (Number(sale.pointsUsed) || 0) - (Number(sale.pointsEarned) || 0));
      patch.points = pts; after.points = pts;
    }
    b.set(store.ref('clients', c.id), patch, { merge: true });
  }
  if (sale.jobId) b.set(store.ref('jobs', sale.jobId), { charged: false, saleId: null }, { merge: true });
  if (sale.washId) b.set(store.ref('washes', sale.washId), { charged: false, saleId: null }, { merge: true });
  if (sale.rxId) b.set(store.ref('prescriptions', sale.rxId), { status: 'anulada', voidedAt: date, voidReason: reason }, { merge: true });
  const shift = store.openShift;
  const f = sale.cashFlow || FLOW0();
  const reverse = { inUSD: f.outUSD || 0, inBs: f.outBs || 0, outUSD: f.inUSD || 0, outBs: f.inBs || 0 };
  let cashReverted = false;
  if (shift && (sale.received || 0) > 0) {
    const extra = {};
    if (sale.shiftId === shift.id) { extra.salesCount = -1; extra.salesTotal = -(sale.received || 0); for (const [k, v] of Object.entries(methodNet(sale))) extra[`byMethod.${k}`] = -v; }
    b.update(store.ref('cash_shifts', shift.id), shiftIncrements(reverse, extra));
    if (reverse.inUSD || reverse.outUSD) b.set(store.newRef('cash_movements'), { shiftId: shift.id, date, dayKey: todayKey(), type: 'void', direction: 'out', currency: 'USD', amount: 0, flow: reverse, concept: `Anulación ${sale.number}`, category: 'Anulaciones', refId: sale.id, by: by() });
    cashReverted = true;
  }
  await store.commit(b);
  return { cashReverted };
}

/** Marca como cobradas al convenio una o varias ventas */
export async function settleAgreement(sales, { method = 'transferencia', note = '' } = {}) {
  const b = store.batch();
  const date = nowISO();
  for (const s of sales) b.update(store.ref('sales', s.id), { agreementPaid: true, agreementPaidAt: date, agreementPayMethod: method, agreementPayNote: note });
  await store.commit(b);
}

// ======================================================================
// INVENTARIO
// ======================================================================
const PRODUCT_FIELDS = ['name', 'active', 'strength', 'form', 'lab', 'barcode', 'sku', 'category', 'rx', 'location', 'unitsPerBox', 'blister', 'fraction', 'price', 'blisterPrice', 'unitPrice', 'cost', 'minStock', 'maxStock', 'trackStock', 'sellable', 'online', 'supplierId', 'notes', 'taxed', 'color', 'unitName', 'boxName', 'fits', 'maintId'];
export function cleanProduct(d) {
  const out = {};
  for (const k of PRODUCT_FIELDS) if (d[k] !== undefined) out[k] = d[k];
  for (const k of ['name', 'active', 'strength', 'form', 'lab', 'barcode', 'sku', 'category', 'location', 'notes', 'unitName', 'boxName', 'fits', 'maintId']) if (out[k] != null) out[k] = String(out[k]).trim();
  for (const k of ['unitsPerBox', 'blister']) if (out[k] != null) out[k] = Math.max(k === 'blister' ? 0 : 1, Math.round(Number(out[k]) || 0));
  for (const k of ['price', 'blisterPrice', 'unitPrice', 'cost']) if (out[k] != null) out[k] = round2(Number(out[k]) || 0);
  for (const k of ['minStock', 'maxStock']) if (out[k] != null) out[k] = Math.max(0, Math.round(Number(out[k]) || 0));
  if (out.rx) out.rx = 'libre';
  return out;
}
/** Crea o edita un producto. Al crear: stock inicial (unidades) con su lote y vencimiento. */
export async function saveProduct(data, id = null, initial = null) {
  const clean = cleanProduct(data);
  if (!clean.name) throw new Error('Escribe el nombre del producto.');
  if (clean.barcode) { const dup = store.byBarcode(clean.barcode); if (dup && dup.id !== id) throw new Error(`Ese código de barras ya es de ${dup.name}.`); }
  const b = store.batch();
  const ref = id ? store.ref('products', id) : store.newRef('products');
  const date = nowISO();
  if (!id) {
    const units = Math.max(0, Math.round(Number(initial?.units) || 0));
    const lots = units ? addLot([], { lot: initial?.lot || '', exp: initial?.exp || '', qty: units, cost: clean.cost || 0 }) : [];
    b.set(ref, { rx: 'libre', unitsPerBox: 1, blister: 0, fraction: true, trackStock: true, sellable: true, online: true, ...clean, stock: units, lots, expiresAt: nextExpiry({ lots }), sold: 0, createdAt: date, updatedAt: date, by: by() });
    if (units) b.set(store.newRef('inventory_logs'), { productId: ref.id, name: clean.name, date, dayKey: todayKey(), type: 'entrada', qty: units, cost: (clean.cost || 0) / (clean.unitsPerBox || 1), lots: [{ lot: initial?.lot || '', exp: initial?.exp || '', qty: units }], reason: 'Existencia inicial', by: by() });
  } else b.set(ref, { ...clean, updatedAt: date }, { merge: true });
  await store.commit(b);
  return { id: ref.id, ...(store.product(ref.id) || {}), ...clean };
}

/**
 * Movimiento manual de inventario (en UNIDADES).
 * mode: 'entrada' (ajuste positivo con lote) | 'merma' | 'vencido' (retira un lote) | 'devolucion_prov' | 'conteo' (fija la existencia) | 'uso'
 */
export async function moveProduct(p, { mode, units, lot = '', exp = '', reason = '', unitCostV = null }) {
  const cur = store.product(p.id) || p;
  const current = Number(cur.stock) || 0;
  const q = Math.max(0, Math.round(Number(units) || 0));
  let lots = cur.lots || [];
  let delta = 0; let used = [];
  if (mode === 'entrada') { delta = q; lots = addLot(lots, { lot, exp, qty: q, cost: unitCostV ?? unitCost(cur) * upb(cur) }); used = [{ lot, exp, qty: q }]; }
  else if (mode === 'conteo') {
    delta = q - current;
    if (delta > 0) { lots = addLot(lots, { lot, exp, qty: delta }); used = [{ lot, exp, qty: delta }]; }
    else if (delta < 0) { const r = consumeLots(lots, -delta); lots = r.lots; used = r.used; }
  } else {
    if (q > current) throw new Error(`Solo hay ${stockText(cur)}.`);
    delta = -q;
    if (lot || exp) {
      const list = lots.map((l) => ({ ...l }));
      const hit = list.find((l) => (l.lot || '') === lot && (l.exp || '') === exp);
      if (!hit || hit.qty < q) throw new Error('Ese lote no tiene esa cantidad.');
      hit.qty -= q; lots = list.filter((l) => l.qty > 0); used = [{ lot, exp, qty: q }];
    } else { const r = consumeLots(lots, q); lots = r.lots; used = r.used; }
  }
  const date = nowISO();
  const b = store.batch();
  b.update(store.ref('products', p.id), { stock: store.inc(delta), lots, expiresAt: nextExpiry({ lots }) || '', updatedAt: date });
  b.set(store.newRef('inventory_logs'), { productId: p.id, name: cur.name, date, dayKey: todayKey(), type: mode, qty: delta, cost: unitCost(cur), lots: used, reason, by: by() });
  await store.commit(b);
  return delta;
}

// ======================================================================
// PROVEEDORES Y COMPRAS
// ======================================================================
export async function saveSupplier(data, id = null) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Escribe el nombre del proveedor.');
  const clean = { name, rif: String(data.rif || '').trim(), contact: String(data.contact || '').trim(), phone: String(data.phone || '').trim(), email: String(data.email || '').trim(), days: Math.max(0, Math.round(Number(data.days) || 0)), notes: String(data.notes || '').trim(), active: data.active !== false, updatedAt: nowISO() };
  const ref = id ? store.ref('suppliers', id) : store.newRef('suppliers');
  await store.save('suppliers', ref.id, id ? clean : { ...clean, createdAt: nowISO() }, !!id);
  return { id: ref.id, ...clean };
}
/** Sugerido de compra: lo que está en o bajo el mínimo, hasta llegar al máximo (o 2× el mínimo). En cajas. */
export function suggestedOrder(supplierId = null) {
  return store.lowProducts.filter((p) => p.sellable !== false || p.trackStock !== false).filter((p) => !supplierId || p.supplierId === supplierId).map((p) => {
    const k = upb(p); const st = Math.max(0, Number(p.stock) || 0);
    const target = Number(p.maxStock) > 0 ? Number(p.maxStock) : Math.max(Number(p.minStock) * 2, k);
    const boxes = Math.max(1, Math.ceil((target - st) / k));
    return { p, boxes, cost: Number(p.lastCost || p.cost) || 0 };
  });
}
/** Orden de compra (pedido al proveedor, aún no recibida) */
export async function createPurchaseOrder({ supplierId, items, note = '' }) {
  const sup = store.supplier(supplierId);
  const list = (items || []).filter((i) => i.productId && Number(i.boxes) > 0).map((i) => ({ productId: i.productId, name: i.name || store.product(i.productId)?.name || '', boxes: Math.round(Number(i.boxes)), cost: round2(Number(i.cost) || 0) }));
  if (!list.length) throw new Error('Agrega al menos un producto.');
  const b = store.batch();
  const seq = store.nextSeq(b, 'po');
  const ref = store.newRef('purchases');
  const total = round2(list.reduce((a, i) => a + i.boxes * i.cost, 0));
  const doc0 = { number: fmtSeq('OC', seq, 5), seq, status: 'pedido', supplierId: supplierId || null, supplierName: sup?.name || 'Sin proveedor', items: list, total, paid: 0, balance: 0, note, date: nowISO(), dayKey: todayKey(), by: by() };
  b.set(ref, doc0);
  await store.commit(b);
  return { id: ref.id, ...doc0 };
}
/**
 * Recepción de mercancía (con o sin orden previa): entra al inventario por lote y vencimiento.
 * items: [{ productId, boxes, cost (por caja), lot, exp, price? (nuevo precio de venta por caja) }]
 * paid: lo que se paga ahora · payFromCash: el pago sale de la caja · dueDate: vencimiento de la factura (crédito)
 */
export async function receivePurchase({ order = null, supplierId, invoiceNo = '', items, paid = 0, payFromCash = false, dueDate = '', note = '' }) {
  const sup = store.supplier(supplierId || order?.supplierId);
  const list = (items || []).filter((i) => i.productId && Number(i.boxes) > 0);
  if (!list.length) throw new Error('Indica las cantidades recibidas.');
  for (const i of list) if (store.product(i.productId)?.rx === 'controlado' && !i.lot) throw new Error(`Indica el lote de ${store.product(i.productId).name} (controlado).`);
  const total = round2(list.reduce((a, i) => a + Math.round(Number(i.boxes)) * (Number(i.cost) || 0), 0));
  const pay = round2(Math.min(total, Math.max(0, Number(paid) || 0)));
  const b = store.batch();
  const date = nowISO();
  const ref = order ? store.ref('purchases', order.id) : store.newRef('purchases');
  const seq = order?.seq || store.nextSeq(b, 'po');
  const lines = [];
  for (const i of list) {
    const p = store.product(i.productId);
    if (!p) continue;
    const k = upb(p); const boxes = Math.round(Number(i.boxes)); const units = boxes * k; const cost = round2(Number(i.cost) || 0);
    const stockNow = Math.max(0, Number(p.stock) || 0);
    const avg = cost > 0 ? round2(((stockNow / k) * (Number(p.cost) || 0) + boxes * cost) / (stockNow / k + boxes)) : Number(p.cost) || 0;
    const lots = addLot(p.lots || [], { lot: String(i.lot || '').trim(), exp: i.exp || '', qty: units, cost });
    const patch = { stock: store.inc(units), lots, expiresAt: nextExpiry({ lots }) || '', cost: avg, lastCost: cost, lastPurchaseAt: date, updatedAt: date };
    if (sup) patch.supplierId = sup.id;
    if (Number(i.price) > 0) patch.price = round2(i.price);
    b.update(store.ref('products', p.id), patch);
    b.set(store.newRef('inventory_logs'), { productId: p.id, name: p.name, date, dayKey: todayKey(), type: 'compra', qty: units, cost: cost / k, lots: [{ lot: String(i.lot || '').trim(), exp: i.exp || '', qty: units }], reason: `Compra ${fmtSeq('OC', seq, 5)}${invoiceNo ? ' · Fact. ' + invoiceNo : ''}${sup ? ' · ' + sup.name : ''}`, by: by() });
    lines.push({ productId: p.id, name: p.name, boxes, units, cost, lot: String(i.lot || '').trim(), exp: i.exp || '' });
  }
  const payments = [];
  if (pay > 0) {
    if (payFromCash) {
      const shift = store.openShift;
      if (!shift) throw new Error('Abre la caja para pagar con dinero de la caja.');
      const flow = FLOW0(); flow.outUSD = pay;
      b.set(store.newRef('cash_movements'), { shiftId: shift.id, date, dayKey: todayKey(), type: 'expense', direction: 'out', currency: 'USD', amount: pay, rate: 1, flow, concept: `Pago compra ${fmtSeq('OC', seq, 5)} · ${sup?.name || ''}`, category: 'Compra de mercancía', refId: ref.id, by: by() });
      b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, { expensesUSD: pay }));
    }
    payments.push({ date, amount: pay, fromCash: !!payFromCash, by: by() });
  }
  const data = {
    number: fmtSeq('OC', seq, 5), seq, status: 'recibida', supplierId: sup?.id || null, supplierName: sup?.name || 'Sin proveedor', invoiceNo: String(invoiceNo || '').trim(),
    items: lines, total, paid: pay, balance: round2(total - pay), payments, dueDate: total - pay > 0.004 ? (dueDate || dayKey(addDays(new Date(), Number(sup?.days) || 30))) : '',
    receivedAt: date, date: order?.date || date, dayKey: order?.dayKey || todayKey(), note: note || order?.note || '', by: by()
  };
  b.set(ref, data, { merge: true });
  await store.commit(b);
  return { id: ref.id, ...data };
}
/** Abono a una factura de proveedor (cuentas por pagar) */
export async function payPurchase(pu, { amount, fromCash = false, note = '' }) {
  const amt = round2(Math.min(Number(pu.balance) || 0, Number(amount) || 0));
  if (!(amt > 0)) throw new Error('Indica el monto.');
  const b = store.batch();
  const date = nowISO();
  if (fromCash) {
    const shift = store.openShift;
    if (!shift) throw new Error('Abre la caja para pagar con dinero de la caja.');
    const flow = FLOW0(); flow.outUSD = amt;
    b.set(store.newRef('cash_movements'), { shiftId: shift.id, date, dayKey: todayKey(), type: 'expense', direction: 'out', currency: 'USD', amount: amt, rate: 1, flow, concept: `Abono ${pu.number} · ${pu.supplierName}`, category: 'Pago a proveedores', refId: pu.id, by: by() });
    b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, { expensesUSD: amt }));
  }
  b.update(store.ref('purchases', pu.id), { paid: store.inc(amt), balance: round2((Number(pu.balance) || 0) - amt), payments: [...(pu.payments || []), { date, amount: amt, fromCash, note, by: by() }], updatedAt: date });
  await store.commit(b);
}
export async function cancelPurchaseOrder(pu) {
  if (pu.status !== 'pedido') throw new Error('Solo se anulan órdenes que aún no se reciben.');
  await store.save('purchases', pu.id, { status: 'anulada', cancelledAt: nowISO() });
}

// ======================================================================
// PEDIDOS EN LÍNEA (catálogo público shops/{slug} + orders/{id})
// ======================================================================
export function shopDoc() {
  const s = store.settings; const S = s.shop; const L = loc();
  const items = store.sellable.filter((p) => p.online !== false && p.trackStock !== false && !(S.hideControlled !== false && p.rx === 'controlado')).slice(0, 1500).map((p) => ({
    id: p.id, n: p.name, a: p.active || '', s: p.strength || '', f: p.form || '', u: upb(p), c: p.category || '', p: round2(Number(p.price) || 0),
    fits: (p.fits || '').slice(0, 80), ok: p.trackStock === false || (Number(p.stock) || 0) >= upb(p) ? 1 : (Number(p.stock) || 0) > 0 ? 2 : 0
  }));
  return {
    tenantId: store.tenantId, enabled: S.enabled !== false, shop: store.businessName, phone: s.whatsapp || s.phone || '', address: s.address || '', instagram: s.instagram || '',
    schedule: s.schedule || '', country: s.country || '', sym: L.sym, dec: L.dec, dial: L.dial || '', fx: s.fx?.enabled && Number(s.fx.rate) > 0 ? { sym: s.fx.sym, rate: Number(s.fx.rate) } : null,
    delivery: S.delivery !== false, deliveryFee: Number(S.deliveryFee) || 0, note: S.note || '', showStock: S.showStock !== false,
    items, demo: store.isDemo, updatedAt: nowISO()
  };
}
let lastPublished = '';
export async function publishShop({ force = false } = {}) {
  const S = store.settings.shop;
  if (!S?.slug || !store.tenantId) return false;
  const d = shopDoc();
  const key = JSON.stringify({ ...d, updatedAt: '' });
  if (!force && key === lastPublished) return false;
  lastPublished = key;
  const b = store.batch();
  b.set(store.shopRef(S.slug), d);
  await store.commit(b);
  return true;
}
export function resetPublished() { lastPublished = ''; }
export async function setOrderStatus(o, status, extra = {}) {
  const b = store.batch();
  b.update(store.orderRef(o.id), { status, [`${status}At`]: nowISO(), ...extra });
  await store.commit(b);
}
export async function deleteOrder(o) { const b = store.batch(); b.delete(store.orderRef(o.id)); await store.commit(b); }
/** Convierte un pedido en líneas del punto de venta */
export function orderLines(o) {
  return (o.items || []).map((i) => {
    const p = store.product(i.id);
    if (!p) return null;
    return { productId: p.id, name: p.name, pack: 'caja', factor: upb(p), qty: Math.max(1, Math.round(Number(i.q) || 1)), price: round2(Number(p.price) || 0), listPrice: round2(Number(p.price) || 0), cost: Number(p.cost) || 0, kind: 'producto', detail: productLine(p) };
  }).filter(Boolean);
}

// ======================================================================
// CAJA
// ======================================================================
export async function cashMovement({ direction, currency, amount, concept, category, note = '' }) {
  const shift = store.openShift;
  if (!shift) throw new Error('No hay caja abierta.');
  const b = store.batch();
  const flow = FLOW0();
  flow[direction === 'in' ? 'inUSD' : 'outUSD'] = round2(amount);
  const date = nowISO();
  b.set(store.newRef('cash_movements'), { shiftId: shift.id, date, dayKey: todayKey(), type: direction === 'in' ? 'income' : 'expense', direction, currency, amount: round2(amount), rate: 1, flow, concept, category, note, by: by() });
  b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, direction === 'out' ? { expensesUSD: amount } : { incomeUSD: amount }));
  await store.commit(b);
}
export async function openShift({ openingUSD, openingBs = 0, note = '' }) {
  if (store.openShift) throw new Error('Ya hay una caja abierta.');
  const ref = store.newRef('cash_shifts');
  const b = store.batch();
  const seq = store.nextSeq(b, 'shift');
  b.set(ref, { status: 'open', openedAt: nowISO(), openedBy: by(), dayKey: todayKey(), number: fmtSeq('T', seq, 4), openingUSD: round2(openingUSD), openingBs: round2(openingBs), rateAtOpen: 1, inUSD: 0, inBs: 0, outUSD: 0, outBs: 0, salesCount: 0, salesTotal: 0, note });
  await store.commit(b);
  return ref.id;
}
export function shiftExpected(shift) {
  return { usd: round2((shift.openingUSD || 0) + (shift.inUSD || 0) - (shift.outUSD || 0)), bs: round2((shift.openingBs || 0) + (shift.inBs || 0) - (shift.outBs || 0)) };
}
export async function closeShift(shift, { countedUSD, countedBs = 0, note = '' }) {
  const exp = shiftExpected(shift);
  const b = store.batch();
  b.update(store.ref('cash_shifts', shift.id), { status: 'closed', closedAt: nowISO(), closedBy: by(), rateAtClose: 1, expectedUSD: exp.usd, expectedBs: exp.bs, countedUSD: round2(countedUSD), countedBs: round2(countedBs), diffUSD: round2(countedUSD - exp.usd), diffBs: round2(countedBs - exp.bs), closeNote: note });
  await store.commit(b);
}

export { addDays, dayKey, fmtDate, normalize };
