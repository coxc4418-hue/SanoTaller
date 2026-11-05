// SanoTaller — Modo demo (sesión anónima de 30 minutos) con un taller mecánico y autolavado de ejemplo lleno de vida
import { auth, db, doc, collection, writeBatch, getDoc, getDocs, query, where, Timestamp, signInAnonymously, signOut } from './firebase.js';
import { store, DEFAULT_SETTINGS } from './store.js';
import { fmtSeq, genCode, cardData, clientFields, openShift, chargeSale, cashMovement, receivePurchase, createPurchaseOrder, setOrderStatus, cartTotals, agreementCalc, slugify, sendQuote } from './ops.js';
import { round2, nowISO, todayKey, dayKey, addDays, sha256, scaleUSD, PAY_METHODS } from './utils.js';
import { addLot, nextExpiry, packFactor, packPrice, unitCost, LOYALTY_DEFAULT, MAINT_DEFAULT, WASH_TYPES_DEFAULT, vehicleName, jobTotals, JOB_TYPES } from './taller.js';

/** PIN de administrador de todas las demos (se muestra en pantalla) */
export const DEMO_PIN = '1234';
export const DEMO_MINUTES = 30;
const DATA_COLLECTIONS = ['clients', 'vehicles', 'jobs', 'washes', 'appointments', 'products', 'sales', 'prescriptions', 'purchases', 'suppliers', 'cash_shifts', 'cash_movements', 'inventory_logs', 'config'];
const BIZ = 'Taller y Autolavado El Pistón (demo)';

export async function startDemo() { await signInAnonymously(auth); }

export function demoRemainingMs(tenant) {
  const exp = tenant?.expiresAt;
  if (!exp) return 0;
  const ms = typeof exp.toMillis === 'function' ? exp.toMillis() : new Date(exp).getTime();
  return ms - Date.now();
}

const AGREEMENTS = [
  { id: 'a_flota', name: 'Flota Distribuidora El Valle', discount: 10, coverage: 0, scope: 'todo', contact: 'Jefe de flota: Ramón Ortiz · 0414-5552020', active: true },
  { id: 'a_taxi', name: 'Línea de Taxis Unión', discount: 8, coverage: 0, scope: 'todo', contact: 'Coordinador: Freddy Lugo', active: true },
  { id: 'a_seguro', name: 'Seguro AutoProtege (siniestros)', discount: 0, coverage: 80, scope: 'todo', contact: 'Reclamos: 0212-5551100', active: true }
];
const STAFF = [
  { id: 's1', name: 'Carlos Rodríguez', role: 'mecanico', commission: 30, active: true },
  { id: 's2', name: 'Luis Herrera', role: 'mecanico', commission: 25, active: true },
  { id: 's3', name: 'Javier Mora (electricista)', role: 'mecanico', commission: 25, active: true },
  { id: 's4', name: 'Yohan Pérez', role: 'lavador', commission: 0, active: true },
  { id: 's5', name: 'Kelly Salas', role: 'lavador', commission: 0, active: true },
  { id: 's6', name: 'Daniela Rivas', role: 'caja', commission: 0, active: true }
];
const mechName = (id) => STAFF.find((s) => s.id === id)?.name || '';

export async function createDemoTenant(uid) {
  const expiresAt = Timestamp.fromMillis(Date.now() + DEMO_MINUTES * 60 * 1000);
  const b1 = writeBatch(db);
  b1.set(doc(db, 'tenants', uid), { name: BIZ, code: 'demo', ownerUid: uid, ownerEmail: '', active: true, demo: true, createdAt: nowISO(), expiresAt });
  await b1.commit();
  const ref = (name, id) => doc(db, 'tenants', uid, name, id);
  const b = writeBatch(db);
  b.set(ref('config', 'settings'), {
    ...DEFAULT_SETTINGS, businessName: BIZ, rif: 'J-50000000-0', phone: '0212-5550000', whatsapp: '0414-5550000', email: 'demo@sanotaller.app',
    address: 'Av. Intercomunal, galpón 7, zona industrial', instagram: '@tallerelpiston', schedule: 'Lun a vie 7:30 a 17:30 · Sáb 8:00 a 13:00',
    chiefName: 'Carlos Rodríguez', laborRate: scaleUSD(15), warrantyDays: 30, warrantyKm: 1000, washBays: 2, kmPerDay: 35, reminderKm: 500, reminderDays: 7,
    maintPlan: MAINT_DEFAULT, washTypes: WASH_TYPES_DEFAULT,
    agreements: AGREEMENTS, sellers: STAFF, loyalty: { ...LOYALTY_DEFAULT }, fractionMarkup: 10,
    shop: { ...DEFAULT_SETTINGS.shop, enabled: true, delivery: false, slug: `${slugify('Taller El Piston')}-${uid.slice(0, 4).toLowerCase()}`, note: 'Retira tus repuestos en el taller · Te los instalamos con cita' },
    receiptFooter: '¡Gracias por confiarnos tu vehículo! 🔧 Garantía de 30 días o 1.000 km en mano de obra.'
  });
  b.set(ref('config', 'security'), { pinHash: await sha256(`${uid}:${DEMO_PIN}`), updatedAt: nowISO() });
  await b.commit();
}

async function waitFor(cond, ms = 6000) {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 120));
}
const at = (daysAgo, h, m = 0) => { const d = addDays(new Date(), -daysAgo); d.setHours(h, m, 0, 0); return d; };
const inDays = (n) => dayKey(addDays(new Date(), n));
function rng(seed = 7) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

