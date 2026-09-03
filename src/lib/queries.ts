import "server-only";
import { all, one, scalar } from "./db";
import { addDays, endOfMonth, startOfMonth, startOfWeek, today } from "./format";
import { availabilityAll } from "./stock";
import { ACTIVE_STATUSES, HOLDING_STATUSES, OPEN_OPERATION_STATUS } from "./domain";

const list = (arr: readonly string[]) => arr.map((s) => `'${s}'`).join(",");
const HOLD = list(HOLDING_STATUSES);
const ACTIVE = list(ACTIVE_STATUSES);
const OPEN_OPS = list(OPEN_OPERATION_STATUS);

/* --------------------------- operacoes por periodo --------------------------- */

export const OPERATION_SELECT = `
  SELECT o.*, r.number AS reservation_number, r.address, r.district, r.city, r.event_date,
         r.status AS reservation_status, r.notes AS reservation_notes,
         c.id AS customer_id, c.name AS customer, c.phone, c.whatsapp,
         v.name AS vehicle_name,
         (SELECT COALESCE(SUM(i.qty),0) FROM reservation_items i WHERE i.reservation_id = r.id) AS item_qty,
         (SELECT group_concat(i.qty || 'x ' || p.name, ', ') FROM reservation_items i
            JOIN products p ON p.id = i.product_id WHERE i.reservation_id = r.id) AS items
    FROM operations o
    LEFT JOIN reservations r ON r.id = o.reservation_id
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN vehicles v ON v.id = o.vehicle_id`;

export function operationsBetween(from: string, to: string, kinds?: string[]) {
  const kindFilter = kinds?.length ? `AND o.kind IN (${kinds.map((k) => `'${k}'`).join(",")})` : "";
  return all<any>(
    `${OPERATION_SELECT}
      WHERE substr(o.scheduled_at,1,10) BETWEEN ? AND ?
        AND o.status <> 'cancelada' ${kindFilter}
      ORDER BY o.scheduled_at`,
    [from, to],
  );
}

export function operationsOn(date: string, kinds?: string[]) {
  return operationsBetween(date, date, kinds);
}

export function lateOperations(kind?: string) {
  const k = kind ? `AND o.kind = '${kind}'` : "";
  return all<any>(
    `${OPERATION_SELECT}
      WHERE substr(o.scheduled_at,1,10) < ? AND o.status IN (${OPEN_OPS}) ${k}
      ORDER BY o.scheduled_at`,
    [today()],
  );
}

export function getOperation(id: number) {
  return one<any>(`${OPERATION_SELECT} WHERE o.id = ?`, [id]);
}

/* ------------------------------ eventos da agenda ---------------------------- */

export type AgendaEvent = {
  id: string;
  kind: string;
  label: string;
  date: string;
  time: string;
  title: string;
  subtitle: string;
  href: string;
  status: string;
};

/** Une operacoes, fretes e eventos de reserva numa linha do tempo unica. */
export function agendaEvents(from: string, to: string): AgendaEvent[] {
  const ops = operationsBetween(from, to).map<AgendaEvent>((o) => ({
    id: `op-${o.id}`,
    kind: o.kind,
    label: o.kind[0].toUpperCase() + o.kind.slice(1),
    date: o.scheduled_at.slice(0, 10),
    time: o.scheduled_at.slice(11, 16),
    title: o.customer ?? "Sem cliente",
    subtitle: [o.reservation_number, o.items].filter(Boolean).join(" - "),
    href: `/operacao/${o.id}`,
    status: o.status,
  }));

  const freights = all<any>(
    `SELECT f.*, c.name AS customer_name FROM freights f LEFT JOIN customers c ON c.id = f.customer_id
      WHERE f.date BETWEEN ? AND ? AND f.status <> 'cancelado' ORDER BY f.date, f.time`,
    [from, to],
  ).map<AgendaEvent>((f) => ({
    id: `frt-${f.id}`,
    kind: "frete",
    label: "Frete",
    date: f.date,
    time: f.time ?? "",
    title: f.customer_name ?? f.contact_name ?? "Frete",
    subtitle: `${f.number} - ${f.origin ?? ""} ate ${f.destination ?? ""}`,
    href: `/fretes/${f.id}`,
    status: f.status,
  }));

  const events = all<any>(
    `SELECT r.*, c.name AS customer_name FROM reservations r JOIN customers c ON c.id = r.customer_id
      WHERE r.event_date BETWEEN ? AND ? AND r.status <> 'cancelada' ORDER BY r.event_date`,
    [from, to],
  ).map<AgendaEvent>((r) => ({
    id: `evt-${r.id}`,
    kind: "evento",
    label: "Evento",
    date: r.event_date,
    time: r.event_time ?? "",
    title: r.customer_name,
    subtitle: `${r.number} - evento do cliente`,
    href: `/reservas/${r.id}`,
    status: r.status,
  }));

  return [...ops, ...freights, ...events].sort((a, b) =>
    a.date === b.date ? (a.time < b.time ? -1 : 1) : a.date < b.date ? -1 : 1,
  );
}

