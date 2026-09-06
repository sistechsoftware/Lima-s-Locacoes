import "server-only";
import { all, insert, nextNumber, one, run, scalar } from "./db";
import { montarParcelas, situacaoParcela } from "./financeiro";
import { money, today } from "./format";

/**
 * Contas a receber.
 *
 * Uma locacao de R$2.000 em 4x nao e R$2.000 em caixa: sao quatro previsoes.
 * Cada parcela vira uma linha em financial_entries; o dinheiro so aparece
 * quando um pagamento e registrado em payments, que continua sendo o unico
 * livro de entradas do sistema.
 *
 * Nada aqui altera reservas ou fretes: o modulo apenas le o total deles e
 * cria as previsoes correspondentes.
 */

export type OrigemRecebivel =
  | { tipo: "locacao"; reservationId: number }
  | { tipo: "frete"; freightId: number };

/** Quanto ja foi recebido de uma parcela, somado dos pagamentos ligados a ela. */
export async function recebidoDaParcela(entryId: number): Promise<number> {
  return await scalar<number>(`SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE entry_id = ?`, [entryId]);
}

/**
 * Cria (ou refaz) as parcelas a receber de uma reserva ou frete.
 *
 * Recusa refazer quando alguma parcela ja tem recebimento, pelo mesmo motivo
 * das compras: reconstruir apagaria dinheiro registrado.
 */
export async function gerarRecebiveis(
  origem: OrigemRecebivel,
  opts: { parcelas: number; primeiroVencimento: string; accountId?: number | null; userId?: number },
): Promise<string | null> {
  const ehLocacao = origem.tipo === "locacao";
  const idOrigem = ehLocacao ? origem.reservationId : origem.freightId;
  const coluna = ehLocacao ? "reservation_id" : "freight_id";

  const doc = ehLocacao
    ? await one<any>(
        `SELECT r.id, r.number, r.total_cents, r.customer_id, c.name AS customer_name
           FROM reservations r JOIN customers c ON c.id = r.customer_id WHERE r.id = ?`,
        [idOrigem],
      )
    : await one<any>(
        `SELECT f.id, f.number, f.amount_cents AS total_cents, f.customer_id, c.name AS customer_name
           FROM freights f LEFT JOIN customers c ON c.id = f.customer_id WHERE f.id = ?`,
        [idOrigem],
      );
  if (!doc) return "Registro nao encontrado.";

  const recebido = await scalar<number>(
    `SELECT COALESCE(SUM(p.amount_cents),0) FROM payments p
       JOIN financial_entries e ON e.id = p.entry_id
      WHERE e.${coluna} = ?`,
    [idOrigem],
  );
  if (recebido > 0) {
    return "Ja existe recebimento lancado nestas parcelas. Estorne antes de refazer o parcelamento.";
  }

  // sinal ou entrada lancados antes do parcelamento ja sao dinheiro em caixa;
  // parcelar o total cheio faria a previsao contar esse dinheiro de novo
  const jaRecebido = await scalar<number>(
    `SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE ${coluna} = ? AND entry_id IS NULL`,
    [idOrigem],
  );
  const aParcelar = doc.total_cents - jaRecebido;

  await run(`DELETE FROM financial_entries WHERE ${coluna} = ? AND direction = 'receber'`, [idOrigem]);
  if (doc.total_cents <= 0) return null;
  if (aParcelar <= 0) {
    return `Nada a parcelar: ${money(jaRecebido)} ja recebidos cobrem o total de ${money(doc.total_cents)}.`;
  }

  const parcelas = montarParcelas(aParcelar, opts.parcelas, opts.primeiroVencimento);
  for (const p of parcelas) {
    const numero = await nextNumber("financial_entries", "REC");
    await insert(
      `INSERT INTO financial_entries
        (number, direction, origin, customer_id, ${coluna}, category, description,
         amount_cents, due_date, installment, installments_total, account_id, created_by)
       VALUES (?,'receber',?,?,?,?,?,?,?,?,?,?,?)`,
      [
        numero,
        ehLocacao ? "locacao" : "frete",
        doc.customer_id,
        idOrigem,
        ehLocacao ? "Locacao" : "Frete",
        `${doc.number}${parcelas.length > 1 ? ` ${p.installment}/${p.installments_total}` : ""}` +
          (doc.customer_name ? ` - ${doc.customer_name}` : ""),
        p.amount_cents,
        p.due_date,
        p.installment,
        p.installments_total,
        opts.accountId ?? null,
        opts.userId ?? null,
      ],
    );
  }
  return null;
}

