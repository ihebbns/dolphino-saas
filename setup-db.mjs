import { neon } from '@neondatabase/serverless';

const DB = 'postgresql://neondb_owner:npg_zD29OAQSbGhY@ep-odd-union-as0b3p7b-pooler.c-4.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const sql = neon(DB);

async function setup() {
  console.log('Connecting to Neon...');

  await sql`
    CREATE TABLE IF NOT EXISTS restaurants (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(100) NOT NULL,
      owner_email   VARCHAR(150) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      api_key       VARCHAR(64)  NOT NULL UNIQUE,
      city          VARCHAR(80)  DEFAULT '',
      phone         VARCHAR(30)  DEFAULT '',
      plan          VARCHAR(20)  DEFAULT 'active',
      created_at    TIMESTAMPTZ  DEFAULT NOW()
    )
  `;
  console.log('✓ restaurants table');

  await sql`
    CREATE TABLE IF NOT EXISTS sales (
      id            SERIAL PRIMARY KEY,
      restaurant_id INTEGER      NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      num           INTEGER      NOT NULL,
      business_date DATE         NOT NULL,
      sale_date     VARCHAR(30)  DEFAULT '',
      sale_time     VARCHAR(30)  DEFAULT '',
      items         JSONB        NOT NULL DEFAULT '[]',
      subtotal      NUMERIC(10,3) DEFAULT 0,
      discount      NUMERIC(10,3) DEFAULT 0,
      disc_pct      INTEGER      DEFAULT 0,
      grand         NUMERIC(10,3) DEFAULT 0,
      pay_method    VARCHAR(20)  DEFAULT 'cash',
      received      NUMERIC(10,3) DEFAULT 0,
      monnaie       NUMERIC(10,3) DEFAULT 0,
      order_type    VARCHAR(20)  DEFAULT 'place',
      cli_name      VARCHAR(100) DEFAULT '',
      cli_tel       VARCHAR(30)  DEFAULT '',
      cashier       VARCHAR(80)  DEFAULT '',
      synced_at     TIMESTAMPTZ  DEFAULT NOW(),
      UNIQUE (restaurant_id, num, business_date)
    )
  `;
  console.log('✓ sales table');

  await sql`
    CREATE INDEX IF NOT EXISTS idx_sales_restaurant_date
    ON sales(restaurant_id, business_date)
  `;
  console.log('✓ index');

  // Test restaurant — password: dolphino123
  await sql`
    INSERT INTO restaurants (name, owner_email, password_hash, api_key, city, phone, plan)
    VALUES (
      'Dolphino Restaurant',
      'iheb@dolphino.tn',
      '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uZutLjAu2',
      'DOLPH-TEST-KEY-001',
      'Kelibia',
      '+216 XX XXX XXX',
      'active'
    )
    ON CONFLICT DO NOTHING
  `;
  console.log('✓ test restaurant inserted');
  console.log('');
  console.log('DATABASE READY!');
  console.log('Login: iheb@dolphino.tn / dolphino123');
}

setup().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
