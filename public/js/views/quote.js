// SanoTaller — Presupuesto público: /presupuesto/CODIGO (sin sesión). El cliente ve cada trabajo y lo aprueba todo o en parte.
import { getQuote, decideQuote } from '../store.js';
import { esc, fmtDate, fmtDateTime, waLink, applyLocale, num, usd } from '../utils.js';
import { icon } from '../icons.js';

const KIND = { mano: 'Mano de obra', repuesto: 'Repuesto', externo: 'Repuesto', servicio: 'Servicio' };

export async function mount(root) {
  document.title = 'Presupuesto · SanoTaller';
  const code = (/\/presupuesto\/([A-Z0-9]+)/i.exec(location.pathname)?.[1] || '').toUpperCase();
  root.innerHTML = '<div class="pcard-page"><div class="empty"><div class="spinner"></div></div></div>';
  let q = null;
  try { q = code ? await getQuote(code) : null; } catch (e) { console.error(e); }
  if (!q) {
    root.innerHTML = `<div class="pcard-page"><div class="mcard mcard-err"><img src="/assets/logo.svg" alt="" width="64"><h1>Presupuesto no encontrado</h1><p>El código <b>${esc(code || '—')}</b> no existe. Pide el enlace de nuevo a tu taller.</p><a class="btn btn-primary" href="/">Ir a SanoTaller</a></div></div>`;
    return;
  }
  try { applyLocale(q.country || 'VE'); } catch (_) {}
  const sel = new Set((q.lines || []).map((l) => l.i));
  const eq = (v) => (q.fx ? `${q.fx.sym} ${num(v * q.fx.rate, 2)}` : '');
  const draw = () => {
    const decided = q.decision === 'aprobado' || q.decision === 'rechazado';
    const tot = (q.lines || []).filter((l) => (decided ? (q.decision === 'aprobado' && (q.approved || []).includes(l.i)) : sel.has(l.i))).reduce((a, l) => a + (Number(l.total) || 0), 0);
    const wa = q.shopPhone ? waLink(q.shopPhone, `Hola, soy ${q.owner || 'el cliente'} (${q.plate}). Tengo una pregunta sobre el presupuesto ${q.number}.`) : '';
    root.innerHTML = `<div class="pcard-page">
      <div class="mcard vcard quote-card">
        <div class="mcard-top"><img src="/assets/logo.svg" alt=""><div class="grow"><b>${esc(q.shop || 'Taller')}</b><small>Presupuesto ${esc(q.number)}</small></div></div>
        <div class="vcard-pet"><div class="grow" style="min-width:0"><span class="plate plate-lg">${esc(q.plate)}</span><div class="mcard-name">${esc(q.vehicle || '')}</div><div class="mcard-num">${q.owner ? `Para ${esc(q.owner)} · ` : ''}${fmtDate(q.sentAt)}${q.km ? ` · ${num(q.km, 0)} km` : ''}</div></div></div>
        ${q.complaint ? `<div class="small"><b>Lo que pediste:</b> ${esc(q.complaint)}</div>` : ''}
        ${q.diagnosis ? `<div class="small mt-xs"><b>Lo que encontramos:</b> ${esc(q.diagnosis)}</div>` : ''}
        ${decided ? `<div class="quote-done ${q.decision}">${icon(q.decision === 'aprobado' ? 'checkCircle' : 'x')} ${q.decision === 'aprobado' ? 'Aprobaste este presupuesto' : 'Rechazaste este presupuesto'}${q.decidedAt ? ` el ${fmtDateTime(q.decidedAt)}` : ''}. ${q.decision === 'aprobado' ? '¡Ya nos ponemos manos a la obra!' : 'Puedes retirar tu vehículo o escribirnos.'}</div>` : `<p class="small muted mt">Desmarca lo que no quieras hacer por ahora y toca <b>Aprobar</b>.</p>`}
        <div class="quote-lines">${(q.lines || []).map((l) => { const on = decided ? q.decision === 'aprobado' && (q.approved || []).includes(l.i) : sel.has(l.i); return `<label class="quote-line ${on ? '' : 'off'}">${decided ? `<span class="ql-check">${on ? icon('check') : icon('x')}</span>` : `<input type="checkbox" data-i="${l.i}" ${on ? 'checked' : ''}>`}<div class="grow" style="min-width:0"><b>${esc(l.name)}</b><small>${KIND[l.kind] || ''}${l.qty !== 1 ? ` · ${num(l.qty, l.qty % 1 ? 1 : 0)} × ${usd(l.price)}` : ''}</small></div><b class="num">${usd(l.total)}</b></label>`; }).join('')}</div>
        <div class="quote-total"><span>${decided ? 'Total aprobado' : 'Total a aprobar'}</span><b>${usd(tot)}</b>${eq(tot) ? `<small>${eq(tot)}</small>` : ''}</div>
        ${q.iva ? `<p class="small muted">Incluye impuestos (${num(q.iva, 0)}%).</p>` : ''}
        ${q.recommendations ? `<div class="small mt"><b>Recomendaciones:</b> ${esc(q.recommendations)}</div>` : ''}
        ${decided ? '' : `<div class="field mt"><label>Tu nombre (como firma)</label><input class="input" data-sign value="${esc(q.owner || '')}"></div><div class="field"><label>Comentario (opcional)</label><input class="input" data-note placeholder="Ej.: llámenme antes de cambiar la correa"></div>
          <div class="error-msg" data-err></div>
          <div class="row mt" style="gap:8px"><button class="btn btn-ghost text-danger" data-no>${icon('x')} Rechazar</button><button class="btn btn-primary btn-lg grow" data-ok ${sel.size ? '' : 'disabled'}>${icon('check')} Aprobar ${sel.size < (q.lines || []).length ? `${sel.size} de ${(q.lines || []).length}` : 'todo'}</button></div>`}
        <p class="small muted mt">${esc(q.note || '')}${q.warrantyDays ? ` Garantía de ${q.warrantyDays} días.` : ''}${q.promisedAt ? ` Entrega estimada: ${fmtDate(q.promisedAt)}.` : ''}</p>
        <div class="mcard-foot">${wa ? `<a class="btn btn-whatsapp btn-sm" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp')} Preguntar al taller</a>` : ''}${q.shopAddress ? `<small>${icon('pin')} ${esc(q.shopAddress)}</small>` : ''}</div>
      </div>
      <p class="pcard-by">Hecho con <b>SanoTaller</b></p></div>`;
    if (decided) return;
    root.querySelectorAll('[data-i]').forEach((c) => c.onchange = () => { c.checked ? sel.add(+c.dataset.i) : sel.delete(+c.dataset.i); const keep = { sign: root.querySelector('[data-sign]').value, note: root.querySelector('[data-note]').value }; draw(); root.querySelector('[data-sign]').value = keep.sign; root.querySelector('[data-note]').value = keep.note; });
    const send = async (decision, btn) => {
      const sign = root.querySelector('[data-sign]').value.trim();
      if (!sign) { root.querySelector('[data-err]').textContent = 'Escribe tu nombre para confirmar.'; return; }
      btn.disabled = true; btn.textContent = 'Enviando…';
      const data = { decision, approved: decision === 'aprobado' ? [...sel] : [], signName: sign.slice(0, 80), decisionNote: root.querySelector('[data-note]').value.trim().slice(0, 300), decidedAt: new Date().toISOString() };
      try { await decideQuote(code, data); Object.assign(q, data); draw(); }
      catch (e) { console.error(e); root.querySelector('[data-err]').textContent = 'No se pudo enviar. Revisa tu conexión e inténtalo de nuevo, o escríbele al taller.'; btn.disabled = false; btn.textContent = 'Reintentar'; }
    };
    root.querySelector('[data-ok]').onclick = (e) => send('aprobado', e.currentTarget);
    root.querySelector('[data-no]').onclick = (e) => { if (confirm('¿Seguro que no quieres hacer ninguno de estos trabajos?')) send('rechazado', e.currentTarget); };
  };
  draw();
}