/** k, nombre, referencia OEM, medida, presentación, marca, categoría, unidades por empaque, precio, costo, empaques, mínimo, ubicación, unidad suelta, nombre del empaque, compatible con, servicio del plan */
const PRODUCTS = [
  ['ac_15w40', 'Aceite 15W-40 mineral 1 L', 'SAE 15W-40 API SL', '1 L', 'Litro', 'Venoco', 'Aceites y lubricantes', 1, 7, 4.2, 48, 16, 'A1', '', '', '', 'm_aceite'],
  ['ac_20w50', 'Aceite 20W-50 mineral 1 L', 'SAE 20W-50 API SL', '1 L', 'Litro', 'PDV', 'Aceites y lubricantes', 1, 6.5, 3.9, 36, 12, 'A1', '', '', '', 'm_aceite'],
  ['ac_5w30', 'Aceite 5W-30 sintético (galón 4 L)', 'SAE 5W-30 API SP', '4 L', 'Galón', 'Mobil', 'Aceites y lubricantes', 4, 42, 28, 6, 3, 'A2', 'litro', 'Galón', '', 'm_aceite'],
  ['ac_diesel', 'Aceite 15W-40 diésel (galón 4 L)', 'SAE 15W-40 CI-4', '4 L', 'Galón', 'Shell Rimula', 'Aceites y lubricantes', 4, 34, 22, 5, 2, 'A2', 'litro', 'Galón', 'Hilux Fortuner Machito diésel', 'm_aceite'],
  ['fa_toyota', 'Filtro de aceite Toyota', '90915-YZZE1', '', 'Unidad', 'Toyota', 'Filtros', 1, 9, 5, 14, 5, 'F1', '', '', 'Toyota Corolla Yaris Terios Camry RAV4', 'm_aceite'],
  ['fa_chevy', 'Filtro de aceite Chevrolet', 'PH4967 / 96879797', '', 'Unidad', 'Wix', 'Filtros', 1, 6.5, 3.5, 12, 5, 'F1', '', '', 'Chevrolet Aveo Optra Spark Cruze', 'm_aceite'],
  ['fa_hilux', 'Filtro de aceite Hilux / Fortuner', '90915-YZZD2', '', 'Unidad', 'Toyota', 'Filtros', 1, 11, 6.5, 2, 4, 'F1', '', '', 'Toyota Hilux Fortuner 4Runner Machito', 'm_aceite'],
  ['fair_toy', 'Filtro de aire Corolla 1.8', '17801-0T020', '', 'Unidad', 'Toyota', 'Filtros', 1, 16, 9, 6, 2, 'F2', '', '', 'Toyota Corolla 2009-2019', 'm_aire'],
  ['fair_chevy', 'Filtro de aire Aveo 1.6', '96553450', '', 'Unidad', 'Wix', 'Filtros', 1, 12, 6.5, 5, 2, 'F2', '', '', 'Chevrolet Aveo 1.6', 'm_aire'],
  ['fgas', 'Filtro de gasolina universal', 'GF-61', '', 'Unidad', 'Wix', 'Filtros', 1, 7, 3.5, 10, 3, 'F2', '', '', '', 'm_gasolina'],
  ['bujias', 'Bujías NGK (juego x4)', 'BKR6E', '14 mm', 'Juego', 'NGK', 'Encendido (bujías y cables)', 4, 24, 14, 8, 2, 'E1', 'bujía', 'Juego', 'Corolla Aveo Optra Accent Rio', 'm_bujias'],
  ['past_hilux', 'Pastillas de freno delanteras Hilux', '04465-0K290', '', 'Juego', 'Akebono', 'Frenos', 1, 38, 23, 4, 2, 'B1', '', '', 'Toyota Hilux Fortuner', 'm_frenos'],
  ['past_aveo', 'Pastillas de freno delanteras Aveo', 'D1035', '', 'Juego', 'Bosch', 'Frenos', 1, 24, 13, 6, 2, 'B1', '', '', 'Chevrolet Aveo Optra', 'm_frenos'],
  ['past_corolla', 'Pastillas de freno delanteras Corolla', '04465-02220', '', 'Juego', 'Bosch', 'Frenos', 1, 29, 16, 1, 2, 'B1', '', '', 'Toyota Corolla Yaris', 'm_frenos'],
  ['dot4', 'Líquido de frenos DOT 4 (500 ml)', 'DOT 4', '500 ml', 'Unidad', 'Bosch', 'Aditivos y líquidos', 1, 8, 4.5, 9, 3, 'B2', '', '', '', 'm_liqfrenos'],
  ['refrig', 'Refrigerante verde (galón)', 'Etilenglicol 50/50', '3,78 L', 'Galón', 'Prestone', 'Refrigeración', 1, 14, 8, 7, 3, 'R1', '', '', '', 'm_refrig'],
  ['kit_correa', 'Kit de correa de tiempo Aveo 1.6', 'K015603XS', '', 'Kit', 'Gates', 'Correas y tensores', 1, 95, 60, 2, 1, 'C1', '', '', 'Chevrolet Aveo Optra 1.6', 'm_correa'],
  ['correa_alt', 'Correa del alternador 6PK', '6PK1220', '', 'Unidad', 'Gates', 'Correas y tensores', 1, 18, 9.5, 5, 2, 'C1', '', '', 'Corolla Yaris', ''],
  ['bateria', 'Batería 22FM-800', '22FM-800', '800 CCA', 'Unidad', 'Duncan', 'Electricidad y baterías', 1, 120, 82, 4, 2, 'Depósito', '', '', 'Carros pequeños y medianos', 'm_bateria'],
  ['bateria_g', 'Batería 34-1100 (camionetas)', '34-1100', '1100 CCA', 'Unidad', 'Duncan', 'Electricidad y baterías', 1, 160, 110, 1, 2, 'Depósito', '', '', 'Hilux Fortuner Machito Grand Cherokee', 'm_bateria'],
  ['amort', 'Amortiguador delantero Corolla', '334509', '', 'Unidad', 'Monroe', 'Suspensión y dirección', 1, 58, 36, 4, 2, 'S1', '', '', 'Toyota Corolla 2009-2013', ''],
  ['meseta', 'Meseta (tijera) inferior Aveo', '96535089', '', 'Unidad', 'Moog', 'Suspensión y dirección', 1, 34, 20, 3, 2, 'S1', '', '', 'Chevrolet Aveo', ''],
  ['h4', 'Bombillo H4 12 V 60/55 W', 'H4', '60/55 W', 'Unidad', 'Philips', 'Iluminación', 1, 6, 2.8, 20, 6, 'I1', '', '', '', ''],
  ['limpia', 'Plumillas limpiaparabrisas 20" (par)', 'Aerotwin 20', '20"', 'Par', 'Bosch', 'Accesorios', 1, 15, 8, 8, 3, 'I2', '', '', '', ''],
  ['inyect', 'Limpia inyectores 300 ml', 'Injector cleaner', '300 ml', 'Unidad', 'STP', 'Aditivos y líquidos', 1, 7.5, 4, 12, 4, 'L1', '', '', '', ''],
  ['caucho', 'Caucho 185/65 R14', '185/65R14', 'R14', 'Unidad', 'Firestone', 'Cauchos', 1, 78, 55, 8, 4, 'Depósito', '', '', 'Aveo Corolla Accent', ''],
  ['shampoo', 'Champú para carro con cera (galón)', 'Wash & Wax', '3,78 L', 'Galón', 'Simoniz', 'Productos de lavado', 1, 16, 9, 6, 2, 'Lavado', '', '', '', ''],
  ['silicon', 'Silicón para tablero 500 ml', 'Armor All', '500 ml', 'Unidad', 'Armor All', 'Productos de lavado', 1, 7, 3.8, 10, 3, 'Lavado', '', '', '', ''],
  ['ambient', 'Ambientador de pino', '', '', 'Unidad', 'Little Trees', 'Accesorios', 1, 2.5, 1, 30, 10, 'Caja', '', '', '', '']
];
/** Servicios: k, nombre, categoría, precio, servicio del plan */
const SERVICES_LIST = [
  ['svc_aceite', 'Cambio de aceite y filtro (mano de obra)', 'Servicios de taller', 8, 'm_aceite'],
  ['svc_alinea', 'Alineación y balanceo', 'Servicios de taller', 25, 'm_alineacion'],
  ['svc_escaneo', 'Escaneo computarizado', 'Servicios de taller', 20, ''],
  ['svc_diag', 'Diagnóstico general', 'Servicios de taller', 15, ''],
  ['svc_frenos', 'Servicio de frenos delanteros (mano de obra)', 'Servicios de taller', 25, 'm_frenos'],
  ['svc_afinac', 'Afinación (bujías, filtros y limpieza de inyectores)', 'Servicios de taller', 45, 'm_bujias'],
  ['svc_correa', 'Cambio de correa de tiempo (mano de obra)', 'Servicios de taller', 90, 'm_correa'],
  ['svc_w_sencillo', 'Lavado sencillo', 'Servicios de lavado', 5, ''],
  ['svc_w_completo', 'Lavado completo', 'Servicios de lavado', 10, ''],
  ['svc_w_motor', 'Lavado de motor', 'Servicios de lavado', 8, ''],
  ['svc_w_aspirado', 'Aspirado', 'Servicios de lavado', 3, ''],
  ['svc_w_pulitura', 'Pulitura y encerado', 'Servicios de lavado', 35, ''],
  ['svc_w_tapiceria', 'Limpieza de tapicería', 'Servicios de lavado', 45, '']
];
const COLORS = ['#2563eb', '#0ea5e9', '#16a34a', '#f59e0b', '#dc2626', '#ca8a04', '#0d9488', '#1d4ed8'];
const SUPPLIERS = [
  ['sup1', 'Repuestos Automotrices del Centro', 'J-30123456-7', 'Ana Morales', '0212-5553300', 15],
  ['sup2', 'Lubricantes y Filtros Nacional', 'J-40987654-3', 'Rubén Sosa', '0241-5554411', 30],
  ['sup3', 'Baterías y Cauchos La Rueda', 'J-29876543-1', 'Lorena Paz', '0212-5559900', 7]
];
/** k, nombre, teléfono, cédula / RIF, convenio, saldo, empresa */
const OWNERS = [
  ['maria', 'María Elena Gómez', '0414-1112233', 'V-6123456', null, 0, ''],
  ['jose', 'José Luis Martínez', '0424-2223344', 'V-7234567', 'a_taxi', 25, ''],
  ['carmen', 'Carmen Rodríguez', '0412-3334455', 'V-4345678', null, 0, ''],
  ['valle', 'Distribuidora El Valle C.A.', '0414-5552020', 'J-31234567-0', 'a_flota', 0, 'Distribuidora El Valle C.A.'],
  ['ana', 'Ana Karina Silva', '0414-5556677', 'V-20567890', null, 0, ''],
  ['pedro', 'Pedro Castillo', '0424-6667788', 'V-5678901', 'a_seguro', 40, ''],
  ['rosa', 'Rosa Elena Díaz', '0412-7778899', 'V-8789012', null, 0, ''],
  ['miguel', 'Miguel Ángel Rojas', '0416-8889900', 'V-24890123', null, 0, ''],
  ['yolanda', 'Yolanda Herrera', '0414-9990011', 'V-10901234', null, 0, ''],
  ['jorge', 'Jorge Medina', '0424-1013141', 'V-17012345', 'a_taxi', 0, ''],
  ['gabriela', 'Gabriela Paredes', '0414-1819202', 'V-26234098', null, 0, ''],
  ['andres', 'Andrés Villalobos', '0424-2021222', 'V-11345109', null, 0, ''],
  ['lucia', 'Lucía Fernández', '0412-2223242', 'V-14456210', null, 0, '']
];
/**
 * k, dueño, placa, tipo, marca, modelo, año, color, combustible, caja, aceite, km hoy, km por día,
 * servicios del plan hechos [[id del plan, hace (días)]], próxima revisión en días (o null)
 */
