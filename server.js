// =============================================================
// HugoMed - server kuu
// Inaanzisha server, inaunda majedwali ya database (kama hayapo)
// na inaunganisha sehemu zote za mfumo (routes).
// =============================================================

const path = require('path');
const express = require('express');
const db = require('./server/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway iko nyuma ya proxy: hii inahakikisha IP halisi ya mtumiaji inarekodiwa
app.set('trust proxy', 1);

// Kusoma JSON inayotumwa na browser
app.use(express.json({ limit: '2mb' }));

// Ulinzi wa msingi kwenye kila jibu
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Kurasa za mfumo (public/index.html, css/, js/)
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// API: kuangalia kama mfumo na database viko hai
// -------------------------------------------------------------
app.get('/api/health', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW() AS time');
    const tables = await db.query(
      "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'"
    );
    res.json({
      status: 'ok',
      app: 'HugoMed',
      version: '1.0.0',
      database: 'connected',
      tables: tables.rows[0].count,
      time: result.rows[0].time
    });
  } catch (err) {
    console.error('Health check imeshindwa:', err.code || '', err.message);
    res.status(500).json({
      status: 'error',
      app: 'HugoMed',
      database: 'not connected',
      code: err.code || null,
      message: explainDbError(err)
    });
  }
});

// Inaeleza kwa Kiswahili kwa nini database haipatikani
function explainDbError(err) {
  const msg = String(err.message || '');
  if (!process.env.DATABASE_URL) {
    return 'DATABASE_URL haijawekwa kwenye service ya hugomed. Iweke kwenye Variables, kisha bofya Deploy.';
  }
  if (msg.includes('${{')) {
    return 'DATABASE_URL ina maandishi ${{...}} ambayo Railway haikuyabadilisha. Jina la service ya database si "Postgres". Chagua DATABASE_URL kwa "Add Reference" badala ya kuiandika.';
  }
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
    return 'Server haipati anwani ya database (' + err.code + '). Hakikisha database iko kwenye project hiyo hiyo na environment ileile.';
  }
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    return 'Database imekataa au imechelewa kujibu (' + err.code + '). Angalia kama service ya Postgres iko hai (kijani).';
  }
  if (err.code === '28P01') {
    return 'Password ya database si sahihi (28P01). Weka DATABASE_URL upya kwa "Add Reference".';
  }
  if (msg.toLowerCase().includes('ssl')) {
    return 'Tatizo la SSL: ' + msg + '. Kama unatumia DATABASE_PUBLIC_URL, weka DATABASE_SSL=true.';
  }
  if (msg.toLowerCase().includes('invalid url') || err.code === 'ERR_INVALID_URL') {
    return 'DATABASE_URL imeandikwa vibaya. Iweke upya kwa "Add Reference".';
  }
  return 'Database haipatikani: ' + (err.code ? err.code + ' - ' : '') + msg;
}

// -------------------------------------------------------------
// Sehemu za mfumo
// -------------------------------------------------------------
app.use('/api/auth', require('./server/auth'));          // Hatua 2: login
app.use('/api/tenants', require('./server/tenants'));    // Hatua 2: hospitali (Super Admin)
app.use('/api/users', require('./server/users'));        // Hatua 2: watumiaji
app.use('/api/audit', require('./server/audit').router); // Hatua 2: Audit Trail
app.use('/api/payers', require('./server/payers'));      // Hatua 3: bima na kampuni
app.use('/api/patients', require('./server/patients'));  // Hatua 3: wagonjwa (Mapokezi)
app.use('/api/visits', require('./server/visits').router); // Hatua 3: ziara, token, triage
app.use('/api/services', require('./server/services'));  // Hatua 4: orodha ya vipimo, dawa, huduma
app.use('/api/opd', require('./server/opd'));            // Hatua 4: daktari (OPD)
app.use('/api/lab', require('./server/lab'));            // Maabara na radiology
app.use('/api/billing', require('./server/billing'));    // Malipo, price lists, zamu za cashier
app.use('/api/pharmacy', require('./server/pharmacy').pharmacy); // Pharmacy
app.use('/api/stock', require('./server/pharmacy').stock);       // Stock ya dawa
app.use('/api/claims', require('./server/claims'));      // Madai ya NHIF, bima, kampuni
app.use('/api/ipd', require('./server/ipd'));            // Wodi, vitanda, kulaza, discharge
app.use('/api/reports', require('./server/reports'));    // Dashboard na ripoti
app.use('/api/finance', require('./server/finance'));    // Fedha: matumizi, wanaodaiwa, zamu
app.use('/api/hr', require('./server/hr'));              // HR: mishahara, likizo, zamu

// API ambayo haipo
app.use('/api', (req, res) => {
  res.status(404).json({ status: 'error', message: 'API hii haipo' });
});

// Kosa lolote lisilotarajiwa
app.use((err, req, res, next) => {
  console.error('Kosa la server:', err);
  res.status(500).json({ status: 'error', message: 'Kuna tatizo kwenye server' });
});

// -------------------------------------------------------------
// Kuanzisha mfumo
// -------------------------------------------------------------
async function start() {
  try {
    await db.runSchema();
    console.log('Database iko tayari (majedwali yamehakikiwa).');
  } catch (err) {
    console.error('Imeshindwa kuandaa database:', err.message);
    console.error('Server itaendelea, lakini /api/health itaonyesha kosa.');
  }

  app.listen(PORT, () => {
    console.log(`HugoMed inafanya kazi kwenye port ${PORT}`);
  });
}

start();
