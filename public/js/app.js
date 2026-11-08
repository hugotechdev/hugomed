// =============================================================
// HugoMed - msaidizi wa pamoja (inatumika na skrini zote)
// =============================================================

const HugoMed = {
  // Kuita API ya server. Inaongeza token ya login (kuanzia Hatua 2).
  async api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('hugomed_token');
    if (token) headers.Authorization = 'Bearer ' + token;

    let res;
    try {
      res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (e) {
      const err = new Error('Hakuna mawasiliano na server. Angalia mtandao.');
      err.status = 0;
      throw err;
    }

    let data = {};
    try { data = await res.json(); } catch (e) { /* jibu si JSON */ }

    if (!res.ok) {
      const err = new Error(data.message || 'Kuna tatizo (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  },

  // Kubadilisha rangi na maandishi ya chip
  setChip(el, color, text) {
    el.className = 'chip ' + color;
    el.textContent = text;
  },

  // Kuandika pesa kwa mtindo wa TSh 29,200
  money(amount) {
    return 'TSh ' + Number(amount || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
};
