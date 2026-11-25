const { Pool } = require('pg');

let pool;
let tablesInitialized = false;

function getPool() {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ||
      'postgresql://postgres.your-tenant-id:dcad519bf34b193c9e81461b097fecf4@184.107.176.201:6543/postgres';
    pool = new Pool({
      connectionString,
      ssl: false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }
  return pool;
}

async function ensureTables(p) {
  if (tablesInitialized) return;
  await p.query(`
    CREATE TABLE IF NOT EXISTS drakov_products (
      id TEXT PRIMARY KEY,
      code TEXT DEFAULT '',
      name TEXT NOT NULL,
      dosage TEXT DEFAULT '',
      form TEXT DEFAULT 'injectable',
      category TEXT DEFAULT 'Инъекционные',
      volume TEXT DEFAULT '10 ml',
      price NUMERIC(12,2) DEFAULT 0,
      currency TEXT DEFAULT '₽',
      purity TEXT DEFAULT '99.4% HPLC',
      status TEXT DEFAULT 'in_stock',
      description TEXT DEFAULT '',
      badge TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS drakov_settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  tablesInitialized = true;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const p = getPool();

  try {
    await ensureTables(p);

    if (req.method === 'GET') {
      const [productsRes, settingsRes] = await Promise.all([
        p.query('SELECT * FROM drakov_products ORDER BY created_at DESC;'),
        p.query('SELECT * FROM drakov_settings;')
      ]);

      const products = productsRes.rows.map((r) => ({
        id: r.id,
        code: r.code || '',
        name: r.name,
        dosage: r.dosage || '',
        form: r.form || 'injectable',
        category: r.category || 'Инъекционные',
        volume: r.volume || '',
        price: Number(r.price) || 0,
        currency: r.currency || '₽',
        purity: r.purity || '99.4% HPLC',
        status: r.status || 'in_stock',
        description: r.description || '',
        badge: r.badge || ''
      }));

      const settings = {};
      settingsRes.rows.forEach((r) => {
        settings[r.key] = r.value;
      });

      return res.status(200).json({ ok: true, products, settings });
    }

    if (req.method === 'POST') {
      const { action, payload } = req.body || {};

      if (action === 'save_product') {
        const prod = payload;
        if (!prod || !prod.id || !prod.name) {
          return res.status(400).json({ ok: false, error: 'Missing product id or name' });
        }
        await p.query(
          `
          INSERT INTO drakov_products (
            id, code, name, dosage, form, category, volume, price, currency, purity, status, description, badge, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
          ON CONFLICT (id) DO UPDATE SET
            code = EXCLUDED.code,
            name = EXCLUDED.name,
            dosage = EXCLUDED.dosage,
            form = EXCLUDED.form,
            category = EXCLUDED.category,
            volume = EXCLUDED.volume,
            price = EXCLUDED.price,
            currency = EXCLUDED.currency,
            purity = EXCLUDED.purity,
            status = EXCLUDED.status,
            description = EXCLUDED.description,
            badge = EXCLUDED.badge,
            updated_at = NOW();
          `,
          [
            prod.id,
            prod.code || '',
            prod.name,
            prod.dosage || '',
            prod.form || 'injectable',
            prod.category || 'Инъекционные',
            prod.volume || '',
            Number(prod.price) || 0,
            prod.currency || '₽',
            prod.purity || '99.4% HPLC',
            prod.status || 'in_stock',
            prod.description || '',
            prod.badge || ''
          ]
        );
        return res.status(200).json({ ok: true, id: prod.id });
      }

      if (action === 'delete_product') {
        const { id } = payload || {};
        if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
        await p.query('DELETE FROM drakov_products WHERE id = $1;', [id]);
        return res.status(200).json({ ok: true, id });
      }

      if (action === 'save_settings') {
        const entries = Object.entries(payload || {});
        for (const [key, val] of entries) {
          await p.query(
            `
            INSERT INTO drakov_settings (key, value, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
            `,
            [key, String(val ?? '')]
          );
        }
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ ok: false, error: 'Unknown action' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Drakov API error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