/* -------------------------------- indicadores -------------------------------- */

export function dashboardStats() {
  const d0 = today();
  const weekStart = startOfWeek(d0);
  const weekEnd = addDays(weekStart, 6);
  const mStart = startOfMonth(d0);
  const mEnd = endOfMonth(d0);

  const count = (sql: string, p: any[] = []) => scalar<number>(sql, p);

  const reservasHoje = count(
    `SELECT COUNT(*) FROM reservations WHERE event_date = ? AND status <> 'cancelada'`,
    [d0],
  );
  const reservasSemana = count(
    `SELECT COUNT(*) FROM reservations WHERE event_date BETWEEN ? AND ? AND status <> 'cancelada'`,
    [weekStart, weekEnd],
  );
  const proximas = count(
    `SELECT COUNT(*) FROM reservations WHERE event_date > ? AND status IN (${HOLD})`,
    [d0],
  );
  const confirmadas = count(`SELECT COUNT(*) FROM reservations WHERE status = 'confirmada'`);
  const orcamentosPendentes = count(
    `SELECT COUNT(*) FROM quotes WHERE status IN ('rascunho','enviado','aguardando')`,
  );

  const opCount = (kind: string) =>
    count(
      `SELECT COUNT(*) FROM operations WHERE kind = ? AND substr(scheduled_at,1,10) = ? AND status <> 'cancelada'`,
      [kind, d0],
    );
  const opLate = (kind: string) =>
    count(
      `SELECT COUNT(*) FROM operations WHERE kind = ? AND substr(scheduled_at,1,10) < ? AND status IN (${OPEN_OPS})`,
      [kind, d0],
    );

  const recebidoMes = count(`SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE paid_at BETWEEN ? AND ?`, [
    mStart,
    mEnd,
  ]);
  const faturamentoMes = count(
    `SELECT COALESCE(SUM(total_cents),0) FROM reservations WHERE event_date BETWEEN ? AND ? AND status IN (${ACTIVE})`,
    [mStart, mEnd],
  );
  const fretesMes = count(
    `SELECT COALESCE(SUM(amount_cents),0) FROM freights WHERE date BETWEEN ? AND ? AND status = 'concluido'`,
    [mStart, mEnd],
  );
  const aReceber = count(
    `SELECT COALESCE(SUM(r.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.reservation_id = r.id),0)),0)
       FROM reservations r WHERE r.status IN (${ACTIVE})`,
  );
  const despesasMes = count(`SELECT COALESCE(SUM(amount_cents),0) FROM expenses WHERE date BETWEEN ? AND ?`, [
    mStart,
    mEnd,
  ]);

  const stock = availabilityAll(`${d0}T00:00`, `${d0}T23:59`);
  const disponiveis = stock.reduce((s, p) => s + Math.max(0, p.available), 0);
  const reservados = stock.reduce((s, p) => s + p.reserved, 0);
  const manutencao = stock.reduce((s, p) => s + p.maintenance, 0);
  const baixos = stock.filter((p) => p.low).length;

  const conflitos = count(`SELECT COUNT(*) FROM notifications WHERE type = 'conflito'`);
  const pagamentosPendentes = count(`SELECT COUNT(*) FROM notifications WHERE type = 'pagamento'`);
  const contratosPendentes = count(`SELECT COUNT(*) FROM notifications WHERE type = 'contrato'`);

  return {
    hoje: d0,
    reservas: { hoje: reservasHoje, semana: reservasSemana, proximas, confirmadas, orcamentosPendentes, conflitos },
    operacao: {
      entregas: opCount("entrega"),
      retiradas: opCount("retirada"),
      montagens: opCount("montagem"),
      desmontagens: opCount("desmontagem"),
      entregasAtrasadas: opLate("entrega"),
      retiradasAtrasadas: opLate("retirada"),
    },
    financeiro: {
      faturamentoMes: faturamentoMes + fretesMes,
      recebidoMes,
      aReceber,
      despesasMes,
      lucro: faturamentoMes + fretesMes - despesasMes,
    },
    estoque: { disponiveis, reservados, manutencao, baixos },
    alertas: { pagamentosPendentes, contratosPendentes, conflitos },
  };
}