const ENTRY_SELECT = `
  SELECT e.*,
         COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.entry_id = e.id),0) AS recebido_cents,
         COALESCE((SELECT SUM(x.amount_cents) FROM expenses x WHERE x.entry_id = e.id),0) AS pago_cents,
         c.name AS customer_name, s.name AS supplier_name,
         r.number AS reservation_number, f.number AS freight_number, pu.number AS purchase_number
    FROM financial_entries e
    LEFT JOIN customers c ON c.id = e.customer_id
    LEFT JOIN suppliers s ON s.id = e.supplier_id
    LEFT JOIN reservations r ON r.id = e.reservation_id
    LEFT JOIN freights f ON f.id = e.freight_id
    LEFT JOIN purchases pu ON pu.id = e.purchase_id`;

/** Parcelas de uma reserva ou frete. */
export async function recebiveisDe(origem: OrigemRecebivel) {
  const coluna = origem.tipo === "locacao" ? "reservation_id" : "freight_id";
  const id = origem.tipo === "locacao" ? origem.reservationId : origem.freightId;
  return await all<any>(
    `${ENTRY_SELECT} WHERE e.${coluna} = ? AND e.direction = 'receber' ORDER BY e.installment`,
    [id],
  );
}

export type FiltroEntries = {
  direction: "receber" | "pagar";
  situacao?: "todas" | "abertas" | "vencidas" | "quitadas";
  de?: string;
  ate?: string;
  busca?: string;
  limite?: number;
};

/** Lista de parcelas com a situacao ja resolvida, para as telas de consulta. */
export async function listarEntries(f: FiltroEntries) {
  const where: string[] = ["e.direction = ?"];
  const params: any[] = [f.direction];

  if (f.de && f.ate) {
    where.push("e.due_date BETWEEN ? AND ?");
    params.push(f.de, f.ate);
  }
  if (f.busca) {
    where.push("(e.number LIKE ? OR e.description LIKE ? OR c.name LIKE ? OR s.name LIKE ?)");
    const like = `%${f.busca}%`;
    params.push(like, like, like, like);
  }

  const rows = await all<any>(
    `${ENTRY_SELECT} WHERE ${where.join(" AND ")} ORDER BY e.due_date, e.id LIMIT ?`,
    [...params, f.limite ?? 300],
  );

  const d0 = today();
  const comSituacao = rows.map((e) => {
    const liquidado = f.direction === "receber" ? e.recebido_cents : e.pago_cents;
    return {
      ...e,
      liquidado_cents: liquidado,
      saldo_cents: Math.max(0, e.amount_cents - liquidado),
      situacao: situacaoParcela(e, liquidado, d0),
    };
  });

  if (!f.situacao || f.situacao === "todas") return comSituacao;
  if (f.situacao === "abertas") return comSituacao.filter((e) => e.situacao === "aberta" || e.situacao === "parcial");
  if (f.situacao === "vencidas") return comSituacao.filter((e) => e.situacao === "vencida");
  return comSituacao.filter((e) => e.situacao === "quitada");
}

/** Totais de previsto, liquidado e em atraso, para os cartoes do painel. */
export async function totaisEntries(direction: "receber" | "pagar") {
  const campo = direction === "receber" ? "payments" : "expenses";
  const linha = await one<any>(
    `SELECT
       COALESCE(SUM(e.amount_cents),0) AS previsto,
       COALESCE(SUM((SELECT SUM(m.amount_cents) FROM ${campo} m WHERE m.entry_id = e.id)),0) AS liquidado,
       COALESCE(SUM(CASE WHEN e.due_date < ? THEN e.amount_cents END),0) AS vencendo
     FROM financial_entries e
     WHERE e.direction = ? AND e.status <> 'cancelada'`,
    [today(), direction],
  );

  // atrasado e o que ja venceu e ainda nao foi liquidado
  const vencidas = await all<any>(
    `SELECT e.amount_cents,
            COALESCE((SELECT SUM(m.amount_cents) FROM ${campo} m WHERE m.entry_id = e.id),0) AS liquidado
       FROM financial_entries e
      WHERE e.direction = ? AND e.status <> 'cancelada' AND e.due_date < ?`,
    [direction, today()],
  );
  const atrasado = vencidas.reduce((s, e) => s + Math.max(0, e.amount_cents - e.liquidado), 0);

  const previsto = Number(linha?.previsto ?? 0);
  const liquidado = Number(linha?.liquidado ?? 0);
  return { previsto, liquidado, saldo: Math.max(0, previsto - liquidado), atrasado };
}
