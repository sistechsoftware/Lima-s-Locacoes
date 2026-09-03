import "server-only";
import { all, run } from "./db";
import { addDays, today } from "./format";
import { checkConflicts } from "./stock";
import { holdWindow } from "./stock";

type Alert = {
  dedupe_key: string;
  type: string;
  severity: "info" | "aviso" | "critico";
  title: string;
  body?: string;
  link?: string;
};

function upsert(a: Alert) {
  run(
    `INSERT INTO notifications (type, severity, title, body, link, dedupe_key)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(dedupe_key) DO UPDATE SET
       title = excluded.title, body = excluded.body, severity = excluded.severity, link = excluded.link`,
    [a.type, a.severity, a.title, a.body ?? null, a.link ?? null, a.dedupe_key],
  );
}

/**
 * Recalcula os alertas do sistema.
 * Usa dedupe_key para nao duplicar o mesmo aviso a cada carregamento e remove
 * os alertas que deixaram de ser verdadeiros.
 */
export function rebuildNotifications() {
  const d0 = today();
  const d3 = addDays(d0, 3);
  const keep: string[] = [];
  const push = (a: Alert) => {
    keep.push(a.dedupe_key);
    upsert(a);
  };

  /* operacoes de hoje e atrasadas */
  const ops = all<any>(
    `SELECT o.*, c.name AS customer, r.number
       FROM operations o
       LEFT JOIN reservations r ON r.id = o.reservation_id
       LEFT JOIN customers c ON c.id = r.customer_id
      WHERE o.status NOT IN ('concluida','cancelada')
        AND substr(o.scheduled_at,1,10) <= ?`,
    [d0],
  );
  for (const o of ops) {
    const late = o.scheduled_at.slice(0, 10) < d0;
    push({
      dedupe_key: `op-${o.id}`,
      type: o.kind,
      severity: late ? "critico" : "aviso",
      title: `${late ? "Atrasada" : "Hoje"}: ${o.kind} - ${o.customer ?? "sem cliente"}`,
      body: `${o.number ?? ""} agendada para ${o.scheduled_at.replace("T", " ")}`,
      link: o.reservation_id ? `/reservas/${o.reservation_id}` : "/operacao",
    });
  }

  /* pagamentos pendentes de reservas ja entregues ou com evento passado */
  const unpaid = all<any>(
    `SELECT r.id, r.number, r.event_date, r.total_cents, c.name AS customer,
            (SELECT COALESCE(SUM(amount_cents),0) FROM payments p WHERE p.reservation_id = r.id) AS paid
       FROM reservations r JOIN customers c ON c.id = r.customer_id
      WHERE r.status NOT IN ('cancelada','orcamento')
        AND r.event_date <= ?
        AND r.total_cents > (SELECT COALESCE(SUM(amount_cents),0) FROM payments p WHERE p.reservation_id = r.id)`,
    [d0],
  );
  for (const r of unpaid) {
    push({
      dedupe_key: `pay-${r.id}`,
      type: "pagamento",
      severity: "critico",
      title: `Pagamento pendente - ${r.customer}`,
      body: `${r.number}: saldo de R$ ${((r.total_cents - r.paid) / 100).toFixed(2)}`,
      link: `/reservas/${r.id}`,
    });
  }

  /* reservas proximas ainda como pre-reserva */
  const soon = all<any>(
    `SELECT r.id, r.number, r.event_date, c.name AS customer
       FROM reservations r JOIN customers c ON c.id = r.customer_id
      WHERE r.status = 'pre_reserva' AND r.event_date BETWEEN ? AND ?`,
    [d0, d3],
  );
  for (const r of soon) {
    push({
      dedupe_key: `soon-${r.id}`,
      type: "reserva",
      severity: "aviso",
      title: `Pre-reserva proxima - ${r.customer}`,
      body: `${r.number} para ${r.event_date}. Confirmar com o cliente.`,
      link: `/reservas/${r.id}`,
    });
  }

  /* contratos nao assinados de eventos proximos */
  const contracts = all<any>(
    `SELECT r.id, r.number, r.event_date, c.name AS customer,
            (SELECT ct.status FROM contracts ct WHERE ct.reservation_id = r.id ORDER BY ct.id DESC LIMIT 1) AS cstatus
       FROM reservations r JOIN customers c ON c.id = r.customer_id
      WHERE r.status IN ('confirmada','entregue','em_uso') AND r.event_date BETWEEN ? AND ?`,
    [d0, d3],
  );
  for (const r of contracts) {
    if (r.cstatus === "assinado") continue;
    push({
      dedupe_key: `contract-${r.id}`,
      type: "contrato",
      severity: "aviso",
      title: `Contrato pendente - ${r.customer}`,
      body: `${r.number}: ${r.cstatus ? "contrato " + r.cstatus : "contrato ainda nao gerado"}.`,
      link: `/reservas/${r.id}`,
    });
  }

  /* caucao nao recebida em reservas confirmadas */
  const deposits = all<any>(
    `SELECT r.id, r.number, c.name AS customer, d.amount_cents, d.status
       FROM reservations r
       JOIN customers c ON c.id = r.customer_id
       JOIN deposits d ON d.reservation_id = r.id
      WHERE d.status = 'nao_recebida' AND d.amount_cents > 0
        AND r.status IN ('confirmada','entregue','em_uso','aguardando_retirada')`,
  );
  for (const r of deposits) {
    push({
      dedupe_key: `deposit-${r.id}`,
      type: "caucao",
      severity: "aviso",
      title: `Caucao nao recebida - ${r.customer}`,
      body: `${r.number}: R$ ${(r.amount_cents / 100).toFixed(2)} pendente.`,
      link: `/reservas/${r.id}`,
    });
  }

  /* estoque baixo */
  const low = all<any>(
    `SELECT id, name, total_qty, maintenance_qty, min_qty FROM products
      WHERE active = 1 AND min_qty > 0 AND (total_qty - maintenance_qty) < min_qty`,
  );
  for (const p of low) {
    push({
      dedupe_key: `low-${p.id}`,
      type: "estoque",
      severity: "aviso",
      title: `Estoque baixo: ${p.name}`,
      body: `${p.total_qty - p.maintenance_qty} disponiveis, minimo ${p.min_qty}.`,
      link: `/estoque/${p.id}`,
    });
  }

  /* manutencoes abertas */
  const maint = all<any>(
    `SELECT m.id, m.qty, p.name FROM maintenance m JOIN products p ON p.id = m.product_id WHERE m.status = 'aberta'`,
  );
  for (const m of maint) {
    push({
      dedupe_key: `maint-${m.id}`,
      type: "manutencao",
      severity: "info",
      title: `Manutencao aberta: ${m.name}`,
      body: `${m.qty} unidade(s) fora de operacao.`,
      link: `/estoque`,
    });
  }

  /* conflitos de estoque em reservas futuras */
  for (const r of futureHoldingReservations(d0)) {
    const items = all<any>(`SELECT product_id, qty FROM reservation_items WHERE reservation_id = ?`, [r.id]);
    if (!items.length) continue;
    const w = holdWindow(r);
    const conflicts = checkConflicts(items, w.from, w.to, r.id);
    if (conflicts.length) {
      push({
        dedupe_key: `conflict-${r.id}`,
        type: "conflito",
        severity: "critico",
        title: `Conflito de estoque - ${r.customer}`,
        body: `${r.number}: ${conflicts.map((c) => `${c.product} faltam ${c.missing}`).join("; ")}`,
        link: `/reservas/${r.id}`,
      });
    }
  }

  /* remove alertas que nao se aplicam mais */
  if (keep.length) {
    const placeholders = keep.map(() => "?").join(",");
    run(`DELETE FROM notifications WHERE dedupe_key IS NOT NULL AND dedupe_key NOT IN (${placeholders})`, keep);
  } else {
    run(`DELETE FROM notifications WHERE dedupe_key IS NOT NULL`);
  }
}

function futureHoldingReservations(from: string) {
  return all<any>(
    `SELECT r.id, r.number, r.event_date, r.delivery_at, r.pickup_at, c.name AS customer
       FROM reservations r JOIN customers c ON c.id = r.customer_id
      WHERE r.status IN ('pre_reserva','confirmada') AND r.event_date >= ?
      ORDER BY r.event_date LIMIT 120`,
    [from],
  );
}

export function listNotifications(onlyUnread = false) {
  return all<any>(
    `SELECT * FROM notifications ${onlyUnread ? "WHERE read_at IS NULL" : ""}
      ORDER BY CASE severity WHEN 'critico' THEN 0 WHEN 'aviso' THEN 1 ELSE 2 END, id DESC
      LIMIT 200`,
  );
}

export function unreadCount(): number {
  const r = all<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL`);
  return r[0]?.n ?? 0;
}
