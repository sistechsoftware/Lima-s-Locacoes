import "server-only";
import { all, one } from "./db";
import { HOLDING_STATUSES } from "./domain";

/**
 * Motor de disponibilidade.
 *
 * O estoque nao e um contador simples: cada reserva ocupa o equipamento apenas
 * durante a janela [entrega, retirada). Duas reservas em datas diferentes usam
 * o mesmo equipamento sem conflito. Por isso a disponibilidade e calculada como
 * o PICO de uso simultaneo dentro da janela consultada, e nao pela soma bruta.
 */

const HOLD = HOLDING_STATUSES.map((s) => `'${s}'`).join(",");

/** Inicio da ocupacao de uma reserva, em SQL. */
const HOLD_START = `COALESCE(NULLIF(r.delivery_at,''), r.event_date || 'T00:00')`;
/** Fim da ocupacao (equipamento volta ao estoque na retirada). */
const HOLD_END = `COALESCE(NULLIF(r.pickup_at,''), r.event_date || 'T23:59')`;

export type Hold = {
  reservation_id: number;
  number: string;
  customer: string;
  status: string;
  qty: number;
  hold_start: string;
  hold_end: string;
};

export type Availability = {
  product_id: number;
  code: string;
  name: string;
  category: string | null;
  total: number;
  maintenance: number;
  effective: number;
  reserved: number;
  available: number;
  min_qty: number;
  low: boolean;
};

/** Normaliza para o formato comparavel YYYY-MM-DDTHH:MM. */
export function stamp(value: string | null | undefined, fallbackTime = "00:00"): string {
  if (!value) return "";
  if (value.length >= 16) return value.slice(0, 16).replace(" ", "T");
  if (value.length === 10) return `${value}T${fallbackTime}`;
  return value;
}

/** Janela de ocupacao de uma reserva a partir dos seus campos. */
export function holdWindow(r: {
  delivery_at?: string | null;
  pickup_at?: string | null;
  event_date: string;
}): { from: string; to: string } {
  return {
    from: stamp(r.delivery_at || r.event_date, "00:00"),
    to: stamp(r.pickup_at || r.event_date, "23:59"),
  };
}

/** Reservas que ocupam um produto dentro da janela informada. */
export function holdsForProduct(
  productId: number,
  from: string,
  to: string,
  excludeReservationId?: number | null,
): Hold[] {
  return all<Hold>(
    `SELECT r.id AS reservation_id, r.number, c.name AS customer, r.status,
            i.qty, ${HOLD_START} AS hold_start, ${HOLD_END} AS hold_end
       FROM reservation_items i
       JOIN reservations r ON r.id = i.reservation_id
       JOIN customers c ON c.id = r.customer_id
      WHERE i.product_id = ?
        AND r.status IN (${HOLD})
        AND (? IS NULL OR r.id <> ?)
        AND ${HOLD_START} < ?
        AND ${HOLD_END} > ?
      ORDER BY hold_start`,
    [productId, excludeReservationId ?? null, excludeReservationId ?? -1, to, from],
  );
}

/** Pico de uso simultaneo dentro da janela (varredura de intervalos). */
export function peakUsage(holds: Hold[], from: string, to: string): number {
  const events: { t: string; d: number }[] = [];
  for (const h of holds) {
    const s = h.hold_start < from ? from : h.hold_start;
    const e = h.hold_end > to ? to : h.hold_end;
    if (e <= s) continue;
    events.push({ t: s, d: h.qty });
    events.push({ t: e, d: -h.qty });
  }
  events.sort((a, b) => (a.t === b.t ? a.d - b.d : a.t < b.t ? -1 : 1));
  let cur = 0;
  let peak = 0;
  for (const ev of events) {
    cur += ev.d;
    if (cur > peak) peak = cur;
  }
  return peak;
}

