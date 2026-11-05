// SanoTaller — Capa de datos (Firestore en tiempo real + caché offline): clientes, vehículos, órdenes de trabajo, agenda, autolavado, inventario y caja
import {
  db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, query, where, writeBatch, increment
} from './firebase.js';
import { addDays, startOfDay, sha256, toast, todayKey, dayKey, applyLocale, setFx, fromKey } from './utils.js';
import { CATEGORIES, LOYALTY_DEFAULT, lotsOf, nextExpiry, limitDay, dueItems, MAINT_DEFAULT, WASH_TYPES_DEFAULT, OPEN_APPT, OPEN_JOB, plateKey } from './taller.js';

export const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const SEX = { M: 'Masculino', F: 'Femenino' };
export const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);

// ---------- Pedidos en línea ----------
export const ORDER_STATUS = {
  nueva: { label: 'Nuevo', tone: 'info', icon: 'bell' },
  preparando: { label: 'Preparando', tone: 'warning', icon: 'box' },
  lista: { label: 'Listo para entregar', tone: 'violet', icon: 'bag' },
  entregada: { label: 'Entregado', tone: 'success', icon: 'check' },
  cancelada: { label: 'Cancelado', tone: 'neutral', icon: 'x' }
};
export const OPEN_ORDER = ['nueva', 'preparando', 'lista'];
export const orderBadge = (s) => { const st = ORDER_STATUS[s] || { label: s, tone: 'neutral' }; return `<span class="badge badge-${st.tone}"><i class="dotc"></i>${st.label}</span>`; };

// ---------- Estado del cliente ----------
export const CLIENT_STATUS = {
  nuevo: { label: 'Nuevo', tone: 'info' },
  activo: { label: 'Al día', tone: 'success' },
  recompra: { label: 'Mantenimiento por tocar', tone: 'warning' },
  atrasado: { label: 'Mantenimiento vencido', tone: 'danger' },
  inactivo: { label: 'Inactivo', tone: 'neutral' },
  baja: { label: 'De baja', tone: 'neutral' }
};
export const clientBadge = (s) => { const st = CLIENT_STATUS[s] || { label: s, tone: 'neutral' }; return `<span class="badge badge-${st.tone}"><i class="dotc"></i>${st.label}</span>`; };

const DEFAULT_SETTINGS = {
  businessName: '', rif: '', phone: '', whatsapp: '', email: '', address: '', instagram: '',
  chiefName: '',
  receiptFooter: '¡Gracias por confiarnos tu vehículo! 🔧',
  receiptFormat: '80mm', docTitle: 'RECIBO', invoicePrefix: 'F',
  country: '', currency: '', iva: 0,
  fx: { enabled: false, sym: 'Bs', name: 'Bolívares', rate: 0, updatedAt: '' },
  categories: CATEGORIES,
  fractionMarkup: 0,
  expiryAlertDays: 90,
  maintPlan: MAINT_DEFAULT,
  washTypes: WASH_TYPES_DEFAULT,
  washBays: 2,
  reminderDays: 7,
  reminderKm: 500,
  kmPerDay: 35,
  laborRate: 0,
  warrantyDays: 30,
  warrantyKm: 1000,
  quoteNote: 'Presupuesto válido por 7 días. Los repuestos pueden variar según disponibilidad.',
  agenda: { start: '07:30', end: '17:30', slot: 30, days: [1, 2, 3, 4, 5, 6] },
  agreements: [],
  sellers: [],
  loyalty: LOYALTY_DEFAULT,
  shop: { enabled: true, slug: '', delivery: true, deliveryFee: 0, note: '', showStock: true, hideControlled: false },
  schedule: '',
  refillNoticeDays: 3,
  requireRxData: false
};

class Store {
  constructor() {
    this.tenantId = null; this.tenant = null;
    this.settings = { ...DEFAULT_SETTINGS }; this.security = {}; this.counters = {}; this.announcement = null;
    this.clients = []; this.products = []; this.orders = []; this.suppliers = []; this.payables = [];
    this.vehicles = []; this.appointments = []; this.jobs = []; this.washes = []; this.quotes = [];
    this.openShift = null; this.recentSales = [];
    this.ready = false; this._unsubs = []; this._listeners = {}; this._loaded = new Set();
  }

