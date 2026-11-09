// =============================================================
// HugoMed - HR: wafanyakazi na mishahara, makato, payroll, likizo, zamu
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.hr = function (page, me) {
  const h = HugoMed.h;
  const canEdit = ['hr_officer', 'hospital_admin'].includes(me.role);
  const SHIFTS = { morning: ['teal', 'Asubuhi'], evening: ['amber', 'Jioni'], night: ['grey', 'Usiku'], oncall: ['green', 'On-call'], off: ['grey', 'Mapumziko'] };
  let tab = 'staff';
  let weekStart = null;

  page.appendChild(h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'HR'), h('p', { class: 'muted' }, 'Wafanyakazi, mishahara, likizo na ratiba za zamu'))));
  const tabs = h('div', { class: 'stage-tabs' });
  page.appendChild(tabs);
  const msg = h('p', { class: 'form-message', role: 'status' });
  page.appendChild(msg);
  const box = h('div', { class: 'stack' });
  page.appendChild(box);

  function renderTabs() {
    tabs.textContent = '';
    [['staff', 'Wafanyakazi na mishahara'], ['payroll', 'Payroll'], ['deductions', 'Makato'], ['leave', 'Likizo'], ['roster', 'Ratiba za zamu']].forEach(([k, l]) =>
      tabs.appendChild(h('button', { type: 'button', class: 'stage-tab' + (tab === k ? ' on' : ''), onclick: () => { tab = k; renderTabs(); load(); } }, l)));
  }
  const ok = (text) => HugoMed.showMessage(msg, text, 'ok');
  const fail = (err) => HugoMed.showMessage(msg, err.message, 'error');

  async function download(url, name) {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + HugoMed.getToken() } });
    const a = h('a', { href: URL.createObjectURL(await res.blob()), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function load() {
    box.textContent = '';
    try {
      if (tab === 'staff') {
        const r = await HugoMed.api('/api/hr/staff');
        box.appendChild(h('section', { class: 'card flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Mfanyakazi'), h('th', {}, 'Idara'), h('th', {}, 'Mshahara wa msingi'), h('th', {}, 'Posho'), h('th', {}, 'Akaunti ya benki'), h('th', {}, ''))),
          h('tbody', {}, r.items.map((u) => {
            const dept = h('input', { value: u.department || '', disabled: !canEdit, 'aria-label': 'Idara ya ' + u.full_name, class: 'code-input' });
            const basic = h('input', { value: u.basic_salary !== null ? String(Number(u.basic_salary)) : '', inputmode: 'numeric', disabled: !canEdit, 'aria-label': 'Mshahara wa ' + u.full_name, class: 'price-input' });
            const allw = h('input', { value: u.allowances !== null ? String(Number(u.allowances)) : '', inputmode: 'numeric', disabled: !canEdit, 'aria-label': 'Posho ya ' + u.full_name, class: 'price-input' });
            const bank = h('input', { value: u.bank_account || '', disabled: !canEdit, 'aria-label': 'Akaunti ya ' + u.full_name, class: 'code-input' });
            return h('tr', { class: u.is_active ? '' : 'inactive' },
              h('td', {}, h('strong', {}, u.full_name), h('div', { class: 'muted small' }, (HugoMed.ROLES[u.role] || u.role) + (u.license_expiry ? ' · leseni ' + HugoMed.date(u.license_expiry) : ''))),
              h('td', {}, dept), h('td', {}, basic), h('td', {}, allw), h('td', {}, bank),
              h('td', { class: 'row-actions' }, canEdit ? h('button', {
                type: 'button', class: 'btn small',
                onclick: () => HugoMed.api('/api/hr/staff/' + u.id, { method: 'PATCH', body: { department: dept.value, basic_salary: basic.value, allowances: allw.value, bank_account: bank.value } })
                  .then(() => ok(u.full_name + ': imehifadhiwa.')).catch(fail)
              }, 'Hifadhi') : null)
            );
          }))
        ))));
        box.appendChild(h('p', { class: 'muted small' }, 'Kuongeza mfanyakazi mpya au kubadilisha kazi yake: ukurasa wa Watumiaji.'));
      } else if (tab === 'deductions') {
        const r = await HugoMed.api('/api/hr/deductions');
        box.appendChild(h('p', { class: 'form-message', style: 'background: #FFFBEB; color: #854D0E; padding: 10px 12px; border-radius: 10px' },
          'Viwango vya makato ya kisheria (PAYE, NSSF, WCF, SDL, HESLB, NHIF n.k.) vinabadilika. Viweke kama vilivyo kwenye sheria ya sasa, na mhasibu wenu avihakiki. PAYE ina madaraja; kwa sasa weka asilimia ya wastani au uihesabu nje ya mfumo.'));
        if (canEdit) {
          const form = h('form', { class: 'card order-row', novalidate: true },
            h('label', {}, 'Jina la kato', h('input', { name: 'name', placeholder: 'Mf. NSSF' })),
            h('label', {}, 'Asilimia ya gross (%)', h('input', { name: 'percent', inputmode: 'decimal', value: '0' })),
            h('label', {}, 'Au kiasi kamili (TSh)', h('input', { name: 'fixed_amount', inputmode: 'numeric', value: '0' })),
            h('button', { type: 'submit', class: 'btn primary' }, '+ Ongeza kato'));
          form.addEventListener('submit', (e) => { e.preventDefault(); HugoMed.api('/api/hr/deductions', { method: 'POST', body: HugoMed.formData(form) }).then(() => { load(); ok('Kato limeongezwa.'); }).catch(fail); });
          box.appendChild(form);
        }
        box.appendChild(h('section', { class: 'card flush' }, r.items.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Kato'), h('th', {}, 'Asilimia'), h('th', {}, 'Kiasi kamili'), h('th', {}, 'Hali'), h('th', {}, ''))),
          h('tbody', {}, r.items.map((d) => h('tr', { class: d.is_active ? '' : 'inactive' },
            h('td', {}, h('strong', {}, d.name)), h('td', {}, Number(d.percent) + '%'), h('td', {}, HugoMed.money(d.fixed_amount)),
            h('td', {}, h('span', { class: 'chip ' + (d.is_active ? 'green' : 'grey') }, d.is_active ? 'Linatumika' : 'Limezimwa')),
            h('td', { class: 'row-actions' }, canEdit ? h('button', { type: 'button', class: 'btn small', onclick: () => HugoMed.api('/api/hr/deductions/' + d.id, { method: 'PATCH', body: { is_active: !d.is_active } }).then(load).catch(fail) }, d.is_active ? 'Zima' : 'Washa') : null)
          )))
        )) : h('p', { class: 'muted pad' }, 'Bado hakuna makato.')));
      } else if (tab === 'payroll') {
        const monthIn = h('input', { type: 'month', value: new Date().toISOString().slice(0, 7), 'aria-label': 'Mwezi' });
        const out = h('section', { class: 'card flush' });
        const show = async () => {
          out.textContent = '';
          try {
            const r = await HugoMed.api('/api/hr/payroll?month=' + monthIn.value);
            if (!r.items.length) { out.appendChild(h('p', { class: 'muted pad' }, 'Hakuna mfanyakazi mwenye mshahara. Weka mishahara kwenye kichupo cha Wafanyakazi.')); return; }
            out.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Mfanyakazi'), h('th', { class: 'num' }, 'Gross'), r.deductions.map((d) => h('th', { class: 'num' }, d.name)), h('th', { class: 'num' }, 'Makato'), h('th', { class: 'num' }, 'Net'), h('th', {}, 'Likizo'))),
              h('tbody', {}, r.items.map((x) => h('tr', {},
                h('td', {}, h('strong', {}, x.full_name), h('div', { class: 'muted small' }, x.bank_account || 'hakuna akaunti')),
                h('td', { class: 'num' }, HugoMed.money(x.gross)), x.deductions.map((d) => h('td', { class: 'num' }, HugoMed.money(d.amount))),
                h('td', { class: 'num' }, HugoMed.money(x.total_deductions)), h('td', { class: 'num' }, h('strong', {}, HugoMed.money(x.net))),
                h('td', {}, x.leave_days ? 'siku ' + x.leave_days : '—')
              )).concat([h('tr', { class: 'total-row' }, h('td', {}, 'Jumla'), h('td', { class: 'num' }, HugoMed.money(r.totals.gross)), r.deductions.map(() => h('td', {})), h('td', { class: 'num' }, HugoMed.money(r.totals.deductions)), h('td', { class: 'num' }, HugoMed.money(r.totals.net)), h('td', {}))]))
            )));
          } catch (err) { out.appendChild(h('p', { class: 'form-message error pad' }, err.message)); }
        };
        box.appendChild(h('div', { class: 'card order-row' }, h('label', {}, 'Mwezi', monthIn),
          h('button', { type: 'button', class: 'btn primary', onclick: show }, 'Onyesha'),
          h('button', { type: 'button', class: 'btn', onclick: () => download('/api/hr/payroll?month=' + monthIn.value + '&format=csv', 'payroll-' + monthIn.value + '.csv') }, 'Pakua CSV (benki / mhasibu)')));
        box.appendChild(out);
        show();
      } else if (tab === 'leave') {
        const [r, staff] = await Promise.all([HugoMed.api('/api/hr/leave'), canEdit ? HugoMed.api('/api/hr/staff') : Promise.resolve({ items: [] })]);
        const form = h('form', { class: 'card', novalidate: true },
          h('h2', {}, canEdit ? 'Andika likizo' : 'Omba likizo'),
          h('div', { class: 'form-grid' },
            canEdit ? h('label', {}, 'Mfanyakazi', h('select', { name: 'user_id' }, staff.items.filter((u) => u.is_active).map((u) => h('option', { value: u.id, selected: u.id === me.id }, u.full_name)))) : null,
            h('label', {}, 'Aina', h('select', { name: 'leave_type' }, ['Likizo ya mwaka', 'Ugonjwa', 'Uzazi', 'Dharura', 'Masomo', 'Nyingine'].map((x) => h('option', { value: x }, x)))),
            h('label', {}, 'Kuanzia', h('input', { type: 'date', name: 'start_date' })),
            h('label', {}, 'Hadi', h('input', { type: 'date', name: 'end_date' })),
            h('label', {}, 'Sababu', h('input', { name: 'reason' }))
          ),
          h('div', { class: 'row-actions' }, h('button', { type: 'submit', class: 'btn primary' }, 'Tuma'))
        );
        form.addEventListener('submit', (e) => { e.preventDefault(); HugoMed.api('/api/hr/leave', { method: 'POST', body: HugoMed.formData(form) }).then((x) => { load(); ok(x.message); }).catch(fail); });
        box.appendChild(form);
        const ST = { pending: ['amber', 'Inasubiri'], approved: ['green', 'Imeidhinishwa'], rejected: ['grey', 'Imekataliwa'] };
        const decide = (id, status) => HugoMed.api('/api/hr/leave/' + id, { method: 'PATCH', body: { status } }).then((x) => { load(); ok(x.message); }).catch(fail);
        box.appendChild(h('section', { class: 'card flush' }, r.items.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data compact' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Mfanyakazi'), h('th', {}, 'Aina'), h('th', {}, 'Tarehe'), h('th', {}, 'Siku'), h('th', {}, 'Hali'), h('th', {}, ''))),
          h('tbody', {}, r.items.map((l) => h('tr', {},
            h('td', {}, l.full_name, l.reason ? h('div', { class: 'muted small' }, l.reason) : null), h('td', {}, l.leave_type),
            h('td', { class: 'small' }, HugoMed.date(l.start_date) + ' – ' + HugoMed.date(l.end_date)), h('td', {}, String(l.days)),
            h('td', {}, h('span', { class: 'chip ' + ST[l.status][0] }, ST[l.status][1]), l.decided_by_name ? h('div', { class: 'muted small' }, l.decided_by_name) : null),
            h('td', { class: 'row-actions' }, canEdit && l.status === 'pending' ? [
              h('button', { type: 'button', class: 'btn small primary', onclick: () => decide(l.id, 'approved') }, 'Idhinisha'),
              h('button', { type: 'button', class: 'btn small danger', onclick: () => decide(l.id, 'rejected') }, 'Kataa')] : null)
          )))
        )) : h('p', { class: 'muted pad' }, 'Hakuna maombi ya likizo.')));
      } else {
        const r = await HugoMed.api('/api/hr/roster' + (weekStart ? '?start=' + weekStart : ''));
        weekStart = r.days[0];
        const shiftWeek = (n) => { const d = new Date(weekStart + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n * 7); weekStart = d.toISOString().slice(0, 10); load(); };
        const dayName = (d) => ['Jtt', 'Jnn', 'Jtn', 'Alh', 'Ijm', 'Jms', 'Jpl'][(new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7] + ' ' + d.slice(8, 10) + '/' + d.slice(5, 7);
        box.appendChild(h('div', { class: 'order-row' },
          h('button', { type: 'button', class: 'btn', onclick: () => shiftWeek(-1) }, '← Wiki iliyopita'),
          h('strong', {}, 'Wiki ya ' + HugoMed.date(r.days[0]) + ' – ' + HugoMed.date(r.days[6])),
          h('button', { type: 'button', class: 'btn', onclick: () => shiftWeek(1) }, 'Wiki ijayo →')));
        box.appendChild(h('section', { class: 'card flush' }, h('div', { class: 'table-wrap' }, h('table', { class: 'data compact roster' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Mfanyakazi'), r.days.map((d) => h('th', {}, dayName(d))))),
          h('tbody', {}, r.items.map((u) => h('tr', {},
            h('td', {}, h('strong', {}, u.full_name), h('div', { class: 'muted small' }, HugoMed.ROLES[u.role] || u.role)),
            u.shifts.map((s) => {
              if (s.leave) return h('td', {}, h('span', { class: 'chip amber' }, 'Likizo'));
              if (!canEdit) return h('td', {}, s.shift ? h('span', { class: 'chip ' + SHIFTS[s.shift][0] }, SHIFTS[s.shift][1]) : '—');
              const sel = h('select', { class: 'compact roster-select', 'aria-label': u.full_name + ' ' + s.date },
                h('option', { value: '' }, '—'), Object.entries(SHIFTS).map(([k, v]) => h('option', { value: k, selected: s.shift === k }, v[1])));
              sel.addEventListener('change', () => HugoMed.api('/api/hr/roster', { method: 'PUT', body: { user_id: u.id, shift_date: s.date, shift: sel.value } }).then(() => ok('Zamu imehifadhiwa.')).catch(fail));
              return h('td', {}, sel);
            })
          )))
        ))));
      }
    } catch (err) {
      box.textContent = '';
      box.appendChild(h('p', { class: 'form-message error' }, err.message));
    }
  }

  renderTabs();
  load();
};