/** Disponibilidade de um produto na janela informada. */
export function availabilityFor(
  productId: number,
  from: string,
  to: string,
  excludeReservationId?: number | null,
): Availability {
  const p = one<any>(
    `SELECT p.id, p.code, p.name, p.total_qty, p.maintenance_qty, p.min_qty, c.name AS category
       FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
    [productId],
  );
  if (!p) throw new Error("Produto nao encontrado: " + productId);
  const holds = holdsForProduct(productId, from, to, excludeReservationId);
  const reserved = peakUsage(holds, from, to);
  const effective = Math.max(0, p.total_qty - p.maintenance_qty);
  return {
    product_id: p.id,
    code: p.code,
    name: p.name,
    category: p.category,
    total: p.total_qty,
    maintenance: p.maintenance_qty,
    effective,
    reserved,
    available: effective - reserved,
    min_qty: p.min_qty,
    low: effective - reserved < p.min_qty,
  };
}

/** Disponibilidade de todos os produtos ativos numa janela (tela de consulta). */
export function availabilityAll(
  from: string,
  to: string,
  excludeReservationId?: number | null,
): Availability[] {
  const products = all<any>(
    `SELECT p.id, p.code, p.name, p.total_qty, p.maintenance_qty, p.min_qty, c.name AS category
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1
      ORDER BY c.name, p.name`,
  );
  const rows = all<Hold & { product_id: number }>(
    `SELECT i.product_id, r.id AS reservation_id, r.number, c.name AS customer, r.status,
            i.qty, ${HOLD_START} AS hold_start, ${HOLD_END} AS hold_end
       FROM reservation_items i
       JOIN reservations r ON r.id = i.reservation_id
       JOIN customers c ON c.id = r.customer_id
      WHERE r.status IN (${HOLD})
        AND (? IS NULL OR r.id <> ?)
        AND ${HOLD_START} < ?
        AND ${HOLD_END} > ?`,
    [excludeReservationId ?? null, excludeReservationId ?? -1, to, from],
  );
  const byProduct = new Map<number, Hold[]>();
  for (const r of rows) {
    const list = byProduct.get(r.product_id) ?? [];
    list.push(r);
    byProduct.set(r.product_id, list);
  }
  return products.map((p) => {
    const reserved = peakUsage(byProduct.get(p.id) ?? [], from, to);
    const effective = Math.max(0, p.total_qty - p.maintenance_qty);
    return {
      product_id: p.id,
      code: p.code,
      name: p.name,
      category: p.category,
      total: p.total_qty,
      maintenance: p.maintenance_qty,
      effective,
      reserved,
      available: effective - reserved,
      min_qty: p.min_qty,
      low: effective - reserved < p.min_qty,
    };
  });
}

export type Conflict = {
  product_id: number;
  product: string;
  requested: number;
  available: number;
  total: number;
  reserved: number;
  missing: number;
  holds: Hold[];
};

/**
 * Verifica se a lista de itens cabe no estoque durante a janela.
 * Retorna apenas os produtos com falta.
 */
export function checkConflicts(
  items: { product_id: number; qty: number }[],
  from: string,
  to: string,
  excludeReservationId?: number | null,
): Conflict[] {
  const conflicts: Conflict[] = [];
  const merged = new Map<number, number>();
  for (const it of items) merged.set(it.product_id, (merged.get(it.product_id) ?? 0) + Number(it.qty || 0));

  for (const [productId, qty] of merged) {
    if (qty <= 0) continue;
    const a = availabilityFor(productId, from, to, excludeReservationId);
    if (qty > a.available) {
      conflicts.push({
        product_id: productId,
        product: a.name,
        requested: qty,
        available: Math.max(0, a.available),
        total: a.total,
        reserved: a.reserved,
        missing: qty - Math.max(0, a.available),
        holds: holdsForProduct(productId, from, to, excludeReservationId),
      });
    }
  }
  return conflicts;
}

/** Resumo por categoria para a tela de disponibilidade. */
export function availabilityByCategory(from: string, to: string) {
  const rows = availabilityAll(from, to);
  const groups = new Map<string, Availability[]>();
  for (const r of rows) {
    const key = r.category ?? "Sem categoria";
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([category, products]) => ({
    category,
    products,
    total: products.reduce((s, p) => s + p.total, 0),
    reserved: products.reduce((s, p) => s + p.reserved, 0),
    available: products.reduce((s, p) => s + p.available, 0),
  }));
}
