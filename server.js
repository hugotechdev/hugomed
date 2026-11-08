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
      version: '0.1.0',
      database: 'connected',
      tables: tables.rows[0].count,
      time: result.rows[0].time
    });
  } catch (err) {
    console.error('Health check imeshindwa:', err.message);
    res.status(500).json({
      status: 'error',
      app: 'HugoMed',
      database: 'not connected',
      message: 'Database haipatikani. Angalia DATABASE_URL kwenye Railway.'
    });
  }
});

// -------------------------------------------------------------
// Sehemu za mfumo zitaongezwa hapa hatua kwa hatua:
// Hatua 2: app.use('/api/auth', require('./server/auth'));
// Hatua 2: app.use('/api/tenants', require('./server/tenants'));
// Hatua 3: app.use('/api/patients', require('./server/patients'));
// -------------------------------------------------------------

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
