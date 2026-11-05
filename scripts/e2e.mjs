// SanoTaller — Prueba de punta a punta contra los emuladores (datos creados por test-emu.sh)
// Uso: node e2e.mjs [url=http://127.0.0.1:5141] [carpeta de capturas]
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.argv[2] || 'http://127.0.0.1:5141';
const BASE = ORIGIN + '/?emu=1';
const OUT = path.resolve(here, process.argv[3] || 'shots');
mkdirSync(OUT, { recursive: true });
const acc = JSON.parse(readFileSync(path.join(here, '.accounts-emu.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; let passed = 0;
const ok = (name, cond, extra = '') => { console.log(cond ? '  ✔' : '  ✘', name, extra); if (cond) passed++; else fails++; };
const errs = [];
const logs = [];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
async function newPage(w = 1366, h = 860) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: w, height: h });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept());
  p.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) logs.push(m.text()); });
  return { ctx, p };
}
// Ejecuta una función con acceso a los módulos de la app
const run = (p, fn, arg = null) => p.evaluate(async (src, a) => {
  const M = { store: (await import('/js/store.js')).store, ops: await import('/js/ops.js'), utils: await import('/js/utils.js'), tl: await import('/js/taller.js') };
  M.wait = async (f, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return f(); };
  return (0, eval)(src)(M, a);
}, fn.toString(), arg);
const go = async (p, route) => { await p.evaluate((r) => { location.hash = '#/' + r; }, route); await sleep(1100); };
const text = (p) => p.evaluate(() => document.body.innerText);
const pin = async (p, value = null) => {
  await p.waitForSelector('.modal [data-pin]', { timeout: 8000 });
  await p.type('.modal [data-pin]', value || acc.sede01.pin);
  await p.evaluate(() => [...document.querySelectorAll('.modal [data-ok]')].pop().click());
  await sleep(900);
};
const pickCountry = async (p, code) => {
  await p.waitForSelector(`.country-grid [data-c="${code}"]`, { timeout: 60000 });
  await p.click(`.country-grid [data-c="${code}"]`); await sleep(250);
  await p.evaluate(() => [...document.querySelectorAll('.modal [data-ok]')].pop().click());
  await sleep(1500);
};

