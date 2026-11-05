// SanoTaller — Ficha pública del vehículo: /vehiculo/CODIGO (sin sesión): estado en el taller, próximo mantenimiento e historial
import { getCard } from '../store.js';
import { esc, fmtDate, todayKey, fromKey, waLink, applyLocale, num } from '../utils.js';
import { icon } from '../icons.js';
import { qrDataURL } from '../shared.js';
import { VTYPES, JOB_STATUS } from '../taller.js';

const days = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);
const STEPS = [['recibido', 'Recibido'], ['diagnostico', 'Diagnóstico'], ['presupuesto', 'Presupuesto'], ['reparacion', 'Reparación'], ['listo', 'Listo']];
const stepOf = (s) => ({ recibido: 0, diagnostico: 1, presupuesto: 2, aprobado: 3, reparacion: 3, repuesto: 3, listo: 4 }[s] ?? 0);

export async function mount(root) {
  document.title = 'Mi vehículo · SanoTaller';
  const code = (/\/vehiculo\/([A-Z0-9]+)/i.exec(location.pathname)?.[1] || '').toUpperCase();
  root.innerHTML = '<div class="pcard-page"><div class="empty"><div class="spinner"></div></div></div>';
  let c = null;
  try { c = code ? await getCard(code) : null; } catch (e) { console.error(e); }
  if (!c) {
    root.innerHTML = `<div class="pcard-page"><div class="mcard mcard-err"><img src="/assets/logo.svg" alt="" width="64"><h1>Ficha no encontrada</h1><p>El código <b>${esc(code || '—')}</b> no existe o fue renovado. Pide el enlace actualizado en tu taller.</p><a class="btn btn-primary" href="/">Ir a SanoTaller</a></div></div>`;
    return;
  }
  try { applyLocale(c.country || 'VE'); } catch (_) {}
  const qr = await qrDataURL(location.origin + '/vehiculo/' + code, 6);
  const t = todayKey();
  const tp = VTYPES[c.type] || VTYPES.carro;
  // Kilometraje estimado hoy
  const est = c.km && c.kmAt ? Math.round(c.km + Math.max(0, days(String(c.kmAt).slice(0, 10), t)) * (Number(c.kmDay) || 35)) : c.km;
  const rank = { late: 0, due: 1, ok: 2 };
  const svc = (c.services || []).map((s) => {
    const d = s.next ? days(t, s.next) : null; const left = s.nextKm && est ? s.nextKm - est : null;
    const late = (d != null && d < 0) || (left != null && left < 0); const soon = !late && ((d != null && d <= 15) || (left != null && left <= 800));
    const txt = [left != null ? (left < 0 ? `pasado ${num(-left, 0)} km` : `faltan ${num(left, 0)} km`) : '', d != null && (left == null || d <= 30) ? (d < 0 ? `vencido hace ${-d} d` : d === 0 ? 'toca hoy' : `en ${d} días`) : ''].filter(Boolean).join(' · ');
    return { ...s, cls: late ? 'late' : soon ? 'due' : 'ok', txt };
  }).sort((a, b) => rank[a.cls] - rank[b.cls]);
  const shop = c.shopSlug ? `/pedido/${encodeURIComponent(c.shopSlug)}` : '';
  const nextUp = svc.filter((x) => x.cls !== 'ok').map((x) => x.name);
  const j = c.job;
  const wa = c.shopPhone ? waLink(c.shopPhone, `Hola, soy ${c.owner || 'el dueño'} del ${[c.brand, c.model].filter(Boolean).join(' ')} placa ${c.plate}. ${j ? `Quería saber cómo va mi vehículo (${j.number}).` : `Quiero agendar${nextUp.length ? `: ${nextUp.slice(0, 3).join(', ')}` : ' una cita'}.`}`) : '';
  const warranty = c.warrantyUntil && c.warrantyUntil >= t;

  root.innerHTML = `<div class="pcard-page">
    <div class="mcard vcard">
      <div class="mcard-top"><img src="/assets/logo.svg" alt=""><div class="grow"><b>${esc(c.shop || 'Mi taller')}</b><small>Ficha del vehículo</small></div>${c.active ? '' : '<span class="mcard-badge tone-neutral">Inactivo</span>'}</div>
      <div class="vcard-pet">${c.photo ? `<img class="vcard-photo" src="${esc(c.photo)}" alt="">` : `<div class="vcard-photo vcard-emoji" style="background:${tp.color}22">${tp.emoji}</div>`}
        <div class="grow" style="min-width:0"><span class="plate plate-lg">${esc(c.plate)}</span><div class="mcard-name">${esc([c.brand, c.model, c.year].filter(Boolean).join(' ') || tp.label)}</div><div class="mcard-num">${esc([c.color, est ? `${num(est, 0)} km${est !== c.km ? ' (aprox.)' : ''}` : '', c.oil].filter(Boolean).join(' · '))}</div></div></div>
      ${j ? `<div class="job-track"><div class="between"><b>${icon('wrench')} En el taller · ${esc(j.number)}</b><span class="badge badge-${JOB_STATUS[j.status]?.tone || 'info'}">${esc(JOB_STATUS[j.status]?.label || '')}</span></div>
        <div class="steps">${STEPS.map(([k, l], i) => `<div class="step ${i < stepOf(j.status) ? 'done' : i === stepOf(j.status) ? 'now' : ''}"><span></span><small>${l}</small></div>`).join('')}</div>
        ${j.promisedAt ? `<div class="small">Fecha estimada de entrega: <b>${fmtDate(j.promisedAt)}</b></div>` : ''}
        ${j.quoteCode ? `<a class="btn btn-primary btn-block mt" href="/presupuesto/${esc(j.quoteCode)}">${icon('file')} Ver y aprobar el presupuesto</a>` : ''}</div>` : ''}
      ${warranty ? `<div class="vcard-next">${icon('shieldCheck')} En garantía hasta el <b>${fmtDate(c.warrantyUntil)}</b>${c.warrantyKm ? ` o los <b>${num(c.warrantyKm, 0)} km</b>` : ''}${c.warrantyJob ? ` (${esc(c.warrantyJob)})` : ''}</div>` : ''}
      <div class="mcard-meds"><b>${icon('droplet')} Mantenimiento</b>${svc.length ? svc.map((s) => `<div class="mcard-med ${s.cls}"><div class="grow"><b>${esc(s.name)}</b><small>Último ${fmtDate(s.date)}${s.km ? ` · ${num(s.km, 0)} km` : ''}</small></div><span>${s.txt || '—'}<small>${[s.nextKm ? num(s.nextKm, 0) + ' km' : '', s.next ? fmtDate(s.next) : ''].filter(Boolean).join(' o ')}</small></span></div>`).join('') : '<p>Aún no hay servicios registrados.</p>'}</div>
      ${c.nextControl && c.nextControl >= t ? `<div class="vcard-next">${icon('calendar')} Próxima revisión: <b>${fmtDate(c.nextControl)}</b></div>` : ''}
      ${(c.history || []).length ? `<details class="vcard-hist" open><summary>Historial de servicios (${c.history.length})</summary>${c.history.map((h) => `<div class="hist-row"><div class="between small"><b>${esc(h.type || 'Servicio')}</b><span>${fmtDate(h.date)}</span></div><div class="t-sub">${esc(h.work || '')}${h.km ? ` · ${num(h.km, 0)} km` : ''} · ${esc(h.number || '')}</div></div>`).join('')}</details>` : ''}
      <div class="mcard-qr"><img src="${qr}" alt="QR de la ficha"></div>
      <p class="mcard-hint">Muestra este código en el taller para abrir la ficha de tu vehículo.</p>
      <div class="mcard-foot">${wa ? `<a class="btn btn-whatsapp btn-sm" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp')} ${j ? 'Preguntar por mi vehículo' : 'Agendar cita'}</a>` : ''}${shop ? `<a class="btn btn-primary btn-sm" href="${shop}">${icon('bag')} Pedir repuestos</a>` : ''}${c.instagram ? `<a class="btn btn-secondary btn-sm" href="https://instagram.com/${esc(c.instagram.replace('@', ''))}" target="_blank" rel="noopener">${esc(c.instagram)}</a>` : ''}${c.shopAddress ? `<small>${icon('pin')} ${esc(c.shopAddress)}</small>` : ''}</div>
    </div>
    <p class="pcard-by">Hecho con <b>SanoTaller</b> · Agrega esta página a tu pantalla de inicio para tener la ficha siempre a mano.</p>
  </div>`;
}