  on(evt, fn) { (this._listeners[evt] ||= new Set()).add(fn); return () => this._listeners[evt].delete(fn); }
  emit(evt, data) {
    (this._listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
    (this._listeners['*'] || []).forEach((fn) => { try { fn(evt); } catch (e) { console.error(e); } });
  }

  col(name) { return collection(db, 'tenants', this.tenantId, name); }
  ref(name, id) { return doc(db, 'tenants', this.tenantId, name, String(id)); }
  newRef(name) { return doc(this.col(name)); }
  tenantRef(id = this.tenantId) { return doc(db, 'tenants', id); }
  cardRef(code) { return doc(db, 'cards', String(code)); }
  quoteRef(code) { return doc(db, 'quotes', String(code)); }
  vehRef(id) { return this.ref('vehicles', id); }
  shopRef(slug) { return doc(db, 'shops', String(slug)); }
  orderRef(id) { return doc(db, 'orders', String(id)); }
  batch() { return writeBatch(db); }
  get isDemo() { return this.tenant?.demo === true; }
  inc(n) { return increment(n); }

  /** La caché local aplica el cambio al instante (también sin internet); se espera al servidor como máximo unos segundos. */
  async commit(batch) {
    const p = batch.commit();
    p.catch((err) => {
      console.error('[store] commit', err);
      toast(err?.code === 'permission-denied' ? 'Sin permiso para guardar. Verifica que la sede esté activa.' : 'No se pudo sincronizar un cambio: ' + (err?.message || err), 'danger', 5000);
    });
    if (!navigator.onLine) return;
    await Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 3500))]);
  }
  async save(name, id, data, merge = true) { const b = this.batch(); b.set(this.ref(name, id), data, { merge }); await this.commit(b); }
  async remove(name, id) { const b = this.batch(); b.delete(this.ref(name, id)); await this.commit(b); }

  async start(tenantId) {
    this.stop();
    this.tenantId = tenantId;
    this._loaded = new Set();
    const need = ['tenant', 'settings', 'clients', 'vehicles', 'products', 'shift', 'sales', 'appointments', 'jobs', 'washes'];
    let resolveReady;
    const readyP = new Promise((r) => { resolveReady = r; });
    const mark = (k) => { this._loaded.add(k); if (need.every((x) => this._loaded.has(x))) resolveReady(); };
    const fail = (k) => (err) => { console.error('[store]', k, err); mark(k); if (err?.code === 'permission-denied') this.emit('denied', err); };
    const listen = (q, k, fn) => this._unsubs.push(onSnapshot(q, (s) => { fn(s); mark(k); this.emit(k); this.emit('change', k); }, fail(k)));
    const rows = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'es', { numeric: true });

    listen(this.tenantRef(), 'tenant', (s) => { this.tenant = s.exists() ? { id: s.id, ...s.data() } : null; });
    listen(this.ref('config', 'settings'), 'settings', (s) => {
      this.settings = { ...DEFAULT_SETTINGS, ...(s.exists() ? s.data() : {}) };
      applyLocale(this.settings.country || 'VE', this.settings.currency);
      if (!Array.isArray(this.settings.categories) || !this.settings.categories.length) this.settings.categories = CATEGORIES;
      for (const k of ['agreements', 'sellers']) if (!Array.isArray(this.settings[k])) this.settings[k] = [];
      if (!Array.isArray(this.settings.maintPlan) || !this.settings.maintPlan.length) this.settings.maintPlan = MAINT_DEFAULT;
      if (!Array.isArray(this.settings.washTypes) || !this.settings.washTypes.length) this.settings.washTypes = WASH_TYPES_DEFAULT;
      for (const k of ['loyalty', 'shop', 'fx', 'agenda']) this.settings[k] = { ...DEFAULT_SETTINGS[k], ...(this.settings[k] || {}) };
      setFx(this.settings.fx);
    });
    this._unsubs.push(onSnapshot(this.ref('config', 'security'), (s) => { this.security = s.exists() ? s.data() : {}; }, () => {}));
    this._unsubs.push(onSnapshot(this.ref('config', 'counters'), (s) => { this.counters = s.exists() ? s.data() : {}; }, () => {}));
    this._unsubs.push(onSnapshot(doc(db, 'system', 'announcement'), (s) => { this.announcement = s.exists() ? s.data() : null; this.emit('announcement'); }, () => {}));
    listen(this.col('clients'), 'clients', (s) => { this.clients = rows(s).sort(byName); this._cMap = null; });
    listen(this.col('vehicles'), 'vehicles', (s) => { this.vehicles = rows(s).sort((a, b) => (a.plate || '').localeCompare(b.plate || '')); this._vMap = null; this._vBy = null; });
    listen(this.col('products'), 'products', (s) => { this.products = rows(s).sort(byName); this._pMap = null; this._bMap = null; });
    // Agenda: de 7 días atrás en adelante
    listen(query(this.col('appointments'), where('date', '>=', dayKey(addDays(new Date(), -7)))), 'appointments', (s) => {
      this.appointments = rows(s).sort((a, b) => `${a.date} ${a.time || ''}`.localeCompare(`${b.date} ${b.time || ''}`));
    });
    // Vehículos dentro del taller (órdenes abiertas) y en el autolavado
    listen(query(this.col('jobs'), where('open', '==', true)), 'jobs', (s) => {
      this.jobs = rows(s).sort((a, b) => (a.inAt || '').localeCompare(b.inAt || '')); this._jMap = null;
    });
    listen(query(this.col('washes'), where('open', '==', true)), 'washes', (s) => {
      this.washes = rows(s).sort((a, b) => (a.inAt || '').localeCompare(b.inAt || ''));
    });
    listen(query(this.col('cash_shifts'), where('status', '==', 'open')), 'shift', (s) => {
      this.openShift = rows(s).sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''))[0] || null;
    });
    const since = startOfDay(addDays(new Date(), -7)).toISOString();
    listen(query(this.col('sales'), where('date', '>=', since)), 'sales', (s) => {
      this.recentSales = rows(s).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    });
    this._unsubs.push(onSnapshot(this.col('suppliers'), (s) => { this.suppliers = rows(s).sort(byName); this.emit('suppliers'); }, () => {}));
    this._unsubs.push(onSnapshot(query(this.col('purchases'), where('balance', '>', 0)), (s) => {
      this.payables = rows(s).filter((p) => p.status !== 'anulada').sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9'));
      this.emit('payables');
    }, () => {}));
    // Presupuestos públicos: el cliente los aprueba desde su teléfono
    this._unsubs.push(onSnapshot(query(collection(db, 'quotes'), where('tenantId', '==', tenantId)), (s) => {
      this.quotes = rows(s);
      this.emit('quotes');
    }, (e) => console.warn('[store] quotes', e?.code || e)));
    // Pedidos en línea (colección pública, filtrada por taller)
    this._unsubs.push(onSnapshot(query(collection(db, 'orders'), where('tenantId', '==', tenantId)), (s) => {
      this.orders = rows(s).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      this.emit('orders');
    }, (e) => console.warn('[store] orders', e?.code || e)));

    await Promise.race([readyP, new Promise((r) => setTimeout(r, 8000))]);
    this.ready = true;
  }

  stop() {
    this._unsubs.forEach((u) => { try { u(); } catch (_) {} });
    this._unsubs = []; this.ready = false;
    this.tenant = null; this.clients = []; this.products = []; this.orders = []; this.suppliers = []; this.payables = [];
    this.vehicles = []; this.appointments = []; this.jobs = []; this.washes = []; this.quotes = [];
    this.openShift = null; this.recentSales = [];
    this.settings = { ...DEFAULT_SETTINGS }; this.security = {}; this.counters = {};
    this._pMap = null; this._cMap = null; this._bMap = null; this._vMap = null; this._vBy = null; this._jMap = null;
  }

  // ---------- Ajustes ----------
  get country() { return this.settings.country || ''; }
  get businessName() { return this.settings.businessName || this.tenant?.name || 'Mi taller'; }
  get loyalty() { return this.settings.loyalty; }
  agreement(id) { return this.settings.agreements.find((a) => a.id === id) || null; }
  get activeAgreements() { return this.settings.agreements.filter((a) => a.active !== false); }
  seller(id) { return this.settings.sellers.find((s) => s.id === id) || null; }
  get activeSellers() { return this.settings.sellers.filter((s) => s.active !== false); }
  /** Equipo del taller (mecánicos, lavadores, asesores): se guarda en settings.sellers con su rol y comisión */
  staff(id) { return this.seller(id); }
  staffBy(role) { return this.activeSellers.filter((s) => !role || (s.role || 'mecanico') === role); }
  get mechanics() { const v = this.staffBy('mecanico'); return v.length ? v : this.activeSellers; }
  get washers() { const g = this.staffBy('lavador'); return g.length ? g : this.activeSellers; }
  get maintPlan() { return (this.settings.maintPlan || MAINT_DEFAULT).filter((m) => m.active !== false); }
  get washTypes() { return (this.settings.washTypes || WASH_TYPES_DEFAULT).filter((w) => w.active !== false); }
  get dueOpts() { return { kmDay: Number(this.settings.kmPerDay) || 35, kmWarn: Number(this.settings.reminderKm) || 500, dayWarn: Number(this.settings.reminderDays) || 7 }; }
  supplier(id) { return this.suppliers.find((s) => s.id === id) || null; }

  async saveSettings(patch) {
    Object.assign(this.settings, patch);
    if (patch.fx) setFx(this.settings.fx);
    await this.save('config', 'settings', patch, true);
    this.emit('settings');
  }
  async setCountry(code, currency = null) {
    const l = applyLocale(code, currency);
    await this.saveSettings({ country: code, currency: l.cur, countrySetAt: new Date().toISOString() });
    this.emit('rate', 1);
  }
  /** Correlativo (clientes "cli", vehículos "veh", órdenes "ot", facturas "inv", compras "po", turnos de caja "shift"…) */
  nextSeq(b, key) {
    const n = (Number(this.counters[key]) || 0) + 1;
    this.counters = { ...this.counters, [key]: n };
    b.set(this.ref('config', 'counters'), { [key]: n }, { merge: true });
    return n;
  }

  // ---------- PIN de administrador ----------
  hasPin() { return !!this.security.pinHash; }
  async verifyPin(pin) {
    if (!this.security.pinHash) { const s = await getDoc(this.ref('config', 'security')).catch(() => null); if (s?.exists()) this.security = s.data(); }
    if (!this.security.pinHash) return true;
    return (await sha256(`${this.tenantId}:${pin}`)) === this.security.pinHash;
  }
  async setPin(pin) {
    const pinHash = await sha256(`${this.tenantId}:${pin}`);
    this.security = { ...this.security, pinHash, updatedAt: new Date().toISOString() };
    await this.save('config', 'security', this.security, true);
  }

  // ---------- Productos ----------
  product(id) { if (!this._pMap) this._pMap = new Map(this.products.map((p) => [p.id, p])); return this._pMap.get(id); }
  /** Busca por código de barras exacto (o SKU) */
  byBarcode(code) {
    const v = String(code || '').trim();
    if (!v) return null;
    if (!this._bMap) { this._bMap = new Map(); for (const p of this.products) { for (const c of [p.barcode, p.sku, ...(p.altCodes || [])]) if (c) this._bMap.set(String(c).trim().toLowerCase(), p); } }
    return this._bMap.get(v.toLowerCase()) || null;
  }
  get sellable() { return this.products.filter((p) => p.active !== false && p.sellable !== false); }
  get lowProducts() { return this.products.filter((p) => p.active !== false && p.trackStock !== false && (Number(p.stock) || 0) <= (Number(p.minStock) || 0)); }
  get outProducts() { return this.products.filter((p) => p.active !== false && p.trackStock !== false && (Number(p.stock) || 0) <= 0); }
  /** Lotes con existencia que vencen dentro de `days` días (incluye vencidos) */
  expiringLots(days = Number(this.settings.expiryAlertDays) || 90) {
    const lim = limitDay(days);
    const out = [];
    for (const p of this.products) {
      if (p.active === false) continue;
      for (const l of lotsOf(p)) if (l.exp && l.exp <= lim) out.push({ p, ...l });
    }
    return out.sort((a, b) => a.exp.localeCompare(b.exp));
  }
  get expiredLots() { const t = todayKey(); return this.expiringLots(0).filter((l) => l.exp < t); }
  get expiringProducts() { const lim = limitDay(Number(this.settings.expiryAlertDays) || 90); return this.products.filter((p) => p.active !== false && nextExpiry(p) && nextExpiry(p) <= lim); }

  // ---------- Vehículos ----------
  vehicle(id) { if (!this._vMap) this._vMap = new Map(this.vehicles.map((p) => [p.id, p])); return this._vMap.get(id); }
  vehiclesOf(ownerId) {
    if (!this._vBy) { this._vBy = new Map(); for (const p of this.vehicles) { if (!this._vBy.has(p.ownerId)) this._vBy.set(p.ownerId, []); this._vBy.get(p.ownerId).push(p); } }
    return (this._vBy.get(ownerId) || []).filter((p) => p.active !== false);
  }
  get liveVehicles() { return this.vehicles.filter((p) => p.active !== false); }
  byPlate(plate, exceptId = null) { const k = plateKey(plate); return k.length >= 4 ? this.vehicles.find((v) => v.id !== exceptId && plateKey(v.plate) === k) || null : null; }
  findVehicle(code) {
    const raw = String(code || '').trim();
    if (!raw) return null;
    const url = /\/vehiculo\/([A-Z0-9]+)/i.exec(raw);
    const v = (url ? url[1] : raw).toUpperCase().replace(/\s+/g, '');
    return this.vehicles.find((p) => (p.cardCode || '') === v) || this.byPlate(v)
      || this.vehicles.find((p) => (p.number || '').toUpperCase() === v) || this.vehicles.find((p) => p.vin && String(p.vin).toUpperCase() === v) || null;
  }
  dueFor(v) { return dueItems(v, this.dueOpts); }
  /** Servicios del plan que tocan pronto o están vencidos (hasta 90 días o 3.000 km de atraso) */
  get dueMaint() {
    const out = [];
    for (const v of this.liveVehicles) {
      for (const it of this.dueFor(v)) if ((it.late || it.soon) && !((it.d ?? 0) < -90 || (it.left ?? 0) < -3000)) out.push({ vehicle: v, owner: this.client(v.ownerId), ...it });
    }
    return out.sort((a, b) => a.urgency - b.urgency);
  }
  /** Revisiones indicadas al entregar una orden (próxima revisión) */
  get dueControls() {
    const t = todayKey(); const lim = dayKey(addDays(new Date(), Number(this.settings.reminderDays) || 7));
    return this.liveVehicles.filter((p) => p.nextControl && p.nextControl <= lim && p.nextControl >= dayKey(addDays(new Date(), -30)))
      .map((p) => ({ vehicle: p, owner: this.client(p.ownerId), d: daysBetween(t, p.nextControl) })).sort((a, b) => a.d - b.d);
  }

  // ---------- Órdenes de trabajo ----------
  job(id) { if (!this._jMap) this._jMap = new Map(this.jobs.map((j) => [j.id, j])); return this._jMap.get(id); }
  jobsBy(status) { const l = Array.isArray(status) ? status : [status]; return this.jobs.filter((j) => l.includes(j.status)); }
  get readyJobs() { return this.jobsBy('listo'); }
  get pendingQuotes() { return this.jobsBy('presupuesto'); }
  get waitingParts() { return this.jobsBy('repuesto'); }
  jobOfVehicle(vid) { return this.jobs.find((j) => j.vehicleId === vid && OPEN_JOB.includes(j.status)) || null; }
  quote(code) { return this.quotes.find((q) => q.id === code) || null; }

  // ---------- Autolavado ----------
  get washQueue() { return this.washes.filter((w) => w.status !== 'entregado'); }

  // ---------- Agenda ----------
  apptsOn(date) { return this.appointments.filter((a) => a.date === date); }
  get todayAppts() { return this.apptsOn(todayKey()).filter((a) => a.status !== 'cancelada'); }
  get waiting() { return this.todayAppts.filter((a) => a.status === 'llego'); }
  get openAppts() { return this.appointments.filter((a) => OPEN_APPT.includes(a.status || 'pendiente') && a.date >= todayKey()); }

  // ---------- Clientes ----------
  client(id) { if (!this._cMap) this._cMap = new Map(this.clients.map((p) => [p.id, p])); return this._cMap.get(id); }
  get liveClients() { return this.clients.filter((c) => c.active !== false); }
  findClient(code) {
    const raw = String(code || '').trim();
    if (!raw) return null;
    const url = /\/vehiculo\/([A-Z0-9]+)/i.exec(raw);
    const v = (url ? url[1] : raw).toUpperCase().replace(/\s+/g, '');
    const digits = v.replace(/\D/g, '');
    const veh = this.findVehicle(v);
    if (veh && this.client(veh.ownerId)) return this.client(veh.ownerId);
    return this.clients.find((m) => (m.number || '').toUpperCase() === v || (/^C-?\d+$/.test(v) && Number(m.seq) === Number(digits)))
      || this.clients.find((m) => m.idDoc && String(m.idDoc).replace(/\D/g, '') === digits && digits.length >= 5)
      || (digits.length >= 7 ? this.clients.find((m) => String(m.phone || '').replace(/\D/g, '').endsWith(digits.slice(-8))) : null)
      || null;
  }
  findByPhone(phone, exceptId = null) {
    const d = String(phone || '').replace(/\D/g, '');
    if (d.length < 7) return null;
    const k = d.slice(-8);
    return this.clients.find((c) => c.id !== exceptId && String(c.phone || '').replace(/\D/g, '').slice(-8) === k) || null;
  }
  /** Compatibilidad: los clientes no tienen tratamientos de recompra (el plan de mantenimiento va en cada vehículo) */
  treatmentsOf() { return []; }
  refillIn(t) { return t?.nextAt ? daysBetween(todayKey(), t.nextAt) : null; }
  clientStatus(c) {
    if (!c) return 'nuevo';
    if (c.active === false) return 'baja';
    const due = this.vehiclesOf(c.id).flatMap((p) => this.dueFor(p));
    if (due.some((d) => d.late)) return 'atrasado';
    if (due.some((d) => d.soon)) return 'recompra';
    if (!c.lastVisitAt) return 'nuevo';
    const since = daysBetween(c.lastVisitAt.slice(0, 10), todayKey());
    return since > 240 ? 'inactivo' : 'activo';
  }
  get dueRefills() { return []; }
  get debtors() { return this.clients.filter((m) => m.active !== false && (Number(m.balance) || 0) > 0.009).sort((a, b) => (b.balance || 0) - (a.balance || 0)); }
  get totalDebt() { return this.debtors.reduce((a, m) => a + (Number(m.balance) || 0), 0); }
  get birthdaysToday() { const md = todayKey().slice(5); return this.clients.filter((m) => m.active !== false && m.birthDate && m.birthDate.slice(5) === md); }
  birthdaysWithin(days = 7) {
    const out = [];
    for (let i = 0; i <= days; i++) {
      const md = dayKey(addDays(new Date(), i)).slice(5);
      this.clients.filter((m) => m.active !== false && m.birthDate && m.birthDate.slice(5) === md).forEach((m) => out.push({ ...m, inDays: i }));
    }
    return out;
  }

  // ---------- Pedidos ----------
  get pendingOrders() { return this.orders.filter((o) => OPEN_ORDER.includes(o.status || 'nueva')); }
  get newOrders() { return this.orders.filter((o) => (o.status || 'nueva') === 'nueva'); }
  get totalPayable() { return this.payables.reduce((a, p) => a + (Number(p.balance) || 0), 0); }

  // ---------- Consultas al servidor ----------
  async listBetween(name, field, fromISO, toISO) {
    const s = await getDocs(query(this.col(name), where(field, '>=', fromISO), where(field, '<=', toISO)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async salesBetween(fromISO, toISO) { return this.listBetween('sales', 'date', fromISO, toISO); }
  async listEq(name, field, value) {
    const s = await getDocs(query(this.col(name), where(field, '==', value)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async listAll(name) { const s = await getDocs(this.col(name)); return s.docs.map((d) => ({ id: d.id, ...d.data() })); }
  async getDocById(name, id) { const s = await getDoc(this.ref(name, id)); return s.exists() ? { id: s.id, ...s.data() } : null; }
  async getClient(id) { return this.client(id) || this.getDocById('clients', id); }
  async clientSales(id) { return (await this.listEq('sales', 'memberId', id)).sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
  async vehicleSales(id) { return (await this.listEq('sales', 'vehicleId', id)).sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
  async vehicleJobs(id) { return (await this.listEq('jobs', 'vehicleId', id)).sort((a, b) => (b.inAt || '').localeCompare(a.inAt || '')); }
  async vehicleAppts(id) { return (await this.listEq('appointments', 'vehicleId', id)).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)); }
  async jobsBetween(fromISO, toISO) { return this.listBetween('jobs', 'inAt', fromISO, toISO); }
  async jobsDeliveredBetween(fromISO, toISO) { return this.listBetween('jobs', 'outAt', fromISO, toISO); }
  async washesBetween(fromISO, toISO) { return this.listBetween('washes', 'inAt', fromISO, toISO); }
  async apptsBetween(fromKey0, toKey0) { return this.listBetween('appointments', 'date', fromKey0, toKey0); }
  async getVehicle(id) { return this.vehicle(id) || this.getDocById('vehicles', id); }
  async getJob(id) { return this.job(id) || this.getDocById('jobs', id); }
  async closedShifts(max = 30) {
    const s = await getDocs(query(this.col('cash_shifts'), where('status', '==', 'closed')));
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || '')).slice(0, max);
  }
  async agreementSales() {
    const s = await getDocs(query(this.col('sales'), where('agreementDue', '>', 0)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.status !== 'voided').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
}

export const store = new Store();

// ---------- Administración de sedes (solo administrador general) ----------
export async function listTenants() {
  const s = await getDocs(collection(db, 'tenants'));
  return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.code || a.name || '').localeCompare(b.code || b.name || '', 'es', { numeric: true }));
}
export async function updateTenant(id, data) { await setDoc(doc(db, 'tenants', id), data, { merge: true }); }
export async function tenantSalesSince(tenantId, fromISO) {
  const s = await getDocs(query(collection(db, 'tenants', tenantId, 'sales'), where('date', '>=', fromISO)));
  return s.docs.map((d) => d.data());
}
export async function getTenant(id) { const s = await getDoc(doc(db, 'tenants', id)); return s.exists() ? { id: s.id, ...s.data() } : null; }
export async function createTenantDoc(id, data) { await setDoc(doc(db, 'tenants', id), data); }
export async function getUsername(username) { const s = await getDoc(doc(db, 'usernames', String(username).toLowerCase())); return s.exists() ? s.data() : null; }
export async function setUsername(username, data) { await setDoc(doc(db, 'usernames', String(username).toLowerCase()), data); }
export async function deleteUsername(username) { await deleteDoc(doc(db, 'usernames', String(username).toLowerCase())); }
export async function setAnnouncement(data) { await setDoc(doc(db, 'system', 'announcement'), data); }
export async function getAnnouncement() { const s = await getDoc(doc(db, 'system', 'announcement')); return s.exists() ? s.data() : null; }
/** Ficha pública del vehículo (/vehiculo/CODIGO) */
export async function getCard(code) { const s = await getDoc(doc(db, 'cards', String(code).toUpperCase())); return s.exists() ? s.data() : null; }
/** Presupuesto público (/presupuesto/CODIGO) */
export async function getQuote(code) { const s = await getDoc(doc(db, 'quotes', String(code).toUpperCase())); return s.exists() ? { id: s.id, ...s.data() } : null; }
/** El cliente aprueba o rechaza el presupuesto (las reglas solo le dejan tocar la decisión, una sola vez) */
export async function decideQuote(code, data) { await setDoc(doc(db, 'quotes', String(code).toUpperCase()), data, { merge: true }); }
/** Catálogo público de pedidos (/pedido/SLUG) */
export async function getShop(slug) { const s = await getDoc(doc(db, 'shops', String(slug).toLowerCase())); return s.exists() ? s.data() : null; }
export { DEFAULT_SETTINGS };