const VEHICLES = [
  ['corolla', 'maria', 'AB123CD', 'carro', 'Toyota', 'Corolla', '2015', 'Plata', 'gasolina', 'automatico', '5W-30 sintético', 98450, 38, [['m_aceite', 118], ['m_aire', 300], ['m_bujias', 400], ['m_frenos', 210], ['m_alineacion', 118]], null],
  ['yaris', 'maria', 'AC456EF', 'carro', 'Toyota', 'Yaris', '2009', 'Rojo', 'gasolina', 'sincronico', '15W-40 mineral', 154300, 22, [['m_aceite', 75], ['m_bateria', 380]], null],
  ['aveo', 'jose', 'AD789GH', 'carro', 'Chevrolet', 'Aveo', '2011', 'Blanco', 'gasolina', 'sincronico', '15W-40 mineral', 231800, 160, [['m_aceite', 33], ['m_frenos', 120], ['m_correa', 380], ['m_alineacion', 70]], null],
  ['hilux', 'carmen', 'A12BC3D', 'pickup', 'Toyota', 'Hilux', '2018', 'Gris', 'diesel', 'sincronico', '15W-40 diésel', 142000, 70, [['m_aceite', 60], ['m_frenos', 260], ['m_alineacion', 200], ['m_refrig', 500]], null],
  ['valle1', 'valle', 'A45DE6F', 'camion', 'Ford', 'F-350', '2014', 'Blanco', 'diesel', 'sincronico', '15W-40 diésel', 312500, 180, [['m_aceite', 24], ['m_frenos', 90]], 5],
  ['valle2', 'valle', 'A78GH9J', 'van', 'Chevrolet', 'N300', '2019', 'Blanco', 'gasolina', 'sincronico', '15W-40 mineral', 89600, 150, [['m_aceite', 30], ['m_alineacion', 65]], null],
  ['valle3', 'valle', 'A01KL2M', 'pickup', 'Toyota', 'Hilux', '2021', 'Blanco', 'diesel', 'sincronico', '15W-40 diésel', 61200, 140, [['m_aceite', 12], ['m_frenos', 160]], null],
  ['tucson', 'ana', 'AE321IJ', 'camioneta', 'Hyundai', 'Tucson', '2016', 'Negro', 'gasolina', 'automatico', '5W-30 sintético', 87200, 30, [['m_aceite', 150], ['m_aire', 160], ['m_bateria', 330]], null],
  ['machito', 'pedro', 'AF654KL', 'camioneta', 'Toyota', 'Land Cruiser (Machito)', '2008', 'Verde', 'gasolina', 'sincronico', '20W-50 mineral', 276400, 45, [['m_aceite', 95], ['m_bujias', 700], ['m_refrig', 760]], null],
  ['optra', 'rosa', 'AG987MN', 'carro', 'Chevrolet', 'Optra', '2010', 'Azul', 'gasolina', 'sincronico', '15W-40 mineral', 188900, 28, [['m_aceite', 160], ['m_correa', 1300]], 12],
  ['moto', 'miguel', 'AA1B23C', 'moto', 'Bera', 'SBR', '2022', 'Negro', 'gasolina', 'sincronico', '20W-50 mineral', 21300, 60, [['m_aceite', 40]], null],
  ['rio', 'yolanda', 'AH147OP', 'carro', 'Kia', 'Rio', '2014', 'Gris', 'gasolina', 'automatico', '10W-30 semisintético', 129300, 25, [['m_aceite', 200], ['m_bujias', 500]], null],
  ['fortuner', 'jorge', 'AI258QR', 'camioneta', 'Toyota', 'Fortuner', '2017', 'Blanco', 'gasolina', 'automatico', '5W-30 sintético', 164500, 120, [['m_aceite', 38], ['m_frenos', 175], ['m_alineacion', 40]], null],
  ['spark', 'gabriela', 'AJ369ST', 'carro', 'Chevrolet', 'Spark', '2012', 'Amarillo', 'gasolina', 'sincronico', '15W-40 mineral', 143700, 20, [['m_aceite', 110]], null],
  ['cherokee', 'andres', 'AK741UV', 'camioneta', 'Jeep', 'Grand Cherokee', '2013', 'Negro', 'gasolina', 'automatico', '5W-30 sintético', 201000, 40, [['m_aceite', 400], ['m_bateria', 420]], null],
  ['accent', 'lucia', 'AL852WX', 'carro', 'Hyundai', 'Accent', '2013', 'Vinotinto', 'gasolina', 'sincronico', '15W-40 mineral', 167800, 30, [['m_aceite', 90], ['m_frenos', 300]], 20]
];
/** Órdenes ya entregadas: vehículo, hace (días), tipo, mecánico, motivo, diagnóstico, líneas [producto o servicio, cantidad], días que tardó */
const PAST_JOBS = [
  ['corolla', 118, 'mantenimiento', 's1', 'Cambio de aceite', 'Mantenimiento de 90.000 km', [['svc_aceite'], ['ac_5w30', 1], ['fa_toyota'], ['svc_alinea']], 0],
  ['corolla', 210, 'reparacion', 's2', 'Ruido al frenar', 'Pastillas delanteras al límite, discos en buen estado', [['svc_frenos'], ['past_corolla'], ['dot4']], 1],
  ['aveo', 33, 'mantenimiento', 's1', 'Cambio de aceite', 'Mantenimiento de rutina (taxi)', [['svc_aceite'], ['ac_15w40', 4], ['fa_chevy']], 0],
  ['aveo', 120, 'reparacion', 's2', 'Ruido al frenar', 'Pastillas gastadas, rectificación de discos', [['svc_frenos'], ['past_aveo']], 1],
  ['hilux', 60, 'mantenimiento', 's1', 'Cambio de aceite', 'Servicio de 140.000 km', [['svc_aceite'], ['ac_diesel', 2], ['fa_hilux']], 0],
  ['valle1', 24, 'mantenimiento', 's2', 'Cambio de aceite', 'Servicio de flota', [['svc_aceite'], ['ac_diesel', 2], ['fa_hilux']], 0],
  ['valle1', 90, 'reparacion', 's2', 'Frena desviado', 'Bombín delantero derecho con fuga', [['svc_frenos'], ['past_hilux'], ['dot4', 2]], 2],
  ['valle2', 30, 'mantenimiento', 's1', 'Cambio de aceite', 'Servicio de flota', [['svc_aceite'], ['ac_15w40', 4], ['fa_chevy']], 0],
  ['valle3', 12, 'mantenimiento', 's1', 'Cambio de aceite', 'Servicio de flota', [['svc_aceite'], ['ac_diesel', 2], ['fa_hilux']], 0],
  ['tucson', 150, 'mantenimiento', 's1', 'Servicio de 80.000 km', 'Mantenimiento mayor', [['svc_aceite'], ['ac_5w30', 1], ['fgas'], ['svc_escaneo']], 1],
  ['machito', 95, 'mantenimiento', 's2', 'Cambio de aceite', 'Rutina', [['svc_aceite'], ['ac_20w50', 6], ['fa_hilux']], 0],
  ['moto', 40, 'mantenimiento', 's3', 'Cambio de aceite', 'Rutina', [['svc_aceite'], ['ac_20w50', 1]], 0],
  ['fortuner', 38, 'mantenimiento', 's1', 'Cambio de aceite y alineación', 'Rutina', [['svc_aceite'], ['ac_5w30', 2], ['fa_toyota'], ['svc_alinea']], 0],
  ['accent', 90, 'mantenimiento', 's2', 'Cambio de aceite', 'Rutina', [['svc_aceite'], ['ac_15w40', 4], ['fa_chevy']], 0],
  ['spark', 110, 'electricidad', 's3', 'No enciende en las mañanas', 'Batería sulfatada y borne flojo', [['svc_diag'], ['bateria']], 0],
  ['optra', 160, 'mantenimiento', 's1', 'Cambio de aceite', 'Rutina', [['svc_aceite'], ['ac_15w40', 4], ['fa_chevy']], 0],
  ['rio', 45, 'diagnostico', 's3', 'Check engine encendido', 'Sensor de oxígeno con lectura irregular (cliente lo cambia después)', [['svc_escaneo']], 0]
];
const WALKIN = ['Patricia Morales', 'Ricardo Fuentes', 'Elena Suárez', 'Fernando Ruiz', 'Marisol Peña', 'Alexis Romero'];

