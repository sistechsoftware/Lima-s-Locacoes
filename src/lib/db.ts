import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Conexao unica com SQLite (node:sqlite embutido no Node 22+).
 * Mantida em globalThis para sobreviver ao hot-reload do Next em dev.
 */
const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = process.env.LIMAS_DB_PATH ?? path.join(DB_DIR, "limas.db");

type Row = Record<string, any>;

declare global {
  // eslint-disable-next-line no-var
  var __limasDb: DatabaseSync | undefined;
}

function open(): DatabaseSync {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

export function getDb(): DatabaseSync {
  if (!globalThis.__limasDb) globalThis.__limasDb = open();
  return globalThis.__limasDb;
}

/* ------------------------------------------------------------------ */
/* Helpers de consulta                                                 */
/* ------------------------------------------------------------------ */

export function all<T = Row>(sql: string, params: any[] = []): T[] {
  const rows = getDb().prepare(sql).all(...normalize(params));
  return rows.map(plain) as T[];
}

export function one<T = Row>(sql: string, params: any[] = []): T | undefined {
  const row = getDb().prepare(sql).get(...normalize(params));
  return row === undefined ? undefined : (plain(row) as T);
}

/**
 * node:sqlite returns rows as null-prototype objects, which React's Server
 * Components serializer rejects when passed straight into a Client
 * Component. Copying into a plain object keeps the data identical but gives
 * it a normal Object prototype.
 */
function plain<T>(row: T): T {
  return { ...(row as object) } as T;
}

export function run(sql: string, params: any[] = []) {
  return getDb().prepare(sql).run(...normalize(params));
}

export function insert(sql: string, params: any[] = []): number {
  return Number(run(sql, params).lastInsertRowid);
}

export function scalar<T = number>(sql: string, params: any[] = []): T {
  const r = one<Row>(sql, params);
  if (!r) return 0 as unknown as T;
  return Object.values(r)[0] as T;
}

/** SQLite nao aceita boolean/undefined/Date: normaliza para tipos suportados. */
function normalize(params: any[]): any[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    if (typeof p === "object" && p !== null) return JSON.stringify(p);
    return p;
  });
}

