import "server-only";
import { all, insert, one, run, scalar } from "./db";
import { stamp } from "./stock";

/* ------------------------------------------------------------------ */
/* Totais                                                              */
/* ------------------------------------------------------------------ */

/** Recalcula subtotais dos itens e o total da reserva. Fonte unica da verdade. */
export function recalcReservation(id: number) {
  run(
    `UPDATE reservation_items
        SET subtotal_cents = MAX(0, qty * unit_price_cents - discount_cents)
      WHERE reservation_id = ?`,
    [id],
  );
  const items = scalar<number>(
    `SELECT COALESCE(SUM(subtotal_cents),0) FROM reservation_items WHERE reservation_id = ?`,
    [id],
  );
  run(
    `UPDATE reservations
        SET items_cents = ?,
            total_cents = MAX(0, ? + freight_cents + assembly_cents + disassembly_cents + other_cents - discount_cents),
            updated_at  = datetime('now','localtime')
      WHERE id = ?`,
    [items, items, id],
  );
}

export function recalcQuote(id: number) {
  run(
    `UPDATE quote_items SET subtotal_cents = MAX(0, qty * unit_price_cents - discount_cents) WHERE quote_id = ?`,
    [id],
  );
  const items = scalar<number>(`SELECT COALESCE(SUM(subtotal_cents),0) FROM quote_items WHERE quote_id = ?`, [id]);
  run(
    `UPDATE quotes
        SET items_cents = ?,
            total_cents = MAX(0, ? + freight_cents + assembly_cents + disassembly_cents + other_cents - discount_cents),
            updated_at  = datetime('now','localtime')
      WHERE id = ?`,
    [items, items, id],
  );
}

/* ------------------------------------------------------------------ */
/* Operacoes vinculadas (entrega / retirada / montagem / desmontagem)  */
/* ------------------------------------------------------------------ */

const KIND_FLAG: Record<string, string> = {
  entrega: "needs_delivery",
  retirada: "needs_pickup",
  montagem: "needs_assembly",
  desmontagem: "needs_disassembly",
};

/**
 * Mantem a agenda operacional em sincronia com a reserva.
 * Cria o que falta, reagenda o que mudou e cancela o que foi desmarcado.
 * Nunca sobrescreve operacao ja concluida.
 */
export function syncOperations(reservationId: number) {
  const r = one<any>(`SELECT * FROM reservations WHERE id = ?`, [reservationId]);
  if (!r) return;

  const when: Record<string, string> = {
    entrega: stamp(r.delivery_at || r.event_date, "08:00"),
    montagem: stamp(r.delivery_at || r.event_date, "08:00"),
    retirada: stamp(r.pickup_at || r.event_date, "18:00"),
    desmontagem: stamp(r.pickup_at || r.event_date, "18:00"),
  };

  for (const kind of Object.keys(KIND_FLAG)) {
    const wanted = r.status !== "cancelada" && !!r[KIND_FLAG[kind]];
    const existing = one<any>(`SELECT * FROM operations WHERE reservation_id = ? AND kind = ?`, [
      reservationId,
      kind,
    ]);

    if (wanted && !existing) {
      insert(`INSERT INTO operations (kind, reservation_id, scheduled_at, status) VALUES (?,?,?, 'pendente')`, [
        kind,
        reservationId,
        when[kind],
      ]);
    } else if (wanted && existing) {
      if (existing.status === "concluida") continue;
      const updates: string[] = [];
      const params: any[] = [];
      if (existing.scheduled_at !== when[kind]) {
        updates.push("scheduled_at = ?");
        params.push(when[kind]);
      }
      if (existing.status === "cancelada") {
        updates.push("status = 'pendente'");
      }
      if (updates.length) {
        params.push(reservationId, kind);
        run(
          `UPDATE operations SET ${updates.join(", ")}, updated_at = datetime('now','localtime')
            WHERE reservation_id = ? AND kind = ?`,
          params,
        );
      }
    } else if (!wanted && existing && existing.status !== "concluida" && existing.status !== "cancelada") {
      run(
        `UPDATE operations SET status = 'cancelada', updated_at = datetime('now','localtime')
          WHERE id = ?`,
        [existing.id],
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Financeiro da reserva                                               */
/* ------------------------------------------------------------------ */

export type ReservationMoney = {
  total: number;
  paid: number;
  balance: number;
  deposit: number;
  depositStatus: string;
  depositRetained: number;
};

export function reservationMoney(id: number): ReservationMoney {
  const total = scalar<number>(`SELECT COALESCE(total_cents,0) FROM reservations WHERE id = ?`, [id]);
  const paid = scalar<number>(`SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE reservation_id = ?`, [id]);
  const dep = one<any>(`SELECT * FROM deposits WHERE reservation_id = ? ORDER BY id DESC LIMIT 1`, [id]);
  return {
    total,
    paid,
    balance: total - paid,
    deposit: dep?.amount_cents ?? 0,
    depositStatus: dep?.status ?? "nao_recebida",
    depositRetained: dep?.retained_cents ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export const RESERVATION_SELECT = `
  SELECT r.*, c.name AS customer_name, c.phone AS customer_phone, c.whatsapp AS customer_whatsapp,
         c.doc AS customer_doc,
         (SELECT COALESCE(SUM(amount_cents),0) FROM payments p WHERE p.reservation_id = r.id) AS paid_cents,
         (SELECT COUNT(*) FROM reservation_items i WHERE i.reservation_id = r.id) AS item_count,
         (SELECT COALESCE(SUM(qty),0) FROM reservation_items i WHERE i.reservation_id = r.id) AS item_qty,
         (SELECT d.status FROM deposits d WHERE d.reservation_id = r.id ORDER BY d.id DESC LIMIT 1) AS deposit_status,
         (SELECT d.amount_cents FROM deposits d WHERE d.reservation_id = r.id ORDER BY d.id DESC LIMIT 1) AS deposit_cents,
         (SELECT ct.status FROM contracts ct WHERE ct.reservation_id = r.id ORDER BY ct.id DESC LIMIT 1) AS contract_status
    FROM reservations r
    JOIN customers c ON c.id = r.customer_id`;

export function getReservation(id: number) {
  return one<any>(`${RESERVATION_SELECT} WHERE r.id = ?`, [id]);
}

export function getReservationByNumber(number: string) {
  return one<any>(`${RESERVATION_SELECT} WHERE r.number = ?`, [number]);
}

export function reservationItems(id: number) {
  return all<any>(
    `SELECT i.*, p.name AS product_name, p.code AS product_code
       FROM reservation_items i JOIN products p ON p.id = i.product_id
      WHERE i.reservation_id = ? ORDER BY i.id`,
    [id],
  );
}

export function quoteItems(id: number) {
  return all<any>(
    `SELECT i.*, p.name AS product_name, p.code AS product_code
       FROM quote_items i JOIN products p ON p.id = i.product_id
      WHERE i.quote_id = ? ORDER BY i.id`,
    [id],
  );
}

export function reservationOperations(id: number) {
  return all<any>(
    `SELECT o.*, v.name AS vehicle_name FROM operations o
       LEFT JOIN vehicles v ON v.id = o.vehicle_id
      WHERE o.reservation_id = ? ORDER BY o.scheduled_at`,
    [id],
  );
}

export function itemsSummary(id: number): string {
  const items = reservationItems(id);
  return items.map((i) => `${i.qty}x ${i.product_name}`).join(", ");
}
