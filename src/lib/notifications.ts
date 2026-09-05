import "server-only";
import { all, run } from "./db";
import { addDays, today } from "./format";
import { scanConflicts } from "./stock";

type Alert = {
  dedupe_key: string;
  type: string;
  severity: "info" | "aviso" | "critico";
  title: string;
  body?: string;
  link?: string;
};

async function upsert(a: Alert) {
  await run(
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
export async function rebuildNotifications() {
  const d0 = today();
  const d3 = addDays(d0, 3);
  const keep: string[] = [];
  const push = async (a: Alert) => {
    keep.push(a.dedupe_key);
    await upsert(a);
  };

  /* operacoes de hoje e atrasadas */
  const ops = await all<any>(
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
    await push({
      dedupe_key: `op-${o.id}`,
      type: o.kind,
      severity: late ? "critico" : "aviso",
      title: `${late ? "Atrasada" : "Hoje"}: ${o.kind} - ${o.customer ?? "sem cliente"}`,
      body: `${o.number ?? ""} agendada para ${o.scheduled_at.replace("T", " ")}`,
      link: o.reservation_id ? `/reservas/${o.reservation_id}` : "/operacao",
    });
  }

  /* pagamentos pendentes de reservas ja entregues ou com evento passado */
  const unpaid = await all<any>(
    `SELECT r.id, r.number, r.event_date, r.total_cents, c.name AS customer,
            (SELECT COALESCE(SUM(amount_cents),0) FROM payments p WHERE p.reservation_id = r.id) AS paid
       FROM reservations r JOIN customers c ON c.id = r.customer_id
      WHERE r.status NOT IN ('cancelada','orcamento')
        AND r.event_date <= ?
        AND r.total_cents > (SELECT COALESCE(SUM(amount_cents),0) FROM payments p WHERE p.reservation_id = r.id)`,
    [d0],
  );
  for (const r of unpaid) {
    await push({
      dedupe_key: `pay-${r.id}`,
      type: "pagamento",
      severity: "critico",
      title: `Pagamento pendente - ${r.customer}`,
      body: `${r.number}: saldo de R$ ${((r.total_cents - r.paid) / 100).toFixed(2)}`,
      link: `/reservas/${r.id}`,
    });
  }

  /* reservas proximas ainda como pre-reserva */
  const soon = await all<any>(
    `SELECT r.id, r.number, r.event_date, c.name AS customer
       FROM reservations r JOIN customers c ON c.id = r.customer_id
      WHERE r.status = 'pre_reserva' AND r.event_date BETWEEN ? AND ?`,
    [d0, d3],
  );
  for (const r of soon) {
    await push({
      dedupe_key: `soon-${r.id}`,
      type: "reserva",
      severity: "aviso",
      title: `Pre-reserva proxima - ${r.customer}`,
      body: `${r.number} para ${r.event_date}. Confirmar com o cliente.`,
      link: `/reservas/${r.id}`,
    });
  }

  /* contratos nao assinados de eventos proximos */
  const contracts = await all<any>(
    `SELECT r.id, r.number, r.event_date, c.name AS customer,
            (SELECT ct.status FROM contracts ct WHERE ct.reservation_id = r.id ORDER BY ct.id DESC LIMIT 1) AS cstatus
       FROM reservations r JOIN customers c ON c.id = r.customer_id
      WHERE r.status IN ('confirmada','entregue','em_uso') AND r.event_date BETWEEN ? AND ?`,
    [d0, d3],
  );
  for (const r of contracts) {
    if (r.cstatus === "assinado") continue;
    await push({
      dedupe_key: `contract-${r.id}`,
      type: "contrato",
      severity: "aviso",
      title: `Contrato pendente - ${r.customer}`,
      body: `${r.number}: ${r.cstatus ? "contrato " + r.cstatus : "contrato ainda nao gerado"}.`,
      link: `/reservas/${r.id}`,
    });
  }

  /* caucao nao recebida em reservas confirmadas */
  const deposits = await all<any>(
    `SELECT r.id, r.number, c.name AS customer, d.amount_cents, d.status
       FROM reservations r
       JOIN customers c ON c.id = r.customer_id
       JOIN deposits d ON d.reservation_id = r.id
      WHERE d.status = 'nao_recebida' AND d.amount_cents > 0
        AND r.status IN ('confirmada','entregue','em_uso','aguardando_retirada')`,
  );
  for (const r of deposits) {
    await push({
      dedupe_key: `deposit-${r.id}`,
      type: "caucao",
      severity: "aviso",
      title: `Caucao nao recebida - ${r.customer}`,
      body: `${r.number}: R$ ${(r.amount_cents / 100).toFixed(2)} pendente.`,
      link: `/reservas/${r.id}`,
    });
  }

  /* estoque baixo */
  const low = await all<any>(
    // kits nao tem estoque proprio: o alerta olha somente os produtos fisicos
    `SELECT id, name, total_qty, maintenance_qty, min_qty FROM products
      WHERE active = 1 AND kind <> 'kit' AND min_qty > 0 AND (total_qty - maintenance_qty) < min_qty`,
  );
  for (const p of low) {
    await push({
      dedupe_key: `low-${p.id}`,
      type: "estoque",
      severity: "aviso",
      title: `Estoque baixo: ${p.name}`,
      body: `${p.total_qty - p.maintenance_qty} disponiveis, minimo ${p.min_qty}.`,
      link: `/estoque/${p.id}`,
    });
  }

  /* manutencoes abertas */
  const maint = await all<any>(
    `SELECT m.id, m.qty, p.name FROM maintenance m JOIN products p ON p.id = m.product_id WHERE m.status = 'aberta'`,
  );
  for (const m of maint) {
    await push({
      dedupe_key: `maint-${m.id}`,
      type: "manutencao",
      severity: "info",
      title: `Manutencao aberta: ${m.name}`,
      body: `${m.qty} unidade(s) fora de operacao.`,
      link: `/estoque`,
    });
  }

  /* conflitos de estoque em reservas futuras (uma varredura, sem N+1) */
  for (const r of await scanConflicts(d0)) {
    await push({
      dedupe_key: `conflict-${r.reservation_id}`,
      type: "conflito",
      severity: "critico",
      title: `Conflito de estoque - ${r.customer}`,
      body: `${r.number}: ${r.faltas.map((f) => `${f.product} faltam ${f.missing}`).join("; ")}`,
      link: `/reservas/${r.reservation_id}`,
    });
  }

  /* remove alertas que nao se aplicam mais */
  if (keep.length) {
    const placeholders = keep.map(() => "?").join(",");
    await run(`DELETE FROM notifications WHERE dedupe_key IS NOT NULL AND dedupe_key NOT IN (${placeholders})`, keep);
  } else {
    await run(`DELETE FROM notifications WHERE dedupe_key IS NOT NULL`);
  }
}

export async function listNotifications(onlyUnread = false) {
  return await all<any>(
    `SELECT * FROM notifications ${onlyUnread ? "WHERE read_at IS NULL" : ""}
      ORDER BY CASE severity WHEN 'critico' THEN 0 WHEN 'aviso' THEN 1 ELSE 2 END, id DESC
      LIMIT 200`,
  );
}

export async function unreadCount(): Promise<number> {
  const r = await all<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL`);
  return r[0]?.n ?? 0;
}