/** Executa fn dentro de uma transacao (rollback em erro). */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operador' CHECK (role IN ('admin','operador')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  doc        TEXT,
  phone      TEXT,
  whatsapp   TEXT,
  email      TEXT,
  address    TEXT,
  district   TEXT,
  city       TEXT,
  zip        TEXT,
  notes      TEXT,
  is_demo    INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS products (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  category_id       INTEGER REFERENCES categories(id),
  total_qty         INTEGER NOT NULL DEFAULT 0,
  maintenance_qty   INTEGER NOT NULL DEFAULT 0,
  min_qty           INTEGER NOT NULL DEFAULT 0,
  rent_price_cents  INTEGER NOT NULL DEFAULT 0,
  replace_cents     INTEGER NOT NULL DEFAULT 0,
  description       TEXT,
  photo             TEXT,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS product_units (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code         TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'disponivel'
               CHECK (status IN ('disponivel','reservado','alugado','manutencao','danificado','baixado')),
  photo        TEXT,
  acquired_at  TEXT,
  value_cents  INTEGER NOT NULL DEFAULT 0,
  condition    TEXT DEFAULT 'bom',
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_units_product ON product_units(product_id);

CREATE TABLE IF NOT EXISTS reservations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  number            TEXT NOT NULL UNIQUE,
  customer_id       INTEGER NOT NULL REFERENCES customers(id),
  status            TEXT NOT NULL DEFAULT 'pre_reserva',
  event_date        TEXT NOT NULL,
  event_time        TEXT,
  address           TEXT,
  district          TEXT,
  city              TEXT,
  delivery_at       TEXT,
  pickup_at         TEXT,
  needs_delivery    INTEGER NOT NULL DEFAULT 1,
  needs_pickup      INTEGER NOT NULL DEFAULT 1,
  needs_assembly    INTEGER NOT NULL DEFAULT 0,
  needs_disassembly INTEGER NOT NULL DEFAULT 0,
  items_cents       INTEGER NOT NULL DEFAULT 0,
  freight_cents     INTEGER NOT NULL DEFAULT 0,
  assembly_cents    INTEGER NOT NULL DEFAULT 0,
  disassembly_cents INTEGER NOT NULL DEFAULT 0,
  other_cents       INTEGER NOT NULL DEFAULT 0,
  discount_cents    INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  cancel_reason     TEXT,
  stock_override    INTEGER NOT NULL DEFAULT 0,
  quote_id          INTEGER,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_res_customer ON reservations(customer_id);
CREATE INDEX IF NOT EXISTS idx_res_event ON reservations(event_date);
CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status);

CREATE TABLE IF NOT EXISTS reservation_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id   INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  product_id       INTEGER NOT NULL REFERENCES products(id),
  qty              INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents   INTEGER NOT NULL DEFAULT 0,
  subtotal_cents   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ritems_res ON reservation_items(reservation_id);
CREATE INDEX IF NOT EXISTS idx_ritems_prod ON reservation_items(product_id);

CREATE TABLE IF NOT EXISTS quotes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  number            TEXT NOT NULL UNIQUE,
  customer_id       INTEGER NOT NULL REFERENCES customers(id),
  status            TEXT NOT NULL DEFAULT 'rascunho',
  event_date        TEXT,
  event_time        TEXT,
  address           TEXT,
  district          TEXT,
  city              TEXT,
  delivery_at       TEXT,
  pickup_at         TEXT,
  valid_until       TEXT,
  items_cents       INTEGER NOT NULL DEFAULT 0,
  freight_cents     INTEGER NOT NULL DEFAULT 0,
  assembly_cents    INTEGER NOT NULL DEFAULT 0,
  disassembly_cents INTEGER NOT NULL DEFAULT 0,
  other_cents       INTEGER NOT NULL DEFAULT 0,
  discount_cents    INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  reservation_id    INTEGER REFERENCES reservations(id),
  is_demo           INTEGER NOT NULL DEFAULT 0,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS quote_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id         INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id       INTEGER NOT NULL REFERENCES products(id),
  qty              INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents   INTEGER NOT NULL DEFAULT 0,
  subtotal_cents   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_qitems_quote ON quote_items(quote_id);

CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE CASCADE,
  freight_id     INTEGER REFERENCES freights(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL,
  method         TEXT NOT NULL DEFAULT 'pix',
  paid_at        TEXT NOT NULL,
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pay_res ON payments(reservation_id);
CREATE INDEX IF NOT EXISTS idx_pay_date ON payments(paid_at);

CREATE TABLE IF NOT EXISTS deposits (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL DEFAULT 0,
  method         TEXT,
  received_at    TEXT,
  returned_at    TEXT,
  status         TEXT NOT NULL DEFAULT 'nao_recebida'
                 CHECK (status IN ('nao_recebida','recebida','devolvida','retida_parcial','retida_integral')),
  retained_cents INTEGER NOT NULL DEFAULT 0,
  reason         TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_dep_res ON deposits(reservation_id);

CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  date           TEXT NOT NULL,
  category       TEXT NOT NULL,
  description    TEXT,
  amount_cents   INTEGER NOT NULL,
  method         TEXT DEFAULT 'pix',
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'pago',
  is_demo        INTEGER NOT NULL DEFAULT 0,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(date);

CREATE TABLE IF NOT EXISTS vehicles (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT NOT NULL,
  plate    TEXT,
  model    TEXT,
  capacity TEXT,
  notes    TEXT,
  active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS freights (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  number       TEXT NOT NULL UNIQUE,
  customer_id  INTEGER REFERENCES customers(id),
  contact_name TEXT,
  phone        TEXT,
  date         TEXT NOT NULL,
  time         TEXT,
  origin       TEXT,
  destination  TEXT,
  cargo        TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  method       TEXT DEFAULT 'pix',
  status       TEXT NOT NULL DEFAULT 'orcamento'
               CHECK (status IN ('orcamento','agendado','em_rota','concluido','cancelado')),
  vehicle_id   INTEGER REFERENCES vehicles(id),
  notes        TEXT,
  is_demo      INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_freight_date ON freights(date);

/*
 * Entregas, retiradas, montagens e desmontagens compartilham exatamente os
 * mesmos campos e o mesmo ciclo de status. Ficam numa tabela unica com a
 * coluna kind, e as views abaixo expoem cada uma pelo nome do dominio.
 */
CREATE TABLE IF NOT EXISTS operations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT NOT NULL CHECK (kind IN ('entrega','retirada','montagem','desmontagem')),
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE CASCADE,
  freight_id     INTEGER REFERENCES freights(id) ON DELETE CASCADE,
  scheduled_at   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pendente'
                 CHECK (status IN ('pendente','confirmada','em_rota','no_local','concluida','reagendada','cancelada')),
  assignee       TEXT,
  vehicle_id     INTEGER REFERENCES vehicles(id),
  notes          TEXT,
  completed_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_op_sched ON operations(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_op_res ON operations(reservation_id);
CREATE INDEX IF NOT EXISTS idx_op_kind ON operations(kind, status);

CREATE VIEW IF NOT EXISTS deliveries     AS SELECT * FROM operations WHERE kind = 'entrega';
CREATE VIEW IF NOT EXISTS pickups        AS SELECT * FROM operations WHERE kind = 'retirada';
CREATE VIEW IF NOT EXISTS assemblies     AS SELECT * FROM operations WHERE kind = 'montagem';
CREATE VIEW IF NOT EXISTS disassemblies  AS SELECT * FROM operations WHERE kind = 'desmontagem';

CREATE TABLE IF NOT EXISTS checklists (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  data         TEXT NOT NULL DEFAULT '{}',
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_check_op ON checklists(operation_id);

CREATE TABLE IF NOT EXISTS attachments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL,
  entity_id  INTEGER NOT NULL,
  path       TEXT NOT NULL,
  caption    TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_att_entity ON attachments(entity, entity_id);

CREATE TABLE IF NOT EXISTS damage_reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id  INTEGER REFERENCES reservations(id) ON DELETE CASCADE,
  product_id      INTEGER REFERENCES products(id),
  product_unit_id INTEGER REFERENCES product_units(id),
  qty             INTEGER NOT NULL DEFAULT 1,
  damage_type     TEXT,
  description     TEXT,
  photo           TEXT,
  estimated_cents INTEGER NOT NULL DEFAULT 0,
  charged_cents   INTEGER NOT NULL DEFAULT 0,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS maintenance (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id      INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_unit_id INTEGER REFERENCES product_units(id),
  qty             INTEGER NOT NULL DEFAULT 1,
  reason          TEXT,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  status          TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','concluida','cancelada')),
  cost_cents      INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS contracts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  number         TEXT NOT NULL UNIQUE,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pendente'
                 CHECK (status IN ('pendente','enviado','assinado','encerrado','cancelado')),
  body           TEXT NOT NULL,
  signer_name    TEXT,
  sent_at        TEXT,
  signed_at      TEXT,
  notes          TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_contract_res ON contracts(reservation_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  severity   TEXT NOT NULL DEFAULT 'info',
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  dedupe_key TEXT UNIQUE,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  user_name  TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  summary    TEXT NOT NULL,
  meta       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);
`;

function migrate(db: DatabaseSync) {
  db.exec(SCHEMA);
}

/** Gera o proximo numero sequencial de um documento (LIMA-001, FRT-001, ...). */
export function nextNumber(table: "reservations" | "quotes" | "freights" | "contracts", prefix: string): string {
  const row = one<{ n: string }>(
    `SELECT number AS n FROM ${table} WHERE number LIKE ? ORDER BY LENGTH(number) DESC, number DESC LIMIT 1`,
    [prefix + "-%"],
  );
  const last = row ? parseInt(row.n.split("-").pop() ?? "0", 10) : 0;
  return `${prefix}-${String(last + 1).padStart(3, "0")}`;
}
