// =============================================================
// HugoMed - Triage
// Foleni ya wanaosubiri triage -> vitals (na tahadhari) -> kwa daktari
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.triage = function (page) {
  const h = HugoMed.h;
  let doctors = [];
  let selectedId = null;

  page.appendChild(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Triage'), h('p', { class: 'muted' }, 'Vipimo vya awali kabla ya kumwona daktari')),
    h('button', { type: 'button', class: 'btn', onclick: () => loadQueue() }, 'Onyesha upya')
  ));

  const layout = h('div', { class: 'split' });
  page.appendChild(layout);
  const queueBox = h('aside', { class: 'card queue-list' });
  const formBox = h('section', { class: 'card' }, h('p', { class: 'muted' }, 'Chagua mgonjwa kwenye foleni.'));
  layout.appendChild(queueBox);
  layout.appendChild(formBox);

  // ---------- Foleni ----------
  async function loadQueue() {
    queueBox.textContent = '';
    queueBox.appendChild(h('h2', {}, 'Wanaosubiri triage'));
    try {
      const res = await HugoMed.api('/api/visits?stage=triage');
      if (!res.items.length) {
        queueBox.appendChild(h('p', { class: 'muted' }, 'Hakuna anayesubiri sasa.'));
        return;
      }
      res.items.forEach((v) => {
        queueBox.appendChild(h('button', {
          type: 'button',
          class: 'queue-item' + (v.id === selectedId ? ' on' : ''),
          onclick: () => openVisit(v.id)
        },
          h('div', { class: 'queue-top' }, h('strong', {}, v.token), HugoMed.priorityChip(v.priority), HugoMed.waitChip(v.waiting_minutes)),
          h('div', {}, HugoMed.patientName(v)),
          h('div', { class: 'muted small' }, [HugoMed.sexLabel(v.sex), HugoMed.age(v.date_of_birth), v.department, v.payer_name].filter(Boolean).join(' · '))
        ));
      });
    } catch (err) {
      queueBox.appendChild(h('p', { class: 'form-message error' }, err.message));
    }
  }

  // ---------- Tahadhari za vitals ----------
  function alerts(d) {
    const out = [];
    const t = Number(d.temperature_c), s = Number(d.bp_systolic), di = Number(d.bp_diastolic);
    const pu = Number(d.pulse), o = Number(d.spo2);
    if (d.temperature_c && t >= 38) out.push(['amber', 'Homa: ' + t + '°C']);
    if (d.temperature_c && t < 35.5) out.push(['amber', 'Joto la chini: ' + t + '°C']);
    if (d.bp_systolic && (s >= 140 || di >= 90)) out.push([s >= 180 || di >= 110 ? 'red' : 'amber', 'BP juu: ' + s + '/' + (di || '?')]);
    if (d.bp_systolic && s < 90) out.push(['red', 'BP chini: ' + s + '/' + (di || '?')]);
    if (d.pulse && pu > 100) out.push(['amber', 'Pulse juu: ' + pu]);
    if (d.pulse && pu < 50) out.push(['amber', 'Pulse chini: ' + pu]);
    if (d.spo2 && o < 94) out.push([o < 90 ? 'red' : 'amber', 'SpO2 chini: ' + o + '%']);
    return out;
  }

  function bmi(d) {
    const w = Number(d.weight_kg), ht = Number(d.height_cm) / 100;
    if (!w || !ht) return null;
    return (w / (ht * ht)).toFixed(1);
  }

  // ---------- Fomu ya vitals ----------
  async function openVisit(id) {
    selectedId = id;
    loadQueue();
    formBox.textContent = '';
    formBox.appendChild(h('p', { class: 'muted' }, 'Inapakia...'));
    let res;
    try {
      res = await HugoMed.api('/api/visits/' + id);
    } catch (err) {
      formBox.textContent = '';
      formBox.appendChild(h('p', { class: 'form-message error' }, err.message));
      return;
    }
    const v = res.visit;
    formBox.textContent = '';

    formBox.appendChild(h('div', { class: 'patient-banner flat' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, (v.first_name[0] || '') + (v.last_name[0] || '')),
      h('div', { style: 'flex: 1 1 auto' },
        h('div', { class: 'banner-name' }, HugoMed.patientName(v) + ' · ' + v.token),
        h('div', { class: 'muted small' }, ['MRN ' + v.mrn, HugoMed.sexLabel(v.sex), HugoMed.age(v.date_of_birth), v.payer_name || 'Cash'].filter(Boolean).join(' · '))
      ),
      v.allergies ? h('span', { class: 'chip red' }, 'Mzio: ' + v.allergies) : null
    ));

    const live = h('div', { class: 'chip-row' });
    const msg = h('p', { class: 'form-message', role: 'alert' });
    const doctorSelect = h('select', { name: 'assigned_doctor_id' },
      h('option', { value: '' }, 'Daktari yeyote wa idara'),
      doctors.map((d) => h('option', { value: d.id, selected: d.id === v.assigned_doctor_id }, d.full_name))
    );

    const form = h('form', { class: 'stack', novalidate: true },
      h('label', {}, 'Malalamiko makuu', h('input', { name: 'complaint', placeholder: 'Mf. homa na maumivu ya kichwa kwa siku 2' })),
      h('div', { class: 'form-grid vitals-grid' },
        h('label', {}, 'Joto (°C)', h('input', { name: 'temperature_c', inputmode: 'decimal' })),
        h('label', {}, 'BP juu (systolic)', h('input', { name: 'bp_systolic', inputmode: 'numeric' })),
        h('label', {}, 'BP chini (diastolic)', h('input', { name: 'bp_diastolic', inputmode: 'numeric' })),
        h('label', {}, 'Pulse (kwa dakika)', h('input', { name: 'pulse', inputmode: 'numeric' })),
        h('label', {}, 'SpO2 (%)', h('input', { name: 'spo2', inputmode: 'numeric' })),
        h('label', {}, 'Uzito (kg)', h('input', { name: 'weight_kg', inputmode: 'decimal' })),
        h('label', {}, 'Urefu (cm)', h('input', { name: 'height_cm', inputmode: 'decimal' }))
      ),
      live,
      h('div', { class: 'form-grid' },
        h('label', {}, 'Mzio (allergies)', h('input', { name: 'allergies', value: v.allergies || '' })),
        h('label', {}, 'Magonjwa sugu', h('input', { name: 'chronic_conditions', value: v.chronic_conditions || '', placeholder: 'Mf. kisukari, presha' }))
      ),
      h('div', { class: 'form-grid' },
        h('label', {}, 'Idara', h('select', { name: 'department' }, HugoMed.DEPARTMENTS.map((d) => h('option', { value: d, selected: d === v.department }, d)))),
        h('label', {}, 'Daktari', doctorSelect),
        h('label', {}, 'Kipaumbele', h('select', { name: 'priority' },
          Object.entries(HugoMed.PRIORITIES).map(([k, p]) => h('option', { value: k, selected: k === v.priority }, p[1]))
        ))
      ),
      msg,
      h('div', { class: 'row-actions' },
        h('button', { type: 'submit', class: 'btn primary' }, 'Hifadhi na peleka kwa daktari →')
      )
    );
    formBox.appendChild(form);

    // Tahadhari zinabadilika unapoandika
    form.addEventListener('input', () => {
      const d = HugoMed.formData(form);
      live.textContent = '';
      const b = bmi(d);
      if (b) live.appendChild(h('span', { class: 'chip grey' }, 'BMI ' + b));
      alerts(d).forEach(([c, t]) => live.appendChild(h('span', { class: 'chip ' + c }, t)));
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = HugoMed.formData(form);
      body.assigned_doctor_id = body.assigned_doctor_id ? Number(body.assigned_doctor_id) : null;
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const r = await HugoMed.api('/api/visits/' + v.id + '/vitals', { method: 'POST', body });
        selectedId = null;
        formBox.textContent = '';
        formBox.appendChild(h('p', { class: 'form-message ok' }, v.token + ' · ' + HugoMed.patientName(v) + ': ' + r.message));
        loadQueue();
      } catch (err) {
        HugoMed.showMessage(msg, err.message, 'error');
        btn.disabled = false;
      }
    });

    form.querySelector('input[name=temperature_c]').focus();
  }

  HugoMed.api('/api/visits/meta/doctors').then((r) => { doctors = r.items; }).catch(() => {});
  loadQueue();
};
