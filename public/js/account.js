// =============================================================
// HugoMed - Akaunti yangu: taarifa zangu na kubadili password
// =============================================================

window.HugoMedPages = window.HugoMedPages || {};

window.HugoMedPages.account = function (page, me) {
  const h = HugoMed.h;

  page.appendChild(h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Akaunti yangu'), h('p', { class: 'muted' }, me.email))
  ));

  page.appendChild(h('section', { class: 'card' },
    h('h2', {}, 'Taarifa zangu'),
    h('dl', { class: 'details' },
      h('dt', {}, 'Jina'), h('dd', {}, me.full_name),
      h('dt', {}, 'Kazi'), h('dd', {}, HugoMed.ROLES[me.role] || me.role),
      h('dt', {}, 'Hospitali'), h('dd', {}, me.tenant_name || 'HUGO TECH'),
      h('dt', {}, 'Simu'), h('dd', {}, me.phone || '—'),
      h('dt', {}, 'Namba ya usajili'), h('dd', {}, me.professional_reg_no || '—'),
      h('dt', {}, 'Leseni inaisha'), h('dd', {}, HugoMed.date(me.license_expiry))
    )
  ));

  const msg = h('p', { class: 'form-message', role: 'alert' });
  const form = h('form', { class: 'card', style: 'margin-top: 20px', novalidate: true },
    h('h2', {}, 'Badili password'),
    h('div', { class: 'form-grid' },
      h('label', {}, 'Password ya sasa', h('input', { type: 'password', name: 'current_password', autocomplete: 'current-password', required: true })),
      h('label', {}, 'Password mpya (herufi 8+, na namba)', h('input', { type: 'password', name: 'new_password', autocomplete: 'new-password', required: true })),
      h('label', {}, 'Rudia password mpya', h('input', { type: 'password', name: 'confirm', autocomplete: 'new-password', required: true }))
    ),
    msg,
    h('div', { class: 'row-actions' }, h('button', { type: 'submit', class: 'btn primary' }, 'Badili password'))
  );
  page.appendChild(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = HugoMed.formData(form);
    if (data.new_password !== data.confirm) {
      HugoMed.showMessage(msg, 'Password mpya hazifanani.', 'error');
      return;
    }
    try {
      await HugoMed.api('/api/auth/change-password', {
        method: 'POST',
        body: { current_password: data.current_password, new_password: data.new_password }
      });
      HugoMed.showMessage(msg, 'Password imebadilishwa.', 'ok');
      form.reset();
    } catch (err) {
      HugoMed.showMessage(msg, err.message, 'error');
    }
  });
};
