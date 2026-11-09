// =============================================================
// HugoMed - Pharmacy: kutoa dawa kwa mgonjwa
// Batch inayoisha mapema inatolewa kwanza; stock inapungua yenyewe.
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.pharmacy = function (page, me) {
  const h = HugoMed.h;
  const canAct = ['pharmacist', 'hospital_admin'].includes(me.role);
  const root = h('div');
  page.appendChild(root);

  async function showQueue(flashText) {
    root.textContent = '';
    root.appendChild(h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Pharmacy'), h('p', { class: 'muted' }, 'Wagonjwa waliolipa na wagonjwa waliolazwa wenye dawa za kutolewa')),
      h('div', { class: 'row-actions' }, h('a', { class: 'btn', href: '#/stock' }, 'Stock'), h('button', { type: 'button', class: 'btn', onclick: () => showQueue() }, 'Onyesha upya'))
    ));
    if (flashText) root.appendChild(h('p', { class: 'form-message ok' }, flashText));
    try {
      const r = await HugoMed.api('/api/pharmacy/queue');
      const sec = h('section', { class: 'card' });
      root.appendChild(sec);
      if (!r.items.length) { sec.appendChild(h('p', { class: 'muted', style: 'margin: 0' }, 'Hakuna anayesubiri dawa.')); return; }
      const grid = h('div', { class: 'queue-grid' });
      r.items.forEach((v) => grid.appendChild(h('button', { type: 'button', class: 'queue-item', onclick: () => openVisit(v.id) },
        h('div', { class: 'queue-top' }, h('strong', {}, v.token), v.stage === 'admitted' ? h('span', { class: 'chip teal' }, 'Amelazwa') : null, h('span', { class: 'chip amber' }, 'Dawa ' + v.pending)),
        h('div', {}, HugoMed.patientName(v)),
        h('div', { class: 'muted small' }, 'MRN ' + v.mrn + ' · ' + (v.payer_name || 'Cash')),
        v.allergies ? h('div', {}, h('span', { class: 'chip red' }, 'Mzio: ' + v.allergies)) : null
      )));
      sec.appendChild(grid);
    } catch (err) {
      root.appendChild(h('p', { class: 'form-message error' }, err.message));
    }
  }

  async function openVisit(id, flashText, flashType) {
    root.textContent = '';
    let d;
    try { d = await HugoMed.api('/api/pharmacy/visits/' + id); }
    catch (err) { root.appendChild(h('p', { class: 'form-message error' }, err.message)); return; }
    const v = d.visit;

    root.appendChild(h('div', { class: 'page-head' },
      h('button', { type: 'button', class: 'btn', onclick: () => showQueue() }, '← Foleni ya pharmacy'),
      HugoMed.stageChip(v.stage)
    ));
    const flash = h('p', { class: 'form-message' + (flashText ? ' ' + (flashType || 'ok') : ''), role: 'status' }, flashText || '');
    root.appendChild(flash);

    root.appendChild(h('section', { class: 'card patient-banner' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, (v.first_name[0] || '') + (v.last_name[0] || '')),
      h('div', { style: 'flex: 1 1 auto' },
        h('div', { class: 'banner-name' }, HugoMed.patientName(v) + ' · ' + v.token),
        h('div', { class: 'muted small' }, ['MRN ' + v.mrn, HugoMed.sexLabel(v.sex), HugoMed.age(v.date_of_birth), v.payer_name || 'Cash'].filter(Boolean).join(' · '))
      ),
      v.allergies ? h('span', { class: 'chip red' }, 'Mzio: ' + v.allergies) : null,
      d.balance < 0 ? h('span', { class: 'chip amber' }, 'Arudishiwe ' + HugoMed.money(-d.balance) + ' na cashier') : null
    ));

    async function act(url, body) {
      try {
        const r = await HugoMed.api(url, { method: 'POST', body: body || {} });
        openVisit(v.id, r.message, 'ok');
      } catch (err) { openVisit(v.id, err.message, 'error'); }
    }

    const sec = h('section', { class: 'card flush', style: 'margin-top: 16px' });
    root.appendChild(sec);
    sec.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Dawa'), h('th', {}, 'Maelekezo'), h('th', {}, 'Idadi'), h('th', {}, 'Stock'), h('th', {}, 'Hali'), h('th', {}, ''))),
      h('tbody', {}, d.orders.map((o) => {
        const pending = ['ordered', 'paid', 'in_progress'].includes(o.status);
        const enough = o.in_stock >= Number(o.quantity);
        const label = o.dose_units ? Number(o.dose_units) + ' ' + (o.unit || '') + ' mara ' + (o.frequency_per_day || '?') + ' kwa siku, siku ' + (o.days || '?') : '';
        return h('tr', { class: o.status === 'cancelled' ? 'inactive' : '' },
          h('td', {}, h('strong', {}, o.name), h('div', { class: 'muted small' }, 'Dkt: ' + (o.doctor_name || '—'))),
          h('td', { class: 'small' }, label, o.instructions ? h('div', { class: 'muted' }, o.instructions) : null),
          h('td', {}, String(Number(o.quantity))),
          h('td', {}, pending ? h('span', { class: 'chip ' + (enough ? 'green' : 'red') }, Number(o.in_stock) + (o.next_batch ? ' · ' + o.next_batch.batch_no : '')) : '—'),
          h('td', {}, o.status === 'done'
            ? h('span', { class: 'chip green' }, 'Imetolewa ' + o.dispensed.map((x) => x.batch + '×' + Number(x.quantity)).join(', '))
            : o.status === 'cancelled' ? h('span', { class: 'chip grey' }, 'Haikutolewa') : h('span', { class: 'chip amber' }, 'Inasubiri')),
          h('td', { class: 'row-actions' }, canAct && pending ? [
            h('button', { type: 'button', class: 'btn small primary', disabled: !enough, onclick: () => act('/api/pharmacy/orders/' + o.id + '/dispense') }, 'Toa'),
            h('button', { type: 'button', class: 'btn small danger', onclick: () => { if (window.confirm(o.name + ' haipo stock? Itaondolewa kwenye bili.')) act('/api/pharmacy/orders/' + o.id + '/unavailable', { note: 'Haipo stock' }); } }, 'Haipo')
          ] : null)
        );
      }))
    )));

    // Lebo ya maelekezo kwa Kiswahili
    const given = d.orders.filter((o) => o.status === 'done');
    const actions = h('div', { class: 'row-actions pad' });
    if (given.length) {
      actions.appendChild(h('button', {
        type: 'button', class: 'btn',
        onclick: () => {
          const slip = document.getElementById('print-slip') || document.body.appendChild(h('div', { id: 'print-slip' }));
          slip.textContent = '';
          slip.appendChild(h('div', { class: 'slip-hosp' }, me.tenant_name || 'HugoMed'));
          slip.appendChild(h('div', {}, HugoMed.patientName(v) + ' · ' + HugoMed.date(new Date())));
          given.forEach((o) => slip.appendChild(h('div', { class: 'slip-line' }, o.name + ' (' + Number(o.quantity) + ')',
            h('div', {}, o.dose_units ? 'Meza ' + Number(o.dose_units) + ' mara ' + o.frequency_per_day + ' kwa siku kwa siku ' + o.days + '.' : ''),
            o.instructions ? h('div', {}, o.instructions) : null)));
          slip.appendChild(h('div', { class: 'slip-note' }, 'Maliza dozi yote. Rudi hospitali ukizidiwa.'));
          window.print();
        }
      }, 'Chapisha lebo za dawa'));
    }
    if (canAct && v.stage === 'pharmacy') {
      const pending = d.orders.some((o) => ['ordered', 'paid', 'in_progress'].includes(o.status));
      actions.appendChild(h('button', {
        type: 'button', class: 'btn primary', disabled: pending,
        onclick: async () => {
          try {
            const r = await HugoMed.api('/api/pharmacy/visits/' + v.id + '/complete', { method: 'POST', body: {} });
            showQueue(v.token + ': ' + r.message);
          } catch (err) { openVisit(v.id, err.message, 'error'); }
        }
      }, 'Maliza ziara →'));
    }
    sec.appendChild(actions);
  }

  showQueue();
};