/* --------------------------------- clientes ---------------------------------- */

export const CUSTOMER_SELECT = `
  SELECT c.*,
         (SELECT COUNT(*) FROM reservations r WHERE r.customer_id = c.id AND r.status <> 'cancelada') AS locacoes,
         (SELECT COUNT(*) FROM reservations r WHERE r.customer_id = c.id AND r.status = 'cancelada') AS canceladas,
         (SELECT COALESCE(SUM(r.total_cents),0) FROM reservations r WHERE r.customer_id = c.id AND r.status IN (${ACTIVE})) AS total_cents,
         (SELECT MAX(r.event_date) FROM reservations r WHERE r.customer_id = c.id AND r.event_date <= date('now','localtime') AND r.status <> 'cancelada') AS ultima,
         (SELECT MIN(r.event_date) FROM reservations r WHERE r.customer_id = c.id AND r.event_date > date('now','localtime') AND r.status <> 'cancelada') AS proxima,
         (SELECT COALESCE(SUM(r.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.reservation_id = r.id),0)),0)
            FROM reservations r WHERE r.customer_id = c.id AND r.status IN (${ACTIVE})) AS saldo_cents
    FROM customers c`;

export function getCustomer(id: number) {
  return one<any>(`${CUSTOMER_SELECT} WHERE c.id = ?`, [id]);
}

/* ------------------------------- busca global -------------------------------- */

export function globalSearch(q: string) {
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, "");
  const phoneLike = digits ? `%${digits}%` : "% %";

  return {
    customers: all<any>(
      `${CUSTOMER_SELECT} WHERE c.name LIKE ? OR c.doc LIKE ? OR replace(replace(replace(replace(c.phone,'(',''),')',''),'-',''),' ','') LIKE ?
        ORDER BY c.name LIMIT 20`,
      [like, like, phoneLike],
    ),
    reservations: all<any>(
      `SELECT r.*, c.name AS customer_name FROM reservations r JOIN customers c ON c.id = r.customer_id
        WHERE r.number LIKE ? OR c.name LIKE ? OR r.address LIKE ? OR r.district LIKE ?
        ORDER BY r.event_date DESC LIMIT 20`,
      [like, like, like, like],
    ),
    quotes: all<any>(
      `SELECT q.*, c.name AS customer_name FROM quotes q JOIN customers c ON c.id = q.customer_id
        WHERE q.number LIKE ? OR c.name LIKE ? ORDER BY q.id DESC LIMIT 20`,
      [like, like],
    ),
    freights: all<any>(
      `SELECT f.*, c.name AS customer_name FROM freights f LEFT JOIN customers c ON c.id = f.customer_id
        WHERE f.number LIKE ? OR f.destination LIKE ? OR f.origin LIKE ? OR c.name LIKE ? OR f.contact_name LIKE ?
        ORDER BY f.date DESC LIMIT 20`,
      [like, like, like, like, like],
    ),
    products: all<any>(
      `SELECT p.*, cat.name AS category FROM products p LEFT JOIN categories cat ON cat.id = p.category_id
        WHERE p.name LIKE ? OR p.code LIKE ? ORDER BY p.name LIMIT 20`,
      [like, like],
    ),
    units: all<any>(
      `SELECT u.*, p.name AS product_name FROM product_units u JOIN products p ON p.id = u.product_id
        WHERE u.code LIKE ? ORDER BY u.code LIMIT 20`,
      [like],
    ),
    contracts: all<any>(
      `SELECT ct.*, r.number AS reservation_number, c.name AS customer_name
         FROM contracts ct JOIN reservations r ON r.id = ct.reservation_id JOIN customers c ON c.id = r.customer_id
        WHERE ct.number LIKE ? OR r.number LIKE ? OR c.name LIKE ? ORDER BY ct.id DESC LIMIT 20`,
      [like, like, like],
    ),
  };
}
