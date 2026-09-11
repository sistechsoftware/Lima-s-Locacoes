import "server-only";
import { availabilityQuery, type AvailabilityQuery } from "./availability-time";
import { type StockOptions } from "./availability-settings";
import { all, one, scalar } from "./db";
import { addDays, endOfMonth, startOfMonth, startOfWeek, today } from "./format";
import { availabilityAll, kitsFromPhysical } from "./stock";
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

export async function operationsBetween(from: string, to: string, kinds?: string[]) {
  const kindFilter = kinds?.length ? `AND o.kind IN (${kinds.map((k) => `'${k}'`).join(",")})` : "";
  return await all<any>(
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

export async function lateOperations(kind?: string) {
  const k = kind ? `AND o.kind = '${kind}'` : "";
  return await all<any>(
    `${OPERATION_SELECT}
      WHERE substr(o.scheduled_at,1,10) < ? AND o.status IN (${OPEN_OPS}) ${k}
      ORDER BY o.scheduled_at`,
    [today()],
  );
}

export async function getOperation(id: number) {
  return await one<any>(`${OPERATION_SELECT} WHERE o.id = ?`, [id]);
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
export async function agendaEvents(from: string, to: string): Promise<AgendaEvent[]> {
  const [opsRaw, freightsRaw, eventsRaw] = await Promise.all([
    operationsBetween(from, to),
    all<any>(
      `SELECT f.*, c.name AS customer_name FROM freights f LEFT JOIN customers c ON c.id = f.customer_id
        WHERE f.date BETWEEN ? AND ? AND f.status <> 'cancelado' ORDER BY f.date, f.time`,
      [from, to],
    ),
    all<any>(
      `SELECT r.*, c.name AS customer_name FROM reservations r JOIN customers c ON c.id = r.customer_id
        WHERE r.event_date BETWEEN ? AND ? AND r.status <> 'cancelada' ORDER BY r.event_date`,
      [from, to],
    ),
  ]);

  const ops = opsRaw.map<AgendaEvent>((o) => ({
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

  const freights = freightsRaw.map<AgendaEvent>((f) => ({
    id: `frt-${f.id}`,
    kind: "frete",
    label: "Frete",
    date: f.date,
    time: f.time ?? "",
    title: f.customer_name ?? f.contact_name ?? "Frete",
    subtitle: `${f.number} · ${f.origin ?? ""} até ${f.destination ?? ""}`,
    href: `/fretes/${f.id}`,
    status: f.status,
  }));

  const events = eventsRaw.map<AgendaEvent>((r) => ({
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

export async function dashboardStats(query: AvailabilityQuery = availabilityQuery(), options: StockOptions = query) {
  const d0 = today();
  const weekStart = startOfWeek(d0);
  const weekEnd = addDays(weekStart, 6);
  const mStart = startOfMonth(d0);
  const mEnd = endOfMonth(d0);

  /*
   * Cada consulta ao D1 e uma ida e volta pela rede, e o banco nao fica
   * necessariamente perto do usuario. Por isso os indicadores do painel sao
   * agrupados em poucas consultas com subselects, em vez de uma por numero:
   * o custo passa a ser dominado pela latencia de uma chamada, e nao de vinte.
   */
  const [contagens, financeiro, ops, stock] = await Promise.all([
    one<any>(
    `SELECT
       (SELECT COUNT(*) FROM reservations WHERE event_date = ?1 AND status <> 'cancelada') AS reservas_hoje,
       (SELECT COUNT(*) FROM reservations WHERE event_date BETWEEN ?2 AND ?3 AND status <> 'cancelada') AS reservas_semana,
       (SELECT COUNT(*) FROM reservations WHERE event_date > ?1 AND status IN (${HOLD})) AS proximas,
       (SELECT COUNT(*) FROM reservations WHERE status = 'confirmada') AS confirmadas,
       (SELECT COUNT(*) FROM quotes WHERE status IN ('rascunho','enviado','aguardando')) AS orcamentos_pendentes,
       (SELECT COUNT(*) FROM notifications WHERE type = 'conflito') AS conflitos,
       (SELECT COUNT(*) FROM notifications WHERE type = 'pagamento') AS pagamentos_pendentes,
       (SELECT COUNT(*) FROM notifications WHERE type = 'contrato') AS contratos_pendentes`,
      [d0, weekStart, weekEnd],
    ),
    one<any>(
    `SELECT
       (SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE paid_at BETWEEN ?1 AND ?2) AS recebido,
       (SELECT COALESCE(SUM(total_cents),0) FROM reservations
         WHERE event_date BETWEEN ?1 AND ?2 AND status IN (${ACTIVE})) AS faturamento,
       (SELECT COALESCE(SUM(amount_cents),0) FROM freights
         WHERE date BETWEEN ?1 AND ?2 AND status IN ('agendado','em_rota','concluido')) AS fretes,
       (SELECT COALESCE(SUM(amount_cents),0) FROM expenses WHERE date BETWEEN ?1 AND ?2) AS despesas,
       (SELECT COALESCE(SUM(r.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.reservation_id = r.id),0)),0)
          FROM reservations r WHERE r.status IN (${ACTIVE})) AS receber_reservas,
       (SELECT COALESCE(SUM(f.amount_cents - COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.freight_id = f.id),0)),0)
          FROM freights f WHERE f.status IN ('agendado','em_rota','concluido')) AS receber_fretes`,
      [mStart, mEnd],
    ),
    /* uma unica leitura resolve as seis contagens de operacao */
    all<{ kind: string; hoje: number; atrasadas: number }>(
    `SELECT kind,
            SUM(CASE WHEN substr(scheduled_at,1,10) = ?1 AND status <> 'cancelada' THEN 1 ELSE 0 END) AS hoje,
            SUM(CASE WHEN substr(scheduled_at,1,10) < ?1 AND status IN (${OPEN_OPS}) THEN 1 ELSE 0 END) AS atrasadas
       FROM operations GROUP BY kind`,
      [d0],
    ),
    availabilityAll(query.from, query.to, null, options),
  ]);

  const porTipo = new Map(ops.map((o) => [o.kind, o]));
  const opHoje = (kind: string) => Number(porTipo.get(kind)?.hoje ?? 0);
  const opAtrasadas = (kind: string) => Number(porTipo.get(kind)?.atrasadas ?? 0);

  const disponiveis = stock.reduce((s, p) => s + Math.max(0, p.available), 0);
  const reservados = stock.reduce((s, p) => s + p.reserved, 0);
  const manutencao = stock.reduce((s, p) => s + p.maintenance, 0);
  const baixos = stock.filter((p) => p.low).length;

  // produtos compostos ativos, derivados do mesmo estoque ja lido acima
  const kits = await kitsFromPhysical(stock);

  const faturamentoMes = Number(financeiro?.faturamento ?? 0) + Number(financeiro?.fretes ?? 0);
  const despesasMes = Number(financeiro?.despesas ?? 0);

  return {
    hoje: d0,
    reservas: {
      hoje: Number(contagens?.reservas_hoje ?? 0),
      semana: Number(contagens?.reservas_semana ?? 0),
      proximas: Number(contagens?.proximas ?? 0),
      confirmadas: Number(contagens?.confirmadas ?? 0),
      orcamentosPendentes: Number(contagens?.orcamentos_pendentes ?? 0),
      conflitos: Number(contagens?.conflitos ?? 0),
    },
    operacao: {
      entregas: opHoje("entrega"),
      retiradas: opHoje("retirada"),
      montagens: opHoje("montagem"),
      desmontagens: opHoje("desmontagem"),
      entregasAtrasadas: opAtrasadas("entrega"),
      retiradasAtrasadas: opAtrasadas("retirada"),
    },
    financeiro: {
      faturamentoMes,
      recebidoMes: Number(financeiro?.recebido ?? 0),
      aReceber: Number(financeiro?.receber_reservas ?? 0) + Number(financeiro?.receber_fretes ?? 0),
      despesasMes,
      lucro: faturamentoMes - despesasMes,
    },
    estoque: { disponiveis, reservados, manutencao, baixos },
    kits,
    alertas: {
      pagamentosPendentes: Number(contagens?.pagamentos_pendentes ?? 0),
      contratosPendentes: Number(contagens?.contratos_pendentes ?? 0),
      conflitos: Number(contagens?.conflitos ?? 0),
    },
  };
}

/* --------------------------------- clientes ---------------------------------- */

// date('now','localtime') devolve UTC no Worker, entao das 21h a meia-noite ele
// ja esta no dia seguinte e uma reserva de amanha entraria como "ultima". O
// deslocamento explicito mantem a conta no fuso de Brasilia em qualquer maquina.
export const CUSTOMER_SELECT = `
  SELECT c.*,
         (SELECT COUNT(*) FROM reservations r WHERE r.customer_id = c.id AND r.status <> 'cancelada') AS locacoes,
         (SELECT COUNT(*) FROM reservations r WHERE r.customer_id = c.id AND r.status = 'cancelada') AS canceladas,
         (SELECT COALESCE(SUM(r.total_cents),0) FROM reservations r WHERE r.customer_id = c.id AND r.status IN (${ACTIVE})) AS total_cents,
         (SELECT MAX(r.event_date) FROM reservations r WHERE r.customer_id = c.id AND r.event_date <= date('now','-3 hours') AND r.status <> 'cancelada') AS ultima,
         (SELECT MIN(r.event_date) FROM reservations r WHERE r.customer_id = c.id AND r.event_date > date('now','-3 hours') AND r.status <> 'cancelada') AS proxima,
         (SELECT COALESCE(SUM(r.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.reservation_id = r.id),0)),0)
            FROM reservations r WHERE r.customer_id = c.id AND r.status IN (${ACTIVE})) AS saldo_cents
    FROM customers c`;

export async function getCustomer(id: number) {
  return await one<any>(`${CUSTOMER_SELECT} WHERE c.id = ?`, [id]);
}

/**
 * Colunas de cliente para as telas de selecao com busca dinamica.
 *
 * Alem do nome, traz o CPF (doc) e os numeros das reservas do cliente, para a
 * busca por digitos. O agregado e uma subconsulta correlacionada: devolve UMA
 * linha por cliente, jamais duplica por causa de varias reservas — a dedupli-
 * cacao final fica por conta de unicosPorId na tela, como segunda barreira.
 */
export const CUSTOMER_PICK_COLUMNS = `
  c.id, c.name, c.doc, c.phone, c.address, c.district, c.city,
  (SELECT group_concat(r2.number) FROM reservations r2
    WHERE r2.customer_id = c.id AND r2.status <> 'cancelada') AS reserva_numeros`;

/* ------------------------------- busca global -------------------------------- */

export async function globalSearch(q: string) {
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, "");
  const phoneLike = digits ? `%${digits}%` : "% %";

  return {
    customers: await all<any>(
      `${CUSTOMER_SELECT} WHERE c.name LIKE ? OR c.doc LIKE ? OR replace(replace(replace(replace(c.phone,'(',''),')',''),'-',''),' ','') LIKE ?
        ORDER BY c.name LIMIT 20`,
      [like, like, phoneLike],
    ),
    reservations: await all<any>(
      `SELECT r.*, c.name AS customer_name FROM reservations r JOIN customers c ON c.id = r.customer_id
        WHERE r.number LIKE ? OR c.name LIKE ? OR r.address LIKE ? OR r.district LIKE ?
        ORDER BY r.event_date DESC LIMIT 20`,
      [like, like, like, like],
    ),
    quotes: await all<any>(
      `SELECT q.*, c.name AS customer_name FROM quotes q JOIN customers c ON c.id = q.customer_id
        WHERE q.number LIKE ? OR c.name LIKE ? ORDER BY q.id DESC LIMIT 20`,
      [like, like],
    ),
    freights: await all<any>(
      `SELECT f.*, c.name AS customer_name FROM freights f LEFT JOIN customers c ON c.id = f.customer_id
        WHERE f.number LIKE ? OR f.destination LIKE ? OR f.origin LIKE ? OR c.name LIKE ? OR f.contact_name LIKE ?
        ORDER BY f.date DESC LIMIT 20`,
      [like, like, like, like, like],
    ),
    products: await all<any>(
      `SELECT p.*, cat.name AS category FROM products p LEFT JOIN categories cat ON cat.id = p.category_id
        WHERE p.name LIKE ? OR p.code LIKE ? ORDER BY p.name LIMIT 20`,
      [like, like],
    ),
    units: await all<any>(
      `SELECT u.*, p.name AS product_name FROM product_units u JOIN products p ON p.id = u.product_id
        WHERE u.code LIKE ? ORDER BY u.code LIMIT 20`,
      [like],
    ),
    contracts: await all<any>(
      `SELECT ct.*, r.number AS reservation_number, c.name AS customer_name
         FROM contracts ct JOIN reservations r ON r.id = ct.reservation_id JOIN customers c ON c.id = r.customer_id
        WHERE ct.number LIKE ? OR r.number LIKE ? OR c.name LIKE ? ORDER BY ct.id DESC LIMIT 20`,
      [like, like, like],
    ),
  };
}