/** Taller de ejemplo: vehículos con su kilometraje y plan de mantenimiento, órdenes en el tablero, presupuestos, autolavado, citas, repuestos, compras, pedidos en línea y caja del día. */
export async function seedDemoActivity() {
  const money = (v) => scaleUSD(v);
  const R = rng(11);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const methods = Object.keys(PAY_METHODS).filter((k) => k !== 'credito').slice(0, 6);
  const mk = () => Number(store.settings.fractionMarkup) || 0;
  const plan = Object.fromEntries(MAINT_DEFAULT.map((m) => [m.id, m]));

  // 1) Proveedores
  let b = store.batch();
  SUPPLIERS.forEach(([id, name, rif, contact, phone, days]) => b.set(store.ref('suppliers', 'demo_' + id), { name, rif, contact, phone, email: '', days, notes: '', active: true, createdAt: nowISO(), updatedAt: nowISO() }));

  // 2) Repuestos, lubricantes y servicios
  const P = {};
  PRODUCTS.forEach(([k, name, active, strength, form, lab, category, units, price, cost, boxes, minBoxes, location, unitName, boxName, fits, maintId], i) => {
    const lots = addLot([], { lot: `${k.slice(0, 2).toUpperCase()}${2400 + i * 7}`, exp: '', qty: boxes * units, cost: money(cost) });
    P[k] = {
      id: 'demo_' + k, name, active, strength, form, lab, category, rx: 'libre', location, unitsPerBox: units, blister: 0, fraction: units > 1, price: money(price), blisterPrice: 0, unitPrice: 0, cost: money(cost), lastCost: money(cost),
      minStock: minBoxes * units, maxStock: minBoxes * units * 3, trackStock: true, sellable: true, online: true,
      supplierId: 'demo_' + SUPPLIERS[/Aceite|Filtro|Aditivo|lavado/.test(category) ? 1 : /Bater|Caucho/.test(category) ? 2 : 0][0],
      taxed: false, color: COLORS[i % COLORS.length], unitName: unitName || '', boxName: boxName || '', fits: fits || '', maintId: maintId || '',
      barcode: `759${String(1000000000 + i * 7919331).slice(0, 10)}`, sku: `${category.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, '0')}`, notes: '',
      stock: lots.reduce((a, l) => a + l.qty, 0), lots, expiresAt: nextExpiry({ lots }) || '', sold: 0, createdAt: at(120, 9).toISOString(), updatedAt: nowISO(), by: 'demo'
    };
  });
  SERVICES_LIST.forEach(([k, name, category, price, maintId]) => {
    P[k] = { id: 'demo_' + k, name, active: '', strength: '', form: 'Servicio', lab: '', category, rx: 'libre', location: '', unitsPerBox: 1, blister: 0, fraction: false, price: money(price), cost: 0, minStock: 0, maxStock: 0, trackStock: false, sellable: true, online: false, supplierId: null, taxed: false, color: category.includes('lavado') ? '#0891b2' : '#1d4ed8', unitName: '', boxName: '', fits: '', maintId: maintId || '', barcode: '', sku: k.toUpperCase(), notes: '', stock: 0, lots: [], expiresAt: '', sold: 0, createdAt: at(120, 9).toISOString(), updatedAt: nowISO(), by: 'demo' };
  });

  // 3) Clientes
  const O = {};
  OWNERS.forEach(([k, name, phone, idDoc, agreementId, debt, company], idx) => {
    O[k] = { id: 'demo_' + k, name, phone, phone2: '', email: '', idDoc, company: company || '', address: idx % 3 === 0 ? `Urb. La Esmeralda, calle ${idx + 2}` : '', notes: company ? 'Cliente de flota: facturar a la empresa' : '', agreementId: agreementId || '', agreementNumber: agreementId ? `CV-${10200 + idx * 13}` : '', howFound: ['Recomendación', 'Instagram', 'Google Maps', 'Pasó por el frente'][idx % 4], tags: [], active: true, visits: 0, totalSpent: 0, balance: debt ? money(debt) : 0, points: 0, lastVisitAt: null, createdAt: at(400 - idx * 9, 10).toISOString(), updatedAt: nowISO(), by: 'demo' };
  });
  Object.values(O).sort((a, c) => a.createdAt.localeCompare(c.createdAt)).forEach((c) => { const seq = store.nextSeq(b, 'cli'); c.number = fmtSeq('C', seq, 4); c.seq = seq; });

  // 4) Vehículos con lecturas de kilometraje y su plan de mantenimiento
  const V = {};
  const KMDAY = {};
  VEHICLES.forEach(([k, ok, plate, type, brand, model, year, color, fuel, gear, oil, km, kmDay, services, ctrl], idx) => {
    const o = O[ok];
    KMDAY[k] = kmDay;
    const kmAgo = (d) => Math.max(1000, Math.round(km - kmDay * d));
    const kmLog = [365, 180, 90, 6].map((d) => ({ date: inDays(-d), km: kmAgo(d) }));
    const svc = services.map(([mid, ago], j) => {
      const m = plan[mid]; const date = inDays(-ago); const skm = kmAgo(ago);
      return { id: `s${idx}${j}`, maintId: mid, name: m.name, date, km: skm, nextKm: m.everyKm ? skm + m.everyKm : null, next: m.everyDays ? dayKey(addDays(new Date(date + 'T12:00:00'), m.everyDays)) : '', note: '', jobId: null, jobNumber: '', at: at(ago, 11).toISOString() };
    });
    V[k] = {
      id: 'demo_v_' + k, plate, type, brand, model, year, color, vin: idx % 3 === 0 ? `8XA${String(1000000000000 + idx * 7919331).slice(0, 14)}` : '', engine: '', fuel, gear, oil, tires: '', notes: '', photo: '', insurance: o.agreementId === 'a_seguro' ? 'AutoProtege' : '',
      ownerId: o.id, ownerName: o.name, ownerPhone: o.phone, cardCode: genCode(8), active: true, km: kmLog[3].km, kmAt: kmLog[3].date, kmLog,
      services: svc, history: [], visits: 0, lastVisitAt: null, nextControl: ctrl != null ? inDays(ctrl) : '', reminded: {}, createdAt: o.createdAt, updatedAt: nowISO(), by: 'demo'
    };
  });
  Object.values(V).sort((a, c) => a.createdAt.localeCompare(c.createdAt) || a.plate.localeCompare(c.plate)).forEach((v) => { const seq = store.nextSeq(b, 'veh'); v.number = fmtSeq('V', seq, 4); v.seq = seq; });

  const line = (p, pack = 'caja', qty = 1) => {
    const f = packFactor(p, pack);
    return { productId: p.id, name: p.name, pack, factor: f, qty, price: packPrice(p, pack, mk()), listPrice: packPrice(p, pack, mk()), cost: round2(unitCost(p) * f * 10000) / 10000, kind: p.trackStock === false ? 'servicio' : 'producto', rx: 'libre', detail: '' };
  };
  /** Línea de orden de trabajo a partir de un producto o servicio */
  const jline = (k, qty = 1, mech = null, approved = true) => {
    const p = P[k]; const svc = p.trackStock === false;
    const pack = 'caja';
    return { id: 'l' + genCode(6).toLowerCase(), kind: svc ? (p.category.includes('lavado') ? 'servicio' : 'mano') : 'repuesto', productId: svc ? null : p.id, name: p.name, qty, price: packPrice(p, pack, mk()), cost: svc ? 0 : round2(unitCost(p) * packFactor(p, pack) * 10000) / 10000, pack, factor: svc ? 1 : packFactor(p, pack), mechanicId: svc ? mech : null, maintId: p.maintId || null, approved, detail: '' };
  };
  const docs = [];
  const hist = [];
  const clientOf = (v) => Object.values(O).find((x) => x.id === v.ownerId);

  // 5) Órdenes ya entregadas (con su historial en el vehículo y su venta)
  PAST_JOBS.forEach(([vk, ago, type, mech, complaint, diagnosis, ls, days], i) => {
    const v = V[vk]; const o = clientOf(v);
    const inAt = at(ago + days, 8 + (i % 3), (i * 15) % 60); const outAt = at(ago, 15 + (i % 3), (i * 20) % 60);
    const seq = store.nextSeq(b, 'ot');
    const lines = ls.map(([k, q]) => jline(k, q || 1, mech));
    const t = jobTotals({ lines });
    const kmOut = Math.max(1000, Math.round(v.km - KMDAY[vk] * (ago - 6)));
    const jid = 'demo_j' + seq;
    const job = {
      number: fmtSeq('OT', seq, 5), seq, open: false, status: 'entregado', type, vehicleId: v.id, plate: v.plate, vehicleName: vehicleName(v), vtype: v.type, ownerId: o.id, ownerName: o.name, phone: o.phone,
      complaint, diagnosis, recommendations: '', notes: '', kmIn: kmOut, kmOut, fuel: '1/2', checks: {}, belongings: [], damages: [], photos: [], mechanicId: mech, mechanicName: mechName(mech), promisedAt: '', apptId: null,
      lines, quoteCode: '', quoteStatus: '', charged: true, saleId: null, inAt: inAt.toISOString(), dayKey: dayKey(inAt), outAt: outAt.toISOString(), total: t.total, labor: t.labor, parts: t.parts,
      warrantyUntil: dayKey(addDays(outAt, 30)), warrantyKmUntil: kmOut + 1000, log: [{ at: inAt.toISOString(), text: `Vehículo recibido con ${kmOut} km`, by: 'demo' }, { at: outAt.toISOString(), text: 'Entregado al cliente', by: 'demo' }], by: 'demo'
    };
    docs.push(['jobs', jid, job]);
    v.history.push({ number: job.number, date: dayKey(outAt), km: kmOut, type: JOB_TYPES[type]?.label || 'Servicio', work: lines.map((l) => l.name).slice(0, 8).join(', '), total: t.total });
    v.visits++; v.lastVisitAt = !v.lastVisitAt || v.lastVisitAt < job.outAt ? job.outAt : v.lastVisitAt;
    if (ago <= 30) { v.warrantyUntil = job.warrantyUntil; v.warrantyKm = job.warrantyKmUntil; v.warrantyJob = job.number; }
    const saleLines = lines.map((l) => ({ productId: l.productId, name: l.name, pack: l.pack, factor: l.factor, qty: l.qty, price: l.price, listPrice: l.price, cost: l.cost, kind: l.kind === 'mano' ? 'servicio' : 'producto', rx: 'libre', detail: l.kind === 'mano' ? mechName(mech) : '' }));
    hist.push({ date: outAt, lines: saleLines, client: o, vehicle: v, jobId: jid, seller: 's6' });
  });
  for (const v of Object.values(V)) v.history.sort((a, c) => a.date.localeCompare(c.date));

  // 6) Ventas de mostrador (repuestos, lubricantes) y autolavado de los últimos 45 días
  const counterItems = ['ac_15w40', 'ac_20w50', 'ac_5w30', 'fa_chevy', 'fa_toyota', 'h4', 'limpia', 'inyect', 'refrig', 'dot4', 'ambient', 'silicon', 'bujias'];
  const washItems = ['svc_w_sencillo', 'svc_w_sencillo', 'svc_w_completo', 'svc_w_completo', 'svc_w_motor', 'svc_w_aspirado', 'svc_w_pulitura'];
  const ownersArr = Object.values(O);
  for (let d = 45; d >= 1; d--) {
    const n = 3 + Math.floor(R() * 4) + (d % 7 === 6 ? 3 : 0);
    for (let j = 0; j < n; j++) {
      const lines = [];
      const reg = R() < 0.45 ? pick(ownersArr) : null;
      const veh = reg ? Object.values(V).find((x) => x.ownerId === reg.id) : null;
      if (R() < 0.5) {
        lines.push(line(P[pick(washItems)]));
        if (R() < 0.35 && !lines.some((l) => l.productId === P.svc_w_aspirado.id)) lines.push(line(P.svc_w_aspirado));
      } else {
        const items = 1 + Math.floor(R() * 2);
        for (let q = 0; q < items; q++) {
          const p = P[pick(counterItems)];
          if (lines.some((l) => l.productId === p.id)) continue;
          const loose = p.unitsPerBox > 1 && R() < 0.4;
          lines.push(line(p, loose ? 'unidad' : 'caja', loose ? 1 + Math.floor(R() * 2) : p.id === P.ac_15w40.id ? 4 : 1));
        }
      }
      if (lines.length) hist.push({ date: at(d, 8 + Math.floor(R() * 9), Math.floor(R() * 60)), lines, client: reg, vehicle: veh, seller: pick(['s6', 's6', 's4']) });
    }
  }
  hist.sort((a, c) => a.date - c.date);
  for (const h of hist) {
    const c = h.client;
    const ag = c?.agreementId && c.agreementId !== 'a_seguro' ? AGREEMENTS.find((a) => a.id === c.agreementId) : null;
    const t = cartTotals(h.lines, 0);
    const agc = agreementCalc(ag, h.lines);
    const total = round2(t.subtotal - agc.discount);
    const covered = round2(Math.min(total, agc.covered));
    const paid = round2(total - covered);
    const method = pick(methods);
    const seq = store.nextSeq(b, 'inv');
    const number = fmtSeq(store.settings.invoicePrefix || 'F', seq, 6);
    const saleId = 'demo_s' + seq;
    const items = h.lines.map(({ rx: _r, ...l }) => ({ ...l, total: round2(l.price * l.qty) }));
    const seller = STAFF.find((s) => s.id === h.seller) || STAFF[5];
    const jobDoc = h.jobId ? docs.find((x) => x[1] === h.jobId) : null;
    const sale = {
      number, seq, kind: 'venta', date: h.date.toISOString(), dayKey: dayKey(h.date), items, subtotal: t.subtotal, discount: agc.discount, total,
      cost: round2(items.reduce((a, i) => a + i.cost * i.qty, 0)), rate: 1,
      payments: paid > 0 ? [{ method, currency: 'USD', amount: paid, usd: paid }] : [], paidUSD: paid, changeUSD: 0, changeCurrency: 'USD', method: paid > 0 ? method : 'convenio', received: paid, shiftId: null, cashFlow: null,
      ...clientFields(c ? { ...c } : null), status: 'completed', by: 'demo', note: '', credit: 0,
      agreementId: ag?.id || null, agreementName: ag?.name || '', agreementDue: covered, agreementPaid: null, agreementDiscount: agc.discount,
      pointsUsed: 0, pointsDiscount: 0, manualDiscount: 0, sellerId: seller.id, sellerName: seller.name, orderId: null, pointsEarned: c ? Math.floor(paid) : 0,
      vehicleId: h.vehicle?.id || null, plate: h.vehicle?.plate || '', vehicleName: h.vehicle ? vehicleName(h.vehicle) : '', km: h.vehicle?.km || null,
      jobId: h.jobId || null, jobNumber: jobDoc ? jobDoc[2].number : '', washId: null
    };
    docs.push(['sales', saleId, sale]);
    if (jobDoc) Object.assign(jobDoc[2], { saleId, saleNumber: number, paidTotal: total });
    for (const l of items) { const p = Object.values(P).find((x) => x.id === l.productId); if (p && p.trackStock !== false) p.sold += l.qty * l.factor; }
    if (c) { c.visits++; c.totalSpent = round2(c.totalSpent + paid); c.points += Math.floor(paid); c.lastVisitAt = sale.date; }
  }

  // 7) Mermas
  docs.push(['inventory_logs', 'demo_l1', { productId: P.ac_15w40.id, name: P.ac_15w40.name, date: at(9, 18).toISOString(), dayKey: dayKey(at(9, 18)), type: 'merma', qty: -2, cost: unitCost(P.ac_15w40), lots: [], reason: 'Envases rotos al descargar', by: 'demo' }]);
  docs.push(['inventory_logs', 'demo_l2', { productId: P.h4.id, name: P.h4.name, date: at(4, 12).toISOString(), dayKey: dayKey(at(4, 12)), type: 'merma', qty: -1, cost: unitCost(P.h4), lots: [], reason: 'Bombillo defectuoso (garantía con el proveedor)', by: 'demo' }]);

  // 8) Vehículos dentro del taller ahora (órdenes abiertas en el tablero)
  const nowMs = Date.now();
  const ago = (mins) => new Date(nowMs - mins * 60000).toISOString();
  const okChecks = { Luces: 'ok', Frenos: 'ok', Cauchos: 'ok', Limpiaparabrisas: 'ok', 'Batería': 'ok', 'Aceite de motor': 'ok', Refrigerante: 'ok', 'Aire acondicionado': 'ok', Vidrios: 'ok', 'Tapicería': 'ok' };
  const OPEN = [
    // vehículo, estado, tipo, mecánico, motivo, diagnóstico, líneas, combustible, revisión, daños, recibido hace (min), prometido en días, bitácora
    ['tucson', 'recibido', 'mantenimiento', 's1', 'Cambio de aceite y revisar ruido en la suspensión delantera', '', [], '3/4', { ...okChecks, Frenos: 'obs' }, [{ zone: 'del', kind: 'rayon', note: 'Rayón en el parachoques' }], 25, 0, [[25, 'Vehículo recibido']]],
    ['machito', 'diagnostico', 'diagnostico', 's3', 'Se recalienta en el tráfico', 'Revisando electroventilador y termostato', [['svc_diag', 1]], '1/2', { ...okChecks, Refrigerante: 'mal' }, [], 140, 1, [[140, 'Vehículo recibido'], [60, 'Estado: En diagnóstico']]],
    ['aveo', 'diagnostico', 'reparacion', 's2', 'Ruido en la suspensión y cambio de correa de tiempo', 'Meseta inferior izquierda con juego. Correa de tiempo con 75.000 km (le toca).', [['svc_correa', 1], ['kit_correa', 1], ['meseta', 1], ['svc_alinea', 1]], '1/4', { ...okChecks, Cauchos: 'obs' }, [{ zone: 'tra', kind: 'golpe', note: 'Abolladura leve en la maleta' }], 60 * 22, 2, [[60 * 22, 'Vehículo recibido'], [60 * 20, 'Estado: En diagnóstico']]],
    ['fortuner', 'presupuesto', 'reparacion', 's1', 'Vibra el volante al frenar', 'Discos delanteros cristalizados y pastillas al 20 %', [['svc_frenos', 1], ['past_hilux', 1], ['dot4', 1], ['svc_alinea', 1]], '1/2', okChecks, [], 60 * 5, 1, [[60 * 5, 'Vehículo recibido'], [60 * 3, 'Estado: En diagnóstico'], [60 * 2, 'Presupuesto enviado por WhatsApp']]],
    ['corolla', 'reparacion', 'mantenimiento', 's1', 'Servicio de 100.000 km', 'Mantenimiento mayor según plan', [['svc_afinac', 1], ['bujias', 1], ['fair_toy', 1], ['fgas', 1], ['inyect', 1], ['svc_aceite', 1], ['ac_5w30', 1], ['fa_toyota', 1]], 'Lleno', okChecks, [], 60 * 4, 0, [[60 * 4, 'Vehículo recibido'], [60 * 3, 'Presupuesto aprobado por el cliente desde su teléfono'], [90, 'Estado: En reparación']]],
    ['valle1', 'repuesto', 'reparacion', 's2', 'Pierde aceite por el motor', 'Estopera trasera del cigüeñal dañada', [['svc_diag', 1]], '1/2', { ...okChecks, 'Aceite de motor': 'mal' }, [], 60 * 50, 3, [[60 * 50, 'Vehículo recibido'], [60 * 44, 'Presupuesto aprobado en el taller'], [60 * 26, 'Estado: Esperando repuesto (llega el jueves)']]],
    ['optra', 'listo', 'mantenimiento', 's1', 'Cambio de aceite y filtro de aire', 'Rutina', [['svc_aceite', 1], ['ac_15w40', 4], ['fa_chevy', 1], ['fair_chevy', 1]], '1/2', okChecks, [], 60 * 3, 0, [[60 * 3, 'Vehículo recibido'], [100, 'Estado: En reparación'], [12, 'Estado: Listo para entregar']]]
  ];
  const openJobs = {};
  OPEN.forEach(([vk, status, type, mech, complaint, diagnosis, ls, fuel, checks, damages, minsAgo, promise, log], i) => {
    const v = V[vk]; const o = clientOf(v);
    const seq = store.nextSeq(b, 'ot');
    const lines = ls.map(([k, q]) => jline(k, q, mech, ['recibido', 'diagnostico', 'presupuesto'].includes(status) ? null : true));
    const jid = 'demo_jo' + i;
    const job = {
      number: fmtSeq('OT', seq, 5), seq, open: true, status, type, vehicleId: v.id, plate: v.plate, vehicleName: vehicleName(v), vtype: v.type, ownerId: o.id, ownerName: o.name, phone: o.phone,
      complaint, diagnosis, recommendations: vk === 'aveo' ? 'Revisar cauchos traseros en el próximo servicio' : '', notes: '', kmIn: v.km, fuel, checks, belongings: ['Caucho de repuesto', 'Gato', 'Llave de cauchos'].slice(0, 1 + (i % 3)), damages, photos: [],
      mechanicId: mech, mechanicName: mechName(mech), promisedAt: inDays(promise), apptId: null, lines, quoteCode: '', quoteStatus: ['reparacion', 'repuesto', 'listo'].includes(status) ? 'aprobado' : '',
      charged: false, saleId: null, inAt: ago(minsAgo), dayKey: dayKey(new Date(nowMs - minsAgo * 60000)), log: log.map(([m, text]) => ({ at: ago(m), text, by: 'demo' })), by: 'demo',
      ...(status === 'reparacion' || status === 'listo' ? { startedAt: ago(Math.min(minsAgo, 100)), approvedAt: ago(Math.min(minsAgo, 180)) } : {}), ...(status === 'listo' ? { readyAt: ago(12) } : {})
    };
    openJobs[vk] = { id: jid, ...job };
    docs.push(['jobs', jid, job]);
    v.visits++; v.lastVisitAt = job.inAt;
  });

  // Guardar todo (en lotes de 80 por la cuota de la caché local)
  for (const p of Object.values(P)) { const { id, ...data } = p; docs.push(['products', id, data]); }
  for (const c of Object.values(O)) { const { id, ...data } = c; docs.push(['clients', id, data]); }
  for (const v of Object.values(V)) { const { id, ...data } = v; docs.push(['vehicles', id, data]); }
  await store.commit(b);
  for (let i = 0; i < docs.length; i += 80) {
    const bb = store.batch();
    docs.slice(i, i + 80).forEach(([col, id, data]) => bb.set(store.ref(col, id), data));
    await store.commit(bb);
  }
  await waitFor(() => store.products.length >= PRODUCTS.length && store.clients.length >= OWNERS.length && store.vehicles.length >= VEHICLES.length && store.jobs.length >= OPEN.length && store.suppliers.length >= SUPPLIERS.length);

  // 9) Presupuestos: uno recién enviado esperando al cliente y otro que el cliente ya aprobó desde su teléfono
  try {
    await sendQuote(store.job(openJobs.aveo.id) || openJobs.aveo);
    const jF = store.job(openJobs.fortuner.id) || openJobs.fortuner;
    const code = genCode(8);
    const t = jobTotals(jF);
    const qb = store.batch();
    qb.set(store.quoteRef(code), {
      tenantId: store.tenantId, code, jobId: jF.id, number: jF.number, shop: store.businessName, shopPhone: store.settings.whatsapp || '', shopAddress: store.settings.address || '', country: store.settings.country || '',
      sym: '$', fx: null, owner: String(jF.ownerName || '').split(/\s+/)[0], plate: jF.plate, vehicle: jF.vehicleName, km: jF.kmIn || null,
      complaint: jF.complaint, diagnosis: jF.diagnosis, recommendations: '', lines: (jF.lines || []).map((l, i) => ({ i, kind: l.kind, name: l.name, qty: l.qty, price: l.price, total: round2(l.price * l.qty), detail: '' })),
      labor: t.labor, parts: t.parts, total: t.total, note: store.settings.quoteNote || '', warrantyDays: 30, promisedAt: jF.promisedAt || '', iva: 0,
      decision: 'aprobado', approved: [0, 1, 2], decisionNote: 'La alineación la hago el mes que viene', signName: 'Jorge Medina', decidedAt: ago(4), synced: false, sentAt: ago(60 * 2), demo: true
    });
    qb.set(store.ref('jobs', jF.id), { quoteCode: code, quoteStatus: 'pendiente', quoteSentAt: ago(60 * 2), quoteTotal: t.total }, { merge: true });
    await store.commit(qb);
  } catch (e) { console.warn('[demo] presupuestos', e); }

  // Fichas públicas de los vehículos (con el estado de su orden)
  await waitFor(() => store.quotes.length >= 2, 4000);
  b = store.batch();
  for (const v of Object.values(V)) { const fresh = store.vehicle(v.id) || { ...v }; b.set(store.cardRef(v.cardCode), cardData(fresh)); }
  await store.commit(b);

  // 10) Autolavado y agenda
  try {
    const hh = new Date().getHours();
    const t = (h, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const base = Math.min(Math.max(hh, 8), 15);
    const ab = store.batch();
    const wash = (id, vk, plate, desc, status, types, price, staffId, minsAgo, logs) => {
      const v = vk ? V[vk] : null; const o = v ? clientOf(v) : null;
      const seq = store.nextSeq(ab, 'wash');
      ab.set(store.ref('washes', id), {
        number: fmtSeq('L', seq, 5), seq, open: true, status, vehicleId: v?.id || null, plate: v?.plate || plate, vehicleName: v ? vehicleName(v) : desc, vtype: v?.type || 'carro',
        ownerId: o?.id || null, ownerName: o?.name || WALKIN[3], phone: o?.phone || '0412-5557788', types, minutes: types.reduce((a, n) => a + (WASH_TYPES_DEFAULT.find((w) => w.name === n)?.minutes || 20), 0),
        price: money(price), staffId, staffName: mechName(staffId), note: '', apptId: null, charged: false, inAt: ago(minsAgo), dayKey: todayKey(),
        log: logs.map(([m, text]) => ({ at: ago(m), text, by: 'demo' })), by: 'demo', ...(status !== 'espera' ? { startAt: ago(Math.max(5, minsAgo - 15)) } : {}), ...(status === 'listo' ? { readyAt: ago(6) } : {})
      });
    };
    wash('demo_w1', 'spark', '', '', 'listo', ['Lavado completo', 'Aspirado'], 13, 's4', 70, [[70, 'En cola'], [55, 'Lavando'], [25, 'Secado y aspirado'], [6, 'Listo para retirar']]);
    wash('demo_w2', null, 'AB987XY', 'Chevrolet Cruze blanco', 'lavando', ['Lavado sencillo'], 5, 's5', 30, [[30, 'En cola'], [15, 'Lavando']]);
    wash('demo_w3', 'valle2', '', '', 'espera', ['Lavado completo', 'Lavado de motor'], 18, 's4', 10, [[10, 'En cola']]);
    wash('demo_w4', 'rio', '', '', 'secado', ['Pulitura y encerado'], 35, 's5', 110, [[110, 'En cola'], [95, 'Lavando'], [20, 'Secado y aspirado']]);
    const APPTS = [
      [0, t(Math.max(7, base - 1), 30), 'mantenimiento', 's1', 'corolla', 'Servicio de 100.000 km', 'atendida'],
      [0, t(base, 0), 'mantenimiento', 's2', 'hilux', 'Cambio de aceite (le toca por km)', 'llego'],
      [0, t(base, 30), 'lavado', 's4', 'cherokee', 'Lavado completo y aspirado', 'confirmada'],
      [0, t(Math.min(base + 1, 16), 0), 'frenos', 's2', 'accent', 'Revisión de frenos', 'confirmada'],
      [0, t(Math.min(base + 2, 16), 30), 'revision', 's3', 'yaris', 'Revisar batería y luces', 'pendiente'],
      [1, t(8, 0), 'mantenimiento', 's1', 'valle3', 'Servicio de flota', 'confirmada'],
      [1, t(10, 30), 'cauchos', 's2', 'spark', 'Alineación y balanceo', 'pendiente'],
      [1, t(14, 0), 'diagnostico', 's3', 'rio', 'Check engine: cambio de sensor de oxígeno', 'confirmada'],
      [2, t(9, 0), 'mantenimiento', 's1', 'moto', 'Cambio de aceite', 'pendiente']
    ];
    APPTS.forEach(([d, time, service, staffId, vk, note, status], i) => {
      const v = V[vk]; const o = clientOf(v);
      ab.set(store.ref('appointments', 'demo_a' + i), {
        date: inDays(d), time, minutes: { lavado: 40, frenos: 90, cauchos: 45, diagnostico: 60, revision: 45 }[service] || 60, service, staffId, staffName: mechName(staffId),
        vehicleId: v.id, plate: v.plate, vehicleName: vehicleName(v), ownerId: o.id, ownerName: o.name, phone: o.phone, note, status,
        createdAt: at(3, 10).toISOString(), updatedAt: nowISO(), by: 'demo', ...(status === 'llego' ? { arrivedAt: ago(i * 7 + 5) } : {}), ...(status === 'atendida' ? { jobId: openJobs.corolla.id } : {})
      });
    });
    await store.commit(ab);
  } catch (e) { console.warn('[demo] agenda', e); }

  // 11) Caja abierta y movimientos de hoy
  try {
    if (!store.openShift) { await openShift({ openingUSD: money(50), note: 'Apertura demo' }); await waitFor(() => store.openShift); }
    await waitFor(() => store.product('demo_ac_15w40') && store.client('demo_maria'));
    const pr = (k) => store.product('demo_' + k);
    const L = (k, pack = 'caja', qty = 1) => line(pr(k), pack, qty);
    const due = (lines, agId = null) => { const ag = agId ? store.agreement(agId) : null; const t = cartTotals(lines, 0); const a = agreementCalc(ag, lines); const total = round2(t.subtotal - a.discount); return round2(total - Math.min(total, a.covered)); };
    const sell = async (lines, opts = {}, method = 'efectivo') => { const amount = due(lines, opts.agreementId); return chargeSale({ lines, payments: amount > 0 ? [{ method, amount }] : [], sellerId: 's6', ...opts }); };
    await sell([L('ac_15w40', 'caja', 4), L('fa_chevy')], {}, 'efectivo');
    await sell([L('limpia'), L('ambient')], { client: store.client('demo_ana'), vehicle: store.vehicle('demo_v_tucson') }, 'transferencia');
    await sell([L('svc_w_sencillo'), L('svc_w_aspirado')], {}, methods[3] || 'efectivo');
    await sell([L('h4', 'caja', 2)], {}, 'efectivo');
    await sell([L('svc_w_completo')], { client: store.client('demo_jose'), vehicle: store.vehicle('demo_v_aveo'), agreementId: 'a_taxi' }, 'debito');
    await cashMovement({ direction: 'out', currency: 'USD', amount: money(8), concept: 'Estopas y desengrasante', category: 'Insumos (bolsas, papel, etiquetas)' });
  } catch (e) { console.warn('[demo] ventas de hoy', e); }

  // 12) Compras: facturas por pagar y una orden pendiente
  try {
    const pr = (k) => store.product('demo_' + k);
    await receivePurchase({ supplierId: 'demo_sup2', invoiceNo: 'FAC-88231', items: [{ productId: pr('ac_15w40').id, boxes: 24, cost: pr('ac_15w40').cost, lot: 'VN2611', exp: '' }, { productId: pr('fa_chevy').id, boxes: 10, cost: pr('fa_chevy').cost, lot: 'WX2610', exp: '' }], paid: 0, dueDate: inDays(5), note: 'Crédito a 15 días' });
    await receivePurchase({ supplierId: 'demo_sup3', invoiceNo: 'B-004512', items: [{ productId: pr('bateria').id, boxes: 4, cost: pr('bateria').cost, lot: 'DN2609', exp: '' }, { productId: pr('caucho').id, boxes: 8, cost: pr('caucho').cost, lot: 'FS2609', exp: '' }], paid: money(200), dueDate: inDays(-2) });
    await createPurchaseOrder({ supplierId: 'demo_sup1', items: [{ productId: pr('past_corolla').id, boxes: 4, cost: pr('past_corolla').cost }, { productId: pr('fa_hilux').id, boxes: 6, cost: pr('fa_hilux').cost }, { productId: pr('bateria_g').id, boxes: 2, cost: pr('bateria_g').cost }], note: 'Pedido por WhatsApp' });
  } catch (e) { console.warn('[demo] compras', e); }

  // 13) Pedidos en línea (catálogo público de repuestos)
  try {
    const slug = store.settings.shop?.slug || '';
    const it = (k, q) => { const p = store.product('demo_' + k); return { id: p.id, n: p.name, q, p: p.price, rx: false }; };
    const mkOrder = (name, phone, items, note, minsAgo) => ({ tenantId: store.tenantId, slug, number: 'W-' + genCode(5), name, phone, address: '', mode: 'retiro', deliveryFee: 0, note, payMethod: 'Pago móvil', hasRx: false, items, total: round2(items.reduce((a, x) => a + x.p * x.q, 0)), status: 'nueva', createdAt: ago(minsAgo) });
    const ob = store.batch();
    const r1 = doc(collection(db, 'orders')); const r2 = doc(collection(db, 'orders')); const r3 = doc(collection(db, 'orders'));
    ob.set(r1, mkOrder(WALKIN[0], '0414-7654321', [it('ac_5w30', 1), it('fa_toyota', 1)], 'Es para un Corolla 2016. ¿Me lo cambian mañana?', 8));
    ob.set(r2, mkOrder(WALKIN[1], '0412-9876543', [it('bateria', 1)], 'Paso en la tarde', 35));
    ob.set(r3, mkOrder(WALKIN[2], '0424-1237890', [it('limpia', 1), it('h4', 2)], '', 70));
    await store.commit(ob);
    await waitFor(() => store.orders.length >= 3, 4000);
    await setOrderStatus({ id: r2.id }, 'preparando');
    await setOrderStatus({ id: r3.id }, 'lista');
  } catch (e) { console.warn('[demo] pedidos', e); }
}

/** Borra todos los datos de una sede (fichas públicas, presupuestos, su catálogo en línea y sus pedidos). */
export async function purgeTenant(tenantId, onlyDemo = true, slug = '') {
  const delAll = async (refs, what) => {
    for (let i = 0; i < refs.length; i += 80) {
      const b = writeBatch(db);
      refs.slice(i, i + 80).forEach((r) => b.delete(r));
      await b.commit().catch((e) => console.warn('[purge]', what, e?.code || e));
    }
  };
  try {
    const snap = await getDocs(collection(db, 'tenants', tenantId, 'vehicles'));
    await delAll(snap.docs.map((d) => d.data().cardCode).filter(Boolean).map((c) => doc(db, 'cards', c)), 'fichas');
  } catch (e) { console.warn('[purge] fichas', e?.code || e); }
  try {
    const rq = await getDocs(query(collection(db, 'quotes'), where('tenantId', '==', tenantId)));
    await delAll(rq.docs.map((d) => d.ref), 'presupuestos');
  } catch (e) { console.warn('[purge] presupuestos', e?.code || e); }
  try {
    let s = slug;
    if (!s) { const st = await getDoc(doc(db, 'tenants', tenantId, 'config', 'settings')); s = st.exists() ? st.data().shop?.slug || '' : ''; }
    if (s) { const sh = await getDoc(doc(db, 'shops', s)); if (sh.exists() && sh.data().tenantId === tenantId) { const b = writeBatch(db); b.delete(sh.ref); await b.commit(); } }
  } catch (e) { console.warn('[purge] catálogo', e?.code || e); }
  try {
    const rq = await getDocs(query(collection(db, 'orders'), where('tenantId', '==', tenantId)));
    await delAll(rq.docs.map((d) => d.ref), 'pedidos');
  } catch (e) { console.warn('[purge] pedidos', e?.code || e); }
  for (const c of DATA_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, 'tenants', tenantId, c));
      await delAll(snap.docs.map((d) => d.ref), c);
    } catch (e) { console.warn('[purge]', c, e?.code || e); }
  }
  if (onlyDemo) {
    try {
      const t = await getDoc(doc(db, 'tenants', tenantId));
      if (t.exists() && t.data().demo === true) { const b = writeBatch(db); b.delete(t.ref); await b.commit(); }
    } catch (e) { console.warn('[purge] sede', e?.code || e); }
  }
}

/** Borra la demo actual y la cuenta anónima. */
export async function cleanupDemo(tenantId, slug = '') {
  await purgeTenant(tenantId, true, slug);
  const u = auth.currentUser;
  if (u && u.isAnonymous) {
    try { await u.delete(); } catch (_) { await signOut(auth).catch(() => {}); }
  }
}
