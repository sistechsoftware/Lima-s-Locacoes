import "server-only";
import { all, one, run } from "./db";
import { HOLDING_STATUSES } from "./domain";
import {
  buildSpecMap,
  computeConflicts,
  conflictText,
  expandDemand,
  explodeLine,
  isKit,
  kitCapacity,
  type Line,
  type LineConflict,
  type SpecMap,
} from "./kits";

/**
 * Motor de disponibilidade.
 *
 * Duas regras se combinam aqui:
 *
 * 1. TEMPO - o estoque nao e um contador simples: cada reserva ocupa o
 *    equipamento apenas durante a janela [entrega, retirada). Duas reservas em
 *    datas diferentes usam o mesmo equipamento sem conflito. Por isso a
 *    disponibilidade e o PICO de uso simultaneo dentro da janela consultada.
 *
 * 2. COMPOSICAO - kits nao tem estoque proprio. Toda linha de reserva e
 *    expandida para os produtos fisicos que consome (tabela
 *    reservation_item_components) e o calculo acontece sempre sobre eles.
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
  /** Produto comercial que originou a ocupacao (kit ou o proprio produto). */
  via_product?: string | null;
};

export type Availability = {
  product_id: number;
  code: string;
  name: string;
  category: string | null;
  kind: "simples" | "kit";
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

/* ------------------------------------------------------------------ */
/* Fichas de produto (composicao)                                      */
/* ------------------------------------------------------------------ */

/** Carrega a ficha de composicao de todos os produtos. */
export async function loadSpecs(): Promise<SpecMap> {
  const products = await all<{ id: number; name: string; kind: string }>(
    `SELECT id, name, kind FROM products`,
  );
  const components = await all<{ parent_product_id: number; component_product_id: number; quantity: number }>(
    `SELECT parent_product_id, component_product_id, quantity FROM product_components`,
  );
  return buildSpecMap(products, components);
}

/**
 * Catalogo vendavel: produtos simples e kits, com a composicao ja resumida.
 * Usado pelos formularios de reserva e orcamento.
 */
export async function sellableProducts() {
  const rows = await all<any>(
    `SELECT p.id, p.code, p.name, p.kind, p.rent_price_cents, p.total_qty, c.name AS category
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1
      ORDER BY c.name, p.name`,
  );
  const comps = await all<any>(
    `SELECT pc.parent_product_id, pc.quantity, p.name
       FROM product_components pc JOIN products p ON p.id = pc.component_product_id
      ORDER BY p.name`,
  );
  const byParent = new Map<number, string[]>();
  for (const c of comps) {
    const list = byParent.get(c.parent_product_id) ?? [];
    list.push(`${c.quantity} ${c.name}`);
    byParent.set(c.parent_product_id, list);
  }
  return rows.map((r) => ({
    ...r,
    composition: r.kind === "kit" ? (byParent.get(r.id) ?? []).join(" + ") || null : null,
  }));
}

/** Componentes de um kit, com nome e codigo, para exibicao. */
export async function componentsOf(productId: number) {
  return await all<any>(
    `SELECT pc.*, p.name AS component_name, p.code AS component_code, p.total_qty, p.maintenance_qty
       FROM product_components pc
       JOIN products p ON p.id = pc.component_product_id
      WHERE pc.parent_product_id = ?
      ORDER BY p.name`,
    [productId],
  );
}

/** Kits que utilizam o produto informado como componente. */
export async function kitsUsing(productId: number) {
  return await all<any>(
    `SELECT pc.quantity, p.id, p.name, p.code
       FROM product_components pc
       JOIN products p ON p.id = pc.parent_product_id
      WHERE pc.component_product_id = ?
      ORDER BY p.name`,
    [productId],
  );
}

/* ------------------------------------------------------------------ */
/* Ocupacao fisica                                                     */
/* ------------------------------------------------------------------ */

/**
 * Reservas que ocupam fisicamente um produto dentro da janela.
 *
 * Le a expansao (reservation_item_components), portanto ja considera tanto os
 * itens individuais quanto os componentes vindos de kits.
 */
export async function holdsForProduct(
  productId: number,
  from: string,
  to: string,
  excludeReservationId?: number | null,
  maxReservationId?: number | null,
): Promise<Hold[]> {
  return await all<Hold>(
    `SELECT r.id AS reservation_id, r.number, c.name AS customer, r.status,
            ric.qty, prod.name AS via_product,
            ${HOLD_START} AS hold_start, ${HOLD_END} AS hold_end
       FROM reservation_item_components ric
       JOIN reservations r ON r.id = ric.reservation_id
       JOIN customers c ON c.id = r.customer_id
       LEFT JOIN reservation_items ri ON ri.id = ric.reservation_item_id
       LEFT JOIN products prod ON prod.id = ri.product_id
      WHERE ric.product_id = ?
        AND r.status IN (${HOLD})
        AND (? IS NULL OR r.id <> ?)
        AND (? IS NULL OR r.id <= ?)
        AND ${HOLD_START} < ?
        AND ${HOLD_END} > ?
      ORDER BY hold_start`,
    [
      productId,
      excludeReservationId ?? null,
      excludeReservationId ?? -1,
      maxReservationId ?? null,
      maxReservationId ?? -1,
      to,
      from,
    ],
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

/* ------------------------------------------------------------------ */
/* Disponibilidade                                                     */
/* ------------------------------------------------------------------ */

function availabilityRow(p: any, reserved: number): Availability {
  const effective = Math.max(0, p.total_qty - p.maintenance_qty);
  return {
    product_id: p.id,
    code: p.code,
    name: p.name,
    category: p.category,
    kind: p.kind === "kit" ? "kit" : "simples",
    total: p.total_qty,
    maintenance: p.maintenance_qty,
    effective,
    reserved,
    available: effective - reserved,
    min_qty: p.min_qty,
    low: effective - reserved < p.min_qty,
  };
}

/**
 * Disponibilidade de um produto na janela.
 * Para kits, e derivada dos componentes (menor razao, arredondada para baixo).
 */
export async function availabilityFor(
  productId: number,
  from: string,
  to: string,
  excludeReservationId?: number | null,
): Promise<Availability> {
  const p = await one<any>(
    `SELECT p.id, p.code, p.name, p.kind, p.total_qty, p.maintenance_qty, p.min_qty, c.name AS category
       FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
    [productId],
  );
  if (!p) throw new Error("Produto nao encontrado: " + productId);

  if (p.kind === "kit") {
    const specs = await loadSpecs();
    const spec = specs.get(productId);
    const physical = await physicalAvailability(from, to, excludeReservationId);
    const capacity = spec ? kitCapacity(spec, physical) : 0;
    return {
      product_id: p.id,
      code: p.code,
      name: p.name,
      category: p.category,
      kind: "kit",
      total: 0,
      maintenance: 0,
      effective: 0,
      reserved: 0,
      available: capacity,
      min_qty: p.min_qty,
      low: capacity < p.min_qty,
    };
  }

  const holds = await holdsForProduct(productId, from, to, excludeReservationId);
  return availabilityRow(p, peakUsage(holds, from, to));
}

/**
 * Disponibilidade de todos os produtos FISICOS (simples) ativos na janela.
 * Kits ficam de fora para nao duplicar contagem em somatorios.
 */
export async function availabilityAll(
  from: string,
  to: string,
  excludeReservationId?: number | null,
): Promise<Availability[]> {
  const products = await all<any>(
    `SELECT p.id, p.code, p.name, p.kind, p.total_qty, p.maintenance_qty, p.min_qty, c.name AS category
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1 AND p.kind <> 'kit'
      ORDER BY c.name, p.name`,
  );
  const rows = await all<Hold & { product_id: number }>(
    `SELECT ric.product_id, r.id AS reservation_id, r.number, c.name AS customer, r.status,
            ric.qty, ${HOLD_START} AS hold_start, ${HOLD_END} AS hold_end
       FROM reservation_item_components ric
       JOIN reservations r ON r.id = ric.reservation_id
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
  return products.map((p) => availabilityRow(p, peakUsage(byProduct.get(p.id) ?? [], from, to)));
}

/** Mapa produto fisico -> unidades livres na janela. */
export async function physicalAvailability(
  from: string,
  to: string,
  excludeReservationId?: number | null,
): Promise<Map<number, number>> {
  const rows = await availabilityAll(from, to, excludeReservationId);
  return new Map(rows.map((r) => [r.product_id, r.available]));
}

/**
 * Produtos fisicos e kits juntos, para telas de consulta.
 * O kit aparece com a quantidade que da para montar, nunca como estoque fisico.
 */
export async function availabilityAllWithKits(
  from: string,
  to: string,
  excludeReservationId?: number | null,
): Promise<Availability[]> {
  const physical = await availabilityAll(from, to, excludeReservationId);
  const disponivel = new Map(physical.map((r) => [r.product_id, r.available]));
  const specs = await loadSpecs();

  const kits = await all<any>(
    `SELECT p.id, p.code, p.name, p.kind, p.min_qty, c.name AS category
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1 AND p.kind = 'kit'
      ORDER BY c.name, p.name`,
  );

  const kitRows: Availability[] = kits.map((p) => {
    const spec = specs.get(p.id);
    const capacity = spec ? kitCapacity(spec, disponivel) : 0;
    return {
      product_id: p.id,
      code: p.code,
      name: p.name,
      category: p.category,
      kind: "kit" as const,
      total: 0,
      maintenance: 0,
      effective: 0,
      reserved: 0,
      available: capacity,
      min_qty: p.min_qty,
      low: capacity < p.min_qty,
    };
  });

  return [...physical, ...kitRows];
}

/* ------------------------------------------------------------------ */
/* Conflitos                                                           */
/* ------------------------------------------------------------------ */

export type Conflict = LineConflict & { holds: Hold[] };

/**
 * Verifica se as linhas pedidas cabem no estoque durante a janela.
 *
 * As linhas sao COMERCIAIS (podem misturar kits e produtos individuais). A
 * expansao para produtos fisicos acontece aqui dentro, uma unica vez.
 */
export async function checkConflicts(
  items: Line[],
  from: string,
  to: string,
  excludeReservationId?: number | null,
): Promise<Conflict[]> {
  const lines = items.filter((i) => i.product_id && Number(i.qty) > 0);
  if (!lines.length) return [];

  const specs = await loadSpecs();
  const available = await physicalAvailability(from, to, excludeReservationId);
  const conflicts = computeConflicts(lines, specs, available);

  const out: Conflict[] = [];
  for (const c of conflicts) {
    const spec = specs.get(c.product_id);
    let holds: Hold[] = [];
    if (isKit(spec)) {
      for (const comp of c.components) {
        holds = holds.concat(await holdsForProduct(comp.product_id, from, to, excludeReservationId));
      }
    } else {
      holds = await holdsForProduct(c.product_id, from, to, excludeReservationId);
    }
    out.push({ ...c, holds });
  }
  return out;
}

/** Mensagem unica para uma lista de conflitos. */
export function conflictsMessage(conflicts: LineConflict[]): string {
  return "ESTOQUE INSUFICIENTE. " + conflicts.map(conflictText).join(" ");
}

/* ------------------------------------------------------------------ */
/* Expansao / gravacao do consumo fisico                               */
/* ------------------------------------------------------------------ */

/**
 * Regrava a fotografia do consumo fisico de uma reserva.
 *
 * Chamada sempre que os itens da reserva mudam. Como a expansao e refeita a
 * partir da composicao vigente NAQUELE momento, uma alteracao posterior no kit
 * nao mexe em reservas ja gravadas.
 */
export async function rebuildReservationComponents(reservationId: number) {
  const items = await all<{ id: number; product_id: number; qty: number }>(
    `SELECT id, product_id, qty FROM reservation_items WHERE reservation_id = ?`,
    [reservationId],
  );
  const specs = await loadSpecs();

  await run(`DELETE FROM reservation_item_components WHERE reservation_id = ?`, [reservationId]);

  for (const item of items) {
    const spec = specs.get(item.product_id);
    const parts = explodeLine({ product_id: item.product_id, qty: item.qty }, specs);
    for (const part of parts) {
      const perUnit = isKit(spec)
        ? (spec!.components.find((c) => c.product_id === part.product_id)?.quantity ?? 1)
        : 1;
      await run(
        `INSERT INTO reservation_item_components
           (reservation_id, reservation_item_id, product_id, qty_per_unit, qty)
         VALUES (?,?,?,?,?)`,
        [reservationId, item.id, part.product_id, perUnit, part.qty],
      );
    }
  }
}

/** Consumo fisico gravado de uma reserva, agrupado por produto. */
export async function reservationPhysicalUsage(reservationId: number) {
  return await all<any>(
    `SELECT ric.product_id, p.name AS product_name, p.code AS product_code, SUM(ric.qty) AS qty
       FROM reservation_item_components ric
       JOIN products p ON p.id = ric.product_id
      WHERE ric.reservation_id = ?
      GROUP BY ric.product_id
      ORDER BY p.name`,
    [reservationId],
  );
}

/* ------------------------------------------------------------------ */
/* Concorrencia                                                        */
/* ------------------------------------------------------------------ */

export type Overbooking = {
  product_id: number;
  product: string;
  effective: number;
  used: number;
  excess: number;
};

/**
 * Verifica, DEPOIS da escrita, se esta reserva estourou o estoque fisico.
 *
 * O D1 nao tem transacao interativa para segurar linha ate o commit, entao a
 * protecao contra duas reservas simultaneas do mesmo ultimo item e feita por
 * verificacao otimista: cada reserva confere se ela cabe considerando apenas
 * as reservas MAIS ANTIGAS que ela (id <= o proprio id). Se duas gravarem ao
 * mesmo tempo, a mais nova enxerga a mais antiga e desiste; a mais antiga nao
 * enxerga a mais nova e permanece. O desempate e deterministico e nunca deixa
 * as duas passarem.
 */
export async function findOverbookings(reservationId: number): Promise<Overbooking[]> {
  const r = await one<any>(
    `SELECT id, event_date, delivery_at, pickup_at, status FROM reservations WHERE id = ?`,
    [reservationId],
  );
  if (!r) return [];
  if (!(HOLDING_STATUSES as readonly string[]).includes(r.status)) return [];

  const { from, to } = holdWindow(r);
  const usage = await all<{ product_id: number }>(
    `SELECT DISTINCT product_id FROM reservation_item_components WHERE reservation_id = ?`,
    [reservationId],
  );

  const out: Overbooking[] = [];
  for (const u of usage) {
    const p = await one<any>(
      `SELECT id, name, total_qty, maintenance_qty FROM products WHERE id = ?`,
      [u.product_id],
    );
    if (!p) continue;
    const effective = Math.max(0, p.total_qty - p.maintenance_qty);
    const holds = await holdsForProduct(u.product_id, from, to, null, reservationId);
    const used = peakUsage(holds, from, to);
    if (used > effective) {
      out.push({ product_id: p.id, product: p.name, effective, used, excess: used - effective });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Agrupamentos para telas de consulta                                 */
/* ------------------------------------------------------------------ */

/**
 * Resumo por categoria para a tela de disponibilidade.
 * Os totais somam apenas produtos fisicos; kits entram como linha derivada.
 */
export async function availabilityByCategory(from: string, to: string) {
  const rows = await availabilityAllWithKits(from, to);
  const groups = new Map<string, Availability[]>();
  for (const r of rows) {
    const key = r.category ?? "Sem categoria";
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([category, products]) => {
    const fisicos = products.filter((p) => p.kind !== "kit");
    return {
      category,
      products,
      total: fisicos.reduce((s, p) => s + p.total, 0),
      reserved: fisicos.reduce((s, p) => s + p.reserved, 0),
      available: fisicos.reduce((s, p) => s + Math.max(0, p.available), 0),
    };
  });
}

export { expandDemand, explodeLine, kitCapacity, isKit, conflictText };