try {
  // ==================================================================
  console.log('1) Inicio de sesión y país');
  let { ctx, p } = await newPage();
  await p.goto(BASE, { waitUntil: 'networkidle2' });
  await p.waitForSelector('#login-form');
  await p.screenshot({ path: path.join(OUT, '01-login.png') });
  await p.type('#lg-user', 'sede01'); await p.type('#lg-pass', acc.sede01.password); await p.click('#lg-btn');
  await pickCountry(p, 'VE');
  await p.waitForSelector('.sb-nav', { timeout: 30000 });
  ok('sede01 entra y elige país (Venezuela)', (await run(p, ({ store }) => store.settings.country)) === 'VE');
  await p.evaluate(async () => (await import('/js/tour.js')).stopTour());

  // ==================================================================
  console.log('2) Ajustes, equipo, repuestos y caja');
  const r1 = await run(p, async ({ store, ops, wait }) => {
    await store.saveSettings({
      businessName: 'Taller Prueba', whatsapp: '04141234567', fractionMarkup: 10, laborRate: 15, warrantyDays: 30, warrantyKm: 1000,
      agreements: [{ id: 'flota', name: 'Flota Prueba', discount: 10, coverage: 0, scope: 'todo', contact: '', active: true }],
      sellers: [{ id: 'm1', name: 'Mecánico Uno', role: 'mecanico', commission: 30, active: true }, { id: 'm2', name: 'Mecánico Dos', role: 'mecanico', commission: 20, active: true }, { id: 'l1', name: 'Lavador Uno', role: 'lavador', active: true }, { id: 'c1', name: 'Caja Uno', role: 'caja', active: true }],
      loyalty: { enabled: true, per: 1, pointValue: 0.05, minRedeem: 100 }
    });
    await ops.openShift({ openingUSD: 50 });
    const sup = await ops.saveSupplier({ name: 'Repuestos Prueba', days: 15 });
    const oil = await ops.saveProduct({ name: 'Aceite 5W-30 sintético galón', active: 'SAE 5W-30', form: 'Galón', category: 'Aceites y lubricantes', unitsPerBox: 4, price: 40, cost: 24, minStock: 8, unitName: 'litro', boxName: 'Galón', barcode: '7590000000017', supplierId: sup.id, maintId: 'm_aceite' }, null, { units: 12, lot: 'LA' });
    const filt = await ops.saveProduct({ name: 'Filtro de aceite Corolla', active: '90915-YZZE1', form: 'Unidad', category: 'Filtros', unitsPerBox: 1, price: 6, cost: 3, minStock: 5, fits: 'Toyota Corolla Yaris', maintId: 'm_aceite', supplierId: sup.id }, null, { units: 10, lot: 'F1' });
    const pads = await ops.saveProduct({ name: 'Pastillas de freno Aveo', active: 'D1035', form: 'Juego', category: 'Frenos', unitsPerBox: 1, price: 24, cost: 13, minStock: 2, fits: 'Chevrolet Aveo' }, null, { units: 2 });
    const labor = await ops.saveProduct({ name: 'Cambio de aceite (mano de obra)', category: 'Servicios de taller', price: 8, trackStock: false, maintId: 'm_aceite' });
    const wash = await ops.saveProduct({ name: 'Lavado sencillo', category: 'Servicios de lavado', price: 5, trackStock: false });
    let dupBar = ''; try { await ops.saveProduct({ name: 'Otro', barcode: '7590000000017', price: 1 }); } catch (e) { dupBar = e.message; }
    await wait(() => store.products.length >= 5 && store.product(oil.id));
    await ops.receivePurchase({ supplierId: sup.id, invoiceNo: 'F-1', items: [{ productId: oil.id, boxes: 2, cost: 30, lot: 'LB' }], paid: 0, dueDate: '2000-01-01' });
    await wait(() => store.product(oil.id).stock === 20 && store.payables.length === 1);
    const a = store.product(oil.id);
    return { shift: !!store.openShift, stock: a.stock, cost: a.cost, byBar: store.byBarcode('7590000000017')?.id === oil.id, dupBar, payable: store.payables[0]?.balance, mech: store.mechanics.length, washers: store.washers.length, ids: { oil: oil.id, filt: filt.id, pads: pads.id, labor: labor.id, wash: wash.id } };
  });
  ok('Caja abierta y equipo por rol', r1.shift && r1.mech === 2 && r1.washers === 1, `mecánicos ${r1.mech} · lavadores ${r1.washers}`);
  ok('Compra suma al inventario (12 + 8 litros)', r1.stock === 20, `${r1.stock} litros`);
  ok('Costo promedio ponderado al recibir', Math.abs(r1.cost - 26.4) < 0.01, String(r1.cost));
  ok('Encuentra por código de barras y rechaza duplicado', r1.byBar && /código de barras/.test(r1.dupBar), r1.dupBar);
  ok('Factura a crédito queda en cuentas por pagar', r1.payable === 60, String(r1.payable));
  const ID = r1.ids;

  // ==================================================================
  console.log('3) Cliente, vehículo, kilometraje y plan de mantenimiento');
  const r2 = await run(p, async ({ store, ops, utils, wait }) => {
    const inD = (n) => utils.dayKey(utils.addDays(new Date(), n));
    const { vehicle, owner } = await ops.saveVehicle({ plate: 'ab 123 cd', type: 'carro', brand: 'Toyota', model: 'Corolla', year: '2015', color: 'Plata', fuel: 'gasolina', km: 45000 }, null, { name: 'Cliente Prueba', phone: '04241112233', idDoc: 'v-12345678', agreementId: 'flota' });
    let dupPlate = ''; try { await ops.saveVehicle({ plate: 'AB-123-CD', brand: 'Otro' }, null, { id: owner.id }); } catch (e) { dupPlate = e.message; }
    let noOwner = ''; try { await ops.saveVehicle({ plate: 'ZZ999ZZ' }, null, null); } catch (e) { noOwner = e.message; }
    let dup = ''; try { await ops.saveClient({ name: 'Otro', phone: '04241112233' }); } catch (e) { dup = e.message; }
    await wait(() => store.vehicle(vehicle.id) && store.client(owner.id));
    const { vehicle: aveo } = await ops.saveVehicle({ plate: 'AD789GH', brand: 'Chevrolet', model: 'Aveo', year: '2011', km: 230000 }, null, { id: owner.id });
    await wait(() => store.vehicle(aveo.id));
    // Servicio viejo del plan: cambio de aceite hace 200 días a los 40.000 km → vencido por fecha y por km
    await ops.addService(store.vehicle(vehicle.id), { maintId: 'm_aceite', date: inD(-200), km: 40000 });
    await wait(() => (store.vehicle(vehicle.id).services || []).length === 1);
    const due = store.dueFor(store.vehicle(vehicle.id));
    const inRem = store.dueMaint.filter((x) => x.vehicle.id === vehicle.id).length;
    await ops.updateKm(store.vehicle(vehicle.id), 46000);
    await wait(() => store.vehicle(vehicle.id).km === 46000);
    const v = store.vehicle(vehicle.id);
    const card = await (await import('/js/store.js')).getCard(v.cardCode);
    return { plate: v.plate, vnum: v.number, cnum: owner.number, idDoc: store.client(owner.id).idDoc, vehs: store.vehiclesOf(owner.id).length, dupPlate, noOwner, dup, due: due.map((x) => `${x.name}:${x.left}:${x.d}`), late: due[0]?.late, inRem, km: v.km, card: card && { plate: card.plate, services: (card.services || []).length, km: card.km }, code: v.cardCode, vid: vehicle.id, aveo: aveo.id, owner: owner.id };
  });
  ok('Placa normalizada, vehículo y cliente con número', r2.plate === 'AB 123 CD' && /^V-\d{4}$/.test(r2.vnum) && /^C-\d{4}$/.test(r2.cnum) && r2.idDoc === 'V-12345678', `${r2.plate} · ${r2.vnum} · ${r2.cnum}`);
  ok('Un cliente con varios vehículos', r2.vehs === 2, String(r2.vehs));
  ok('Rechaza placa repetida, exige dueño y rechaza teléfono duplicado', /ya está registrada/.test(r2.dupPlate) && /dueño/i.test(r2.noOwner) && /Ya existe/.test(r2.dup), `${r2.dupPlate} · ${r2.noOwner}`);
  ok('Cambio de aceite vencido (por km y fecha) entra a recordatorios', r2.late && r2.inRem === 1, r2.due.join(', '));
  ok('Ficha pública con placa, kilometraje y plan', r2.card && r2.card.plate === 'AB 123 CD' && r2.card.services === 1 && r2.card.km === 46000, JSON.stringify(r2.card));
  Object.assign(ID, { veh: r2.vid, aveo: r2.aveo, owner: r2.owner });

  // ==================================================================
  console.log('4) Cita, recepción, orden de trabajo y presupuesto');
  const r3 = await run(p, async ({ store, ops, utils, wait }, ID) => {
    const today = utils.todayKey();
    const a = await ops.saveAppt({ vehicleId: ID.veh, date: today, time: '10:00', minutes: 60, service: 'mantenimiento', staffId: 'm1', note: 'Cambio de aceite' });
    let clash = ''; try { await ops.saveAppt({ vehicleId: ID.aveo, date: today, time: '10:30', minutes: 60, service: 'frenos', staffId: 'm1' }); } catch (e) { clash = e.clash ? e.message : ''; }
    const forced = await ops.saveAppt({ vehicleId: ID.aveo, date: today, time: '10:30', minutes: 60, service: 'frenos', staffId: 'm1', force: true });
    await wait(() => store.todayAppts.length >= 2);
    await ops.setApptStatus(store.appointments.find((x) => x.id === a.id), 'llego');
    await wait(() => store.waiting.some((x) => x.id === a.id));
    const job = await ops.openJob({ vehicleId: ID.veh, type: 'mantenimiento', complaint: 'Cambio de aceite y alineación', km: 46500, fuel: '1/2', checks: { Luces: 'ok', Frenos: 'obs' }, belongings: ['Gato'], damages: [{ zone: 'del', kind: 'rayon', note: 'Parachoques' }], mechanicId: 'm1', promisedAt: today, apptId: a.id });
    let dupJob = ''; try { await ops.openJob({ vehicleId: ID.veh, complaint: 'Otra' }); } catch (e) { dupJob = e.message; }
    await wait(() => store.job(job.id) && store.appointments.find((x) => x.id === a.id)?.status === 'atendida');
    const oil = store.product(ID.oil); const f = store.product(ID.filt);
    const lines = [
      { kind: 'mano', name: 'Cambio de aceite (mano de obra)', qty: 1, price: 8, mechanicId: 'm1', maintId: 'm_aceite' },
      { kind: 'repuesto', productId: oil.id, name: oil.name, qty: 1, price: 40, cost: oil.cost, pack: 'caja', factor: 4 },
      { kind: 'repuesto', productId: f.id, name: f.name, qty: 1, price: 6, cost: f.cost, maintId: 'm_aceite' },
      { kind: 'mano', name: 'Alineación y balanceo', qty: 1, price: 25, mechanicId: 'm2' }
    ];
    await ops.saveJob(store.job(job.id), { diagnosis: 'Aceite negro, filtro tapado', lines });
    await wait(() => (store.job(job.id)?.lines || []).length === 4);
    await ops.setJobStatus(store.job(job.id), 'diagnostico');
    const sent = await ops.sendQuote(store.job(job.id));
    await wait(() => store.job(job.id)?.status === 'presupuesto' && store.quote(sent.quoteCode));
    const q = store.quote(sent.quoteCode);
    const card = await (await import('/js/store.js')).getCard(store.vehicle(ID.veh).cardCode);
    return { clash, forced: !!forced.id, num: job.number, dupJob, appt: store.appointments.find((x) => x.id === a.id)?.status, kmIn: store.job(job.id).kmIn, vkm: store.vehicle(ID.veh).km, code: sent.quoteCode, qTotal: q?.total, qLines: (q?.lines || []).length, qDec: q?.decision, cardJob: card?.job, jobId: job.id, pending: store.pendingQuotes.length };
  }, ID);
  ok('La agenda avisa el choque de horario (y permite forzarlo)', /ya tiene una cita/.test(r3.clash) && r3.forced, r3.clash);
  ok('Recepción abre la orden y marca la cita como recibida', /^OT-\d{5}$/.test(r3.num) && r3.appt === 'atendida' && r3.kmIn === 46500 && r3.vkm === 46500, `${r3.num} · ${r3.kmIn} km`);
  ok('No abre dos órdenes para el mismo vehículo', /ya tiene una orden abierta/.test(r3.dupJob), r3.dupJob);
  ok('Presupuesto publicado con sus líneas', r3.qTotal === 79 && r3.qLines === 4 && r3.qDec === '' && r3.pending === 1, `total ${r3.qTotal}`);
  ok('La ficha pública muestra la orden y el enlace al presupuesto', r3.cardJob && r3.cardJob.status === 'presupuesto' && r3.cardJob.quoteCode === r3.code, JSON.stringify(r3.cardJob));
  ID.job = r3.jobId;

  // El cliente abre el presupuesto en su teléfono y aprueba todo menos la alineación
  const pubCtx = await browser.createBrowserContext();
  const pub = await pubCtx.newPage();
  await pub.setViewport({ width: 390, height: 844, isMobile: true });
  pub.on('pageerror', (e) => errs.push('público: ' + e.message));
  pub.on('dialog', (d) => d.accept());
  await pub.goto(`${ORIGIN}/presupuesto/${r3.code}?emu=1`, { waitUntil: 'networkidle2' });
  await pub.waitForSelector('.quote-line [data-i]', { timeout: 20000 });
  await pub.screenshot({ path: path.join(OUT, '03-presupuesto.png'), fullPage: true });
  await pub.click('.quote-line [data-i="3"]'); await sleep(400);
  const btnTxt = await pub.evaluate(() => document.querySelector('[data-ok]')?.textContent || '');
  await pub.click('[data-ok]'); await sleep(2500);
  const qt = await pub.evaluate(() => document.body.innerText);
  ok('El cliente aprueba 3 de 4 trabajos desde su teléfono', /3 de 4/.test(btnTxt) && /aprob/i.test(qt), btnTxt.trim());
  await pub.screenshot({ path: path.join(OUT, '03-presupuesto-aprobado.png'), fullPage: true });

  const r4 = await run(p, async ({ store, ops, wait, tl }, ID) => {
    await wait(() => store.job(ID.job)?.status === 'aprobado', 12000);
    const j = store.job(ID.job);
    const approved = tl.jobTotals(j, true).total;
    await ops.setJobStatus(store.job(ID.job), 'reparacion');
    await ops.setJobStatus(store.job(ID.job), 'listo');
    await wait(() => store.readyJobs.some((x) => x.id === ID.job));
    // Cobrar la orden (solo lo aprobado) con el convenio de flota (10 %)
    const lines = ops.jobLines(store.job(ID.job));
    const s = await ops.chargeSale({ lines, client: store.client(ID.owner), vehicle: store.vehicle(ID.veh), jobId: ID.job, agreementId: 'flota', payments: [{ method: 'efectivo', amount: 48.6 }] });
    await wait(() => store.job(ID.job)?.charged);
    const oil = store.product(ID.oil).stock;
    const done = await ops.deliverJob(store.job(ID.job), { km: 46520, nextControl: '' });
    await wait(() => !store.job(ID.job) && (store.vehicle(ID.veh).history || []).length === 1);
    const v = store.vehicle(ID.veh);
    const last = tl.latestBy(v.services || []).find((x) => x.maintId === 'm_aceite');
    const due = store.dueFor(v).find((x) => x.name === last?.name);
    const jobs = await store.jobsDeliveredBetween(new Date(Date.now() - 864e5).toISOString(), new Date(Date.now() + 864e5).toISOString());
    const com = ops.laborByMechanic(jobs);
    return { status: j.status, quoteStatus: j.quoteStatus, off: j.lines.filter((l) => l.approved === false).map((l) => l.name), approved, lines: lines.length, total: s.sale.total, jobNum: s.sale.jobNumber, plate: s.sale.plate, oil, done: done.status, warranty: v.warrantyUntil, wkm: v.warrantyKm, hist: v.history[0]?.total, nextKm: last?.nextKm, late: due?.late, com: com.map((c) => `${c.name}:${c.labor}:${c.commission}`) };
  }, ID);
  ok('La decisión del cliente llega sola a la orden', r4.status === 'aprobado' && r4.quoteStatus === 'aprobado' && r4.off.join() === 'Alineación y balanceo', `${r4.status} · sin ${r4.off.join()}`);
  ok('Cobra solo lo aprobado con el convenio de flota', r4.approved === 54 && r4.lines === 3 && r4.total === 48.6 && /^OT-/.test(r4.jobNum) && r4.plate === 'AB 123 CD', `aprobado ${r4.approved} · cobrado ${r4.total}`);
  ok('El galón sale del inventario', r4.oil === 16, `${r4.oil} litros`);
  ok('Entrega: historial, garantía y próximo cambio de aceite por km', r4.done === 'entregado' && !!r4.warranty && r4.wkm === 47520 && r4.hist === 54 && r4.nextKm === 51520 && !r4.late, `próximo a los ${r4.nextKm} km · garantía ${r4.warranty}`);
  ok('Comisión del mecánico sobre la mano de obra', r4.com.length === 1 && r4.com[0] === 'Mecánico Uno:8:2.4', r4.com.join(', '));

  // ==================================================================
  console.log('5) Autolavado');
  const r5 = await run(p, async ({ store, ops, wait }, ID) => {
    const w = await ops.openWash({ plate: 'xyz 999', desc: 'Chevrolet Cruze blanco', ownerName: 'Cliente de paso', phone: '04121234567', types: ['Lavado sencillo'], price: 5, staffId: 'l1' });
    let dupW = ''; try { await ops.openWash({ plate: 'XYZ999', types: ['Lavado sencillo'] }); } catch (e) { dupW = e.message; }
    let noType = ''; try { await ops.openWash({ vehicleId: ID.aveo, types: [] }); } catch (e) { noType = e.message; }
    await wait(() => store.washQueue.some((x) => x.id === w.id));
    const w2 = await ops.openWash({ vehicleId: ID.aveo, types: ['Lavado completo', 'Aspirado'], price: 13, staffId: 'l1' });
    await wait(() => store.washQueue.length === 2);
    const eta = ops.washEta(store.washes.find((x) => x.id === w2.id));
    for (const st of ['lavando', 'secado', 'listo']) { await ops.setWashStatus(store.washes.find((x) => x.id === w.id), st); await wait(() => store.washes.find((x) => x.id === w.id)?.status === st); }
    const ready = store.washes.find((x) => x.id === w.id);
    const ws = store.product(ID.wash);
    const s = await ops.chargeSale({ lines: [{ productId: ws.id, name: 'Lavado XYZ 999', pack: 'caja', factor: 1, qty: 1, price: 5, cost: 0, kind: 'servicio' }], washId: w.id, payments: [{ method: 'efectivo', amount: 5 }] });
    await wait(() => store.washes.find((x) => x.id === w.id)?.charged);
    await ops.closeWash(store.washes.find((x) => x.id === w.id), { saleId: s.sale.id });
    await wait(() => !store.washes.some((x) => x.id === w.id));
    return { plate: w.plate, dupW, noType, num: w.number, mins: w2.minutes, eta, log: ready.log.length, readyAt: !!ready.readyAt, left: store.washQueue.length, washId: s.sale.washId === w.id };
  }, ID);
  ok('Lavado de paso por placa: no duplica y exige el tipo', r5.plate === 'XYZ 999' && /ya está en el autolavado/.test(r5.dupW) && /tipo de lavado/.test(r5.noType) && /^L-\d{5}$/.test(r5.num), `${r5.num} · ${r5.dupW}`);
  ok('Tiempo del lavado según los servicios', r5.mins === 55, `${r5.mins} min · espera ~${r5.eta}`);
  ok('Avanza hasta listo, se cobra y se entrega', r5.readyAt && r5.log === 4 && r5.washId && r5.left === 1, `quedan ${r5.left}`);

  // ==================================================================
  console.log('6) Ventas de mostrador, crédito, compras y anulación');
  const r6 = await run(p, async ({ store, ops, tl, wait }, ID) => {
    const line = (id, pack = 'caja', qty = 1) => { const p = store.product(id); const f = tl.packFactor(p, pack); return { productId: p.id, name: p.name, pack, factor: f, qty, price: tl.packPrice(p, pack, store.settings.fractionMarkup), cost: tl.unitCost(p) * f }; };
    const lt = await ops.chargeSale({ lines: [line(ID.oil, 'unidad', 1)], payments: [{ method: 'efectivo', amount: 20 }], sellerId: 'c1' });
    await wait(() => store.product(ID.oil).stock === 15);
    await ops.chargeSale({ lines: [line(ID.filt)], client: { id: ID.owner }, credit: 6, payments: [] });
    const debt = await wait(() => store.client(ID.owner).balance > 0 && store.client(ID.owner).balance);
    await ops.payBalance(store.client(ID.owner), { amount: 6, payments: [{ method: 'efectivo', amount: 6 }] });
    await wait(() => store.client(ID.owner).balance < 0.01);
    let noStock = ''; try { await ops.chargeSale({ lines: [line(ID.pads, 'caja', 5)], payments: [{ method: 'efectivo', amount: 200 }] }); } catch (e) { noStock = e.message; }
    await ops.chargeSale({ lines: [line(ID.pads, 'caja', 1)], payments: [{ method: 'efectivo', amount: 24 }] });
    await wait(() => store.product(ID.pads).stock === 1);
    const sug = ops.suggestedOrder();
    const oc = await ops.createPurchaseOrder({ supplierId: store.suppliers[0].id, items: sug.map((x) => ({ productId: x.p.id, boxes: x.boxes, cost: x.cost })) });
    await ops.payPurchase(store.payables[0], { amount: 60, fromCash: true });
    await wait(() => !store.payables.length);
    const before = store.product(ID.oil).stock;
    await ops.voidSale(lt.sale, 'prueba');
    await wait(() => store.product(ID.oil).stock === before + 1);
    return { ltTotal: lt.sale.total, ltSeller: lt.sale.sellerName, debt, bal: store.client(ID.owner).balance, noStock, sug: sug.map((x) => x.p.name), oc: oc.number, oil: store.product(ID.oil).stock, points: store.client(ID.owner).points || 0 };
  }, ID);
  ok('Aceite suelto por litro con recargo por fraccionar', r6.ltTotal === 11 && r6.ltSeller === 'Caja Uno', `total ${r6.ltTotal}`);
  ok('Venta a crédito y abono del cliente', r6.debt === 6 && r6.bal < 0.01, `${r6.debt} → ${r6.bal}`);
  ok('No deja vender más de lo que hay', /No hay suficiente/.test(r6.noStock), r6.noStock);
  ok('Sugerido y orden de compra; pago al proveedor', r6.sug.length >= 1 && /^OC-\d{5}$/.test(r6.oc), `${r6.oc} · ${r6.sug.join(', ')}`);
  ok('Anular devuelve el producto al inventario', r6.oil === 16, String(r6.oil));
  ok('El cliente acumula puntos', r6.points >= 1, String(r6.points));

  // ==================================================================
  console.log('7) Catálogo de repuestos, ficha pública y pedido desde el teléfono');
  const slug = 'taller-prueba-e2e';
  const r7 = await run(p, async ({ store, ops }, sl) => {
    await store.saveSettings({ shop: { ...store.settings.shop, enabled: true, slug: sl, delivery: true, deliveryFee: 1 } });
    await ops.publishShop({ force: true });
    const d = await (await import('/js/store.js')).getShop(sl);
    return { ok: !!d, items: d?.items?.length, names: (d?.items || []).map((x) => x.n || x.name).join(',') };
  }, slug);
  ok('Catálogo publicado (sin servicios)', r7.ok && r7.items >= 2 && !/mano de obra|Lavado sencillo/.test(r7.names), JSON.stringify(r7).slice(0, 160));
  await pub.goto(`${ORIGIN}/pedido/${slug}?emu=1`, { waitUntil: 'networkidle2' });
  await pub.waitForSelector('[data-inc]', { timeout: 20000 });
  await pub.screenshot({ path: path.join(OUT, '04-catalogo.png') });
  await pub.type('#s-q', 'corolla'); await sleep(500);
  const found = await pub.evaluate(() => document.body.innerText.includes('Filtro de aceite Corolla'));
  await pub.click('[data-inc]'); await sleep(200); await pub.click('[data-inc]'); await sleep(200);
  await pub.click('#s-bar'); await sleep(500);
  await pub.click('[data-mode="delivery"]'); await sleep(200);
  await pub.type('input[name="name"]', 'Cliente Web'); await pub.type('input[name="phone"]', '04261234567'); await pub.type('input[name="address"]', 'Calle 1, casa 2');
  await pub.screenshot({ path: path.join(OUT, '04-checkout.png') });
  await pub.click('#o-send'); await sleep(2500);
  ok('Busca por vehículo compatible y envía el pedido sin cuenta', found && (await pub.evaluate(() => document.body.innerText)).includes('¡Pedido enviado!'));
  await pub.goto(`${ORIGIN}/vehiculo/${r2.code}?emu=1`, { waitUntil: 'networkidle2' });
  await pub.waitForSelector('.mcard', { timeout: 20000 }); await sleep(800);
  const ct = await pub.evaluate(() => document.body.innerText);
  ok('Ficha pública con placa, historial, mantenimiento, garantía y QR', ct.includes('AB 123 CD') && ct.includes('Corolla') && /Cambio de aceite/.test(ct) && /garant/i.test(ct) && !!(await pub.$('.mcard-qr img')), ct.replace(/\s+/g, ' ').slice(0, 140));
  await pub.screenshot({ path: path.join(OUT, '05-ficha.png'), fullPage: true });
  await pub.goto(`${ORIGIN}/vehiculo/NOEXISTE1?emu=1`, { waitUntil: 'networkidle2' }); await sleep(1500);
  ok('Ficha inexistente muestra aviso', /no encontrada/i.test(await pub.evaluate(() => document.body.innerText)));
  await pub.goto(`${ORIGIN}/presupuesto/NOEXISTE1?emu=1`, { waitUntil: 'networkidle2' }); await sleep(1500);
  ok('Presupuesto inexistente muestra aviso', /no encontrado/i.test(await pub.evaluate(() => document.body.innerText)));
  await pub.goto(`${ORIGIN}/presupuesto/${r3.code}?emu=1`, { waitUntil: 'networkidle2' }); await sleep(1500);
  ok('El presupuesto ya respondido no se puede cambiar', !(await pub.$('[data-ok]')) && /aprob/i.test(await pub.evaluate(() => document.body.innerText)));
  const tamper = await pub.evaluate(async (code) => { try { const s = await import('/js/store.js'); await s.decideQuote(code, { decision: 'rechazado', approved: [], signName: 'X', decisionNote: '', decidedAt: new Date().toISOString() }); return 'escribió'; } catch (e) { return e.code || e.message; } }, r3.code);
  ok('Las reglas impiden cambiar una decisión ya tomada', /permission/i.test(tamper), tamper);
  await pub.goto(`${ORIGIN}/pedido/no-existe-nada?emu=1`, { waitUntil: 'networkidle2' }); await sleep(1500);
  ok('Catálogo inexistente muestra aviso', (await pub.evaluate(() => document.body.innerText)).includes('Catálogo no'));
  await pubCtx.close();
  const r8 = await run(p, async ({ store, ops, wait }) => {
    const o = await wait(() => store.newOrders.find((x) => x.name === 'Cliente Web'), 10000);
    if (!o) return { got: false };
    await ops.setOrderStatus(o, 'preparando');
    await wait(() => store.orders.find((x) => x.id === o.id)?.status === 'preparando');
    const lines = ops.orderLines(o);
    const total = lines.reduce((a, l) => a + l.price * l.qty, 0) + (o.deliveryFee || 0);
    await ops.chargeSale({ lines, orderId: o.id, delivery: o.deliveryFee, payments: [{ method: 'efectivo', amount: total }] });
    await wait(() => store.orders.find((x) => x.id === o.id)?.status === 'entregada' || !store.pendingOrders.some((x) => x.id === o.id));
    return { got: true, q: lines[0]?.qty, total: o.total, status: store.orders.find((x) => x.id === o.id)?.status || 'entregada' };
  });
  ok('El taller recibe el pedido en vivo', r8.got);
  ok('Cobrar el pedido lo marca entregado', r8.status === 'entregada' && r8.q === 2 && r8.total === 13, JSON.stringify(r8));

  // ==================================================================
  console.log('8) Pantallas, pestañas, fichas, reportes y consulta de precios');
  const before = errs.length;
  const tabsCount = {};
  for (const v of ['inicio', 'ordenes', 'lavado', 'agenda', 'vehiculos', 'clientes', 'recordatorios', 'vender', 'pedidos', 'inventario', 'compras', 'facturas', 'caja', 'ajustes']) {
    await go(p, v);
    await p.screenshot({ path: path.join(OUT, `10-${v}.png`) });
    const n = await p.$$eval('#view .tabs button', (x) => x.length).catch(() => 0);
    tabsCount[v] = n;
    for (let i = 0; i < n; i++) { await p.evaluate((k) => document.querySelectorAll('#view .tabs button')[k]?.click(), i); await sleep(600); }
  }
  await go(p, 'vender');
  await p.type('#pos-search', 'aceite 5w'); await sleep(700);
  await p.click('#pos-grid .prow'); await sleep(600);
  await p.screenshot({ path: path.join(OUT, '11-presentacion.png') });
  const packs = await p.$$eval('.modal .pack-btn', (x) => x.length);
  await p.click('.modal .pack-btn[data-k="unidad"]'); await sleep(500);
  const cartTxt = await p.evaluate(() => document.querySelector('#c-total')?.textContent || '');
  ok('En Vender elige galón completo o litro suelto', packs === 2 && /11,00/.test(cartTxt), `${packs} · ${cartTxt}`);
  await go(p, 'reportes'); await pin(p); await sleep(2200);
  const rt = await text(p);
  ok('Reportes con PIN muestran ganancia, mecánicos y autolavado', /ganancia/i.test(rt) && rt.includes('Mecánico Uno') && /autolavado/i.test(rt));
  await p.screenshot({ path: path.join(OUT, '10-reportes.png'), fullPage: true });
  await p.evaluate(async (id) => (await import('/js/client.js')).openVehicle(id), ID.veh); await sleep(1500);
  const tabs = await p.$$eval('.modal [data-tabs] [data-t]', (x) => x.map((b) => b.dataset.t));
  let ftxt = '';
  for (const t of tabs) { await p.click(`.modal [data-tabs] [data-t="${t}"]`).catch(() => {}); await sleep(900); await p.screenshot({ path: path.join(OUT, `12-vehiculo-${t}.png`) }); ftxt += await text(p); }
  await p.evaluate(async () => (await import('/js/utils.js')).closeAllModals());
  await p.evaluate(async (id) => (await import('/js/client.js')).openClient(id), ID.owner); await sleep(1200);
  await p.screenshot({ path: path.join(OUT, '12-cliente.png') });
  await p.evaluate(async () => (await import('/js/utils.js')).closeAllModals());
  ok('Todas las pantallas, pestañas y la ficha sin errores', errs.length === before && tabsCount.inventario >= 4 && tabsCount.recordatorios >= 4 && tabs.length >= 5, errs.slice(before).join(' | ') + ' · ' + JSON.stringify(tabsCount) + ` · ficha ${tabs.join(',')}`);
  ok('La ficha del vehículo muestra órdenes y mantenimiento', ftxt.includes(r3.num) && /Cambio de aceite y filtro/.test(ftxt), '');
  await go(p, 'precios'); await sleep(800);
  await p.type('#k-q', '7590000000017'); await p.keyboard.press('Enter'); await sleep(700);
  const kt = await text(p);
  ok('Consulta de precios por código de barras', kt.includes('Aceite 5W-30'), kt.replace(/\s+/g, ' ').slice(0, 80));
  await p.click('#k-exit'); await pin(p); await sleep(800);
  ok('Salir de la consulta de precios con PIN', (await p.evaluate(() => location.hash)).includes('inicio'));
  const r9 = await run(p, async ({ store, ops, wait }) => { const s = store.openShift; const e = ops.shiftExpected(s); await ops.closeShift(s, { countedUSD: e.usd }); return { closed: !!(await wait(() => !store.openShift)), exp: e.usd }; });
  ok('Cierre de caja', r9.closed, `esperado ${r9.exp}`);
  await ctx.close();

  // ==================================================================
  console.log('9) Demo');
  ({ ctx, p } = await newPage());
  await p.goto(BASE, { waitUntil: 'networkidle2' });
  await p.click('#lg-demo');
  await pickCountry(p, 'CO');
  await p.waitForFunction(() => document.body.innerText.includes('Modo demo') && !document.getElementById('boot'), { timeout: 150000 });
  await sleep(5000);
  const d = await run(p, async ({ store }) => ({
    clientes: store.clients.length, vehiculos: store.vehicles.length, products: store.products.length, sales: store.recentSales.length, shift: !!store.openShift, cur: store.settings.currency,
    aceite: store.product('demo_svc_aceite')?.price, orders: store.pendingOrders.length, mant: store.dueMaint.length, revisiones: store.dueControls.length, citas: store.todayAppts.length,
    llego: store.waiting.length, taller: store.jobs.length, listos: store.readyJobs.length, presupuestos: store.pendingQuotes.length, aprobados: store.jobsBy('aprobado').length, lavado: store.washQueue.length,
    low: store.lowProducts.length, payables: store.payables.length, entregadas: (await store.listAll('jobs')).filter((j) => j.status === 'entregado').length, ag: store.activeAgreements.length, quotes: store.quotes.length
  }));
  ok('Demo con taller de ejemplo completo', d.clientes >= 12 && d.vehiculos >= 15 && d.products >= 40 && d.sales >= 30 && d.shift && d.orders >= 3 && d.mant >= 3 && d.revisiones >= 1 && d.citas >= 4 && d.llego >= 1 && d.taller >= 7 && d.listos === 1 && d.lavado === 4 && d.low >= 1 && d.payables >= 2 && d.entregadas >= 15 && d.ag === 3 && d.quotes === 2, JSON.stringify(d));
  ok('El presupuesto aprobado por el cliente en la demo pasa solo a la orden', d.presupuestos === 1 && d.aprobados === 1, `por responder ${d.presupuestos} · aprobados ${d.aprobados}`);
  ok('Precios de la demo en pesos colombianos', d.cur === 'COP' && d.aceite > 1000, String(d.aceite));
  ok('Recorrido guiado abierto al entrar', !!(await p.waitForSelector('.tour-tip', { timeout: 20000 }).catch(() => null)));
  await p.screenshot({ path: path.join(OUT, '20-demo-tour.png') });
  await p.evaluate(async () => (await import('/js/tour.js')).stopTour());
  const b2 = errs.length;
  for (const v of ['inicio', 'ordenes', 'lavado', 'agenda', 'vehiculos', 'clientes', 'recordatorios', 'vender', 'pedidos', 'inventario', 'compras', 'facturas', 'caja']) { await go(p, v); await sleep(500); await p.screenshot({ path: path.join(OUT, `21-demo-${v}.png`) }); }
  await p.evaluate(async () => { const { store } = await import('/js/store.js'); (await import('/js/client.js')).openVehicle(store.vehicles.find((x) => x.model === 'Corolla').id); }); await sleep(1500);
  await p.screenshot({ path: path.join(OUT, '22-demo-corolla.png') });
  await p.evaluate(async () => (await import('/js/utils.js')).closeAllModals());
  await p.evaluate(async () => { const { store } = await import('/js/store.js'); (await import('/js/views/jobs.js')).openJob(store.jobs.find((x) => x.plate === 'AD789GH').id); }); await sleep(1500);
  await p.screenshot({ path: path.join(OUT, '22-demo-orden.png') });
  await p.evaluate(async () => (await import('/js/utils.js')).closeAllModals());
  ok('Pantallas de la demo sin errores', errs.length === b2, errs.slice(b2).join(' | '));
  const codes = await run(p, ({ store }) => store.vehicles.map((m) => m.cardCode));
  const qcodes = await run(p, ({ store }) => store.quotes.map((q) => q.id));
  const dslug = await run(p, ({ store }) => store.settings.shop?.slug);
  const uid = await p.evaluate(async () => (await import('/js/firebase.js')).auth.currentUser.uid);
  await p.evaluate(() => document.getElementById('demo-end').click());
  await p.waitForSelector('.modal [data-yes]'); await p.click('.modal [data-yes]');
  await p.waitForSelector('#login-form', { timeout: 60000 }).catch(async (e) => { await p.screenshot({ path: path.join(OUT, '29-demo-fin.png') }); console.log('LOGS', logs.slice(-15).join(' || ')); throw e; });
  ok('Terminar la demo vuelve al login', true);
  await ctx.close();

  // ==================================================================
  console.log('10) Administrador general');
  ({ ctx, p } = await newPage());
  await p.goto(BASE, { waitUntil: 'networkidle2' });
  await p.waitForSelector('#login-form');
  await p.type('#lg-user', 'admin'); await p.type('#lg-pass', acc.admin.password); await p.click('#lg-btn');
  await p.waitForSelector('[data-enter]', { timeout: 30000 }); await sleep(2000);
  ok('Admin ve las sedes', (await p.$$('[data-enter]')).length === 3);
  await p.screenshot({ path: path.join(OUT, '30-admin.png') });
  const gone = await p.evaluate(async (u, cs, qs, sl) => {
    const f = await import('/js/firebase.js');
    const t = await f.getDoc(f.doc(f.db, 'tenants', u)); const c = await f.getDoc(f.doc(f.db, 'cards', cs[0])); const q = await f.getDoc(f.doc(f.db, 'quotes', qs[0]));
    const b = sl ? await f.getDoc(f.doc(f.db, 'shops', sl)) : null;
    return !t.exists() && !c.exists() && !q.exists() && !(b && b.exists());
  }, uid, codes, qcodes, dslug);
  ok('La demo, sus fichas, presupuestos y catálogo se borraron', gone, String(dslug));
  await ctx.close();
} catch (e) { console.log('ERROR', e.stack || e.message); fails++; }
await browser.close();
console.log('Errores de página:', errs.length ? errs.join(' | ') : 'ninguno');
console.log(`${passed} OK · ${fails} fallas`);
process.exit(fails ? 1 : 0);
