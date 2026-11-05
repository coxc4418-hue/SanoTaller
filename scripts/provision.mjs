// SanoTaller — Crea las cuentas de las sedes y el administrador general.
// Uso:  node provision.mjs [cantidad=20] [--emu]
// Genera contraseñas y PIN aleatorios y los guarda en ../CREDENCIALES_SANO_TALLER.txt
// Es seguro re-ejecutarlo: conserva las cuentas y contraseñas ya creadas.
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { webcrypto, randomInt } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const EMU = process.argv.includes('--emu');
const COUNT = Number(process.argv.find((a) => /^\d+$/.test(a)) || 20);
const OUT = path.join(here, '..', EMU ? 'CREDENCIALES_EMULADOR.txt' : 'CREDENCIALES_SANO_TALLER.txt');
const STATE = path.join(here, EMU ? '.accounts-emu.json' : '.accounts.json');
const DOMAIN = 'sanotaller.app';
const APP_URL = 'https://sano-taller.web.app';

const config = {
  apiKey: 'AIzaSy-PENDIENTE-sano-taller',
  authDomain: 'sano-taller.firebaseapp.com',
  projectId: 'sano-taller',
  storageBucket: 'sano-taller.firebasestorage.app',
  messagingSenderId: '0',
  appId: '1:0:web:pendiente'
};

// Configuración inicial de cada sede. Los planes, servicios, categorías y demás valores salen de DEFAULT_SETTINGS
// (public/js/store.js). El país y la moneda NO se fijan: se preguntan la primera vez que se entra.
const SETTINGS = {
  rif: '', phone: '', whatsapp: '', email: '', address: '', instagram: '', receiptFormat: '80mm',
  country: '', currency: '', iva: 0, invoicePrefix: 'F', docTitle: 'RECIBO'
};
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const genPass = () => 'Sv-' + Array.from({ length: 9 }, () => ALPHA[randomInt(ALPHA.length)]).join('') + '!' + randomInt(10, 99);
const genPin = () => String(randomInt(1000, 9999));
const sha256 = async (t) => Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(t))).toString('hex');

const saved = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const app = initializeApp(config, 'provision');
const auth = getAuth(app);
const db = initializeFirestore(app, {});
if (EMU) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9899', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8880);
}
async function ensureUser(email, password) {
  try { return (await createUserWithEmailAndPassword(auth, email, password)).user; }
  catch (e) { if (e.code === 'auth/email-already-in-use') return (await signInWithEmailAndPassword(auth, email, password)).user; throw e; }
}

// 1) Administrador general (crea los documentos de las sedes)
const admin = saved.admin || { code: 'admin', email: `admin@${DOMAIN}`, password: genPass() };
const au = await ensureUser(admin.email, admin.password);
admin.uid = au.uid; saved.admin = admin;
await signOut(auth);
console.log(`✔ administrador general (${au.uid})`);

// 2) Cuentas de las sedes
const accounts = [];
for (let i = 1; i <= COUNT; i++) {
  const code = 'sede' + String(i).padStart(2, '0');
  const email = `${code}@${DOMAIN}`;
  const acc = saved[code] || { code, email, password: genPass(), pin: genPin(), name: `Sede ${String(i).padStart(2, '0')}` };
  const user = await ensureUser(email, acc.password);
  acc.uid = user.uid;
  await signOut(auth);
  saved[code] = acc; accounts.push(acc);
}
writeFileSync(STATE, JSON.stringify(saved, null, 2));

// 3) Documentos de las sedes (como administrador)
await signInWithEmailAndPassword(auth, admin.email, admin.password);
for (const acc of accounts) {
  const tRef = doc(db, 'tenants', acc.uid);
  if ((await getDoc(tRef)).exists()) { console.log(`• ${acc.code} ya existía`); continue; }
  const now = new Date().toISOString();
  await setDoc(tRef, { name: acc.name, code: acc.code, ownerUid: acc.uid, ownerEmail: acc.email, active: true, createdAt: now, createdBy: 'provision', plan: 'Básico', paidUntil: null, ownerName: '', ownerPhone: '', notes: '' });
  await setDoc(doc(db, 'tenants', acc.uid, 'config', 'settings'), { ...SETTINGS, businessName: acc.name });
  await setDoc(doc(db, 'tenants', acc.uid, 'config', 'security'), { pinHash: await sha256(`${acc.uid}:${acc.pin}`), updatedAt: now });
  await setDoc(doc(db, 'usernames', acc.code), { email: acc.email, uid: acc.uid, createdAt: now });
  console.log(`✔ ${acc.code} creada (${acc.uid})`);
}
await setDoc(doc(db, 'usernames', 'admin'), { email: admin.email, uid: admin.uid, createdAt: new Date().toISOString() });
await signOut(auth);

const lines = [
  'SANOTALLER — CREDENCIALES DE ACCESO' + (EMU ? ' (EMULADOR DE PRUEBAS)' : ''),
  `Generado: ${new Date().toLocaleString('es')}`,
  `Aplicación: ${APP_URL}`,
  '',
  'Inicia sesión escribiendo el USUARIO (ej. sede01) o el correo completo.',
  'El PIN protege reportes, anulaciones, descuentos, ventas a crédito, ajustes de puntos, conteo físico de inventario, cancelar órdenes de trabajo, cambio de país, gastos y cierre de caja.',
  'Al entrar por primera vez el sistema pregunta el PAÍS del taller: define la moneda, las formas de pago y el WhatsApp.',
  'Luego: Ajustes > Taller (nombre, RIF, jefe de taller, teléfono), Equipo (mecánicos con su comisión, lavadores, caja), Mantenimiento y agenda (plan de mantenimiento por km y fecha, precio de la hora de mano de obra, garantía, bahías y tipos de lavado, horario), Moneda, Flotas y convenios, Pedidos en línea y Puntos. Carga tus repuestos y servicios en Inventario (o impórtalos por CSV) y tus vehículos con su dueño en Vehículos (también por CSV).',
  'Cada sede puede cambiar su contraseña y su PIN en Configuración > Seguridad.',
  'GUARDA ESTE ARCHIVO EN UN LUGAR SEGURO. NO LO COMPARTAS.',
  '',
  'ADMINISTRADOR GENERAL (panel de todas las sedes)',
  `  Usuario: admin    Correo: ${admin.email}    Contraseña: ${admin.password}`,
  '',
  'SEDES',
  '  Usuario   Contraseña          PIN    Correo',
  ...accounts.map((a) => `  ${a.code.padEnd(9)} ${a.password.padEnd(19)} ${a.pin}   ${a.email}`),
  '',
  'Demo: botón "Probar demo gratis" en la pantalla de inicio (30 min, sin registro, PIN 1234).',
  `Ficha pública de cada vehículo: ${APP_URL}/vehiculo/CODIGO (estado de la orden, mantenimiento por km, historial y QR).`,
  `Presupuesto para aprobar desde el teléfono: ${APP_URL}/presupuesto/CODIGO (se envía por WhatsApp desde la orden).`,
  `Catálogo de repuestos en línea de cada taller: ${APP_URL}/pedido/NOMBRE (enlace y QR en Ajustes > Pedidos en línea).`,
  'Ventas / soporte por WhatsApp: +58 422-190 6045'
];
writeFileSync(OUT, lines.join('\r\n'), 'utf8');
console.log(`\nCredenciales guardadas en ${OUT}`);
await deleteApp(app);
process.exit(0);
