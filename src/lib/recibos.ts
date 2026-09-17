import "server-only";
import { all, insert, one, run } from "./db";
import { getSettings } from "./settings";
import { getCompanySignature } from "./assinatura-empresa";
import { dateBR, docBR, money, phoneBR } from "./format";

/**
 * Recibos de lançamentos financeiros.
 *
 * Um recibo é um COMPROVANTE de dinheiro que já entrou: nunca é fonte da
 * verdade financeira. Os livros seguem sendo payments, financial_entries e
 * deposits — este módulo apenas aponta para eles, guarda um número próprio e
 * estável e o texto montado na emissão. Nenhuma função aqui escreve em
 * qualquer outra tabela, então um erro na geração do recibo nunca pode
 * comprometer o lançamento original: ele já está gravado, e o recibo pode ser
 * tentado de novo quantas vezes for preciso.
 *
 * Idempotência: um lançamento tem UM recibo. Chamar de novo para o mesmo
 * pagamento/caução devolve o recibo já existente, sem criar duplicata. A
 * trava é o banco em si: índice UNIQUE por lançamento e número UNIQUE. Duas
 * emissões simultâneas viram duas corridas; a perdedora quebra na constraint,
 * lê o recibo do vencedor e devolve ele — sem erro para o usuário.
 */

export type ReciboFonte =
  | { tipo: "payment"; paymentId: number }
  | { tipo: "deposit"; depositId: number };

export const ROTULO_FONTE: Record<string, string> = {
  payment: "Pagamento",
  deposit: "Caução",
};

/* ------------------------------------------------------------------ */
/* Numeração                                                           */
/* ------------------------------------------------------------------ */

/**
 * Próximo número de recibo, série própria RCB-001, RCB-002, ...
 *
 * A série é independente de todas as outras do sistema (LIMA-, FRT-, ORC-,
 * CT-, PC- e a REC- das parcelas), exatamente para não emprestar nem tocar na
 * numeração de nenhum documento existente. O INSERT é a trava final: se duas
 * emissões simultâneas sortearam o mesmo número, a segunda quebra na UNIQUE
 * e recomeça do número seguinte, que já nasce do estado mais recente.
 */
async function proximoNumero(): Promise<string> {
  const row = await one<{ n: string }>(
    `SELECT number AS n FROM receipts WHERE number LIKE 'RCB-%' ORDER BY LENGTH(number) DESC, number DESC LIMIT 1`,
  );
  const last = row ? parseInt(row.n.split("-").pop() ?? "0", 10) : 0;
  return `RCB-${String(last + 1).padStart(3, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Emissão                                                             */
/* ------------------------------------------------------------------ */

/**
 * Emite (ou recupera) o recibo de um pagamento ou de uma caução.
 *
 * Erro é `string` com mensagem clara; sucesso é `null`, como nas demais
 * funções do sistema (criarAdiantamento, gerarRecebiveis...). O id do recibo
 * criado/recuperado vem no retorno, para a action redirecionar para a página
 * dele.
 */
export async function emitirRecibo(
  fonte: ReciboFonte,
  opts: { userId?: number; userName?: string } = {},
): Promise<{ erro: string | null; receiptId?: number }> {
  // 1. o lançamento precisa existir e ser elegível (dinheiro que entrou)
  const dados =
    fonte.tipo === "payment" ? await dadosDePagamento(fonte.paymentId) : await dadosDeCaucao(fonte.depositId);
  if ("erro" in dados) return { erro: dados.erro };

  // 2. já tem recibo? devolve o existente, sem duplicar nada
  const coluna = fonte.tipo === "payment" ? "payment_id" : "deposit_id";
  const alvo = fonte.tipo === "payment" ? fonte.paymentId : fonte.depositId;
  const existente = await one<{ id: number }>(`SELECT id FROM receipts WHERE ${coluna} = ?`, [alvo]);
  if (existente) return { erro: null, receiptId: existente.id };

  // 3. monta o snapshot do texto legal com os dados REAIS do lançamento
  const s = await getSettings();
  const body = montarTextoDeclaracao(dados, fonte.tipo === "deposit", s);

  /**
   * A assinatura da empresa entra nos recibos emitidos a partir de agora,
   * quando estiver cadastrada. A flag congela a decisão no momento da emissão:
   * recibos anteriores (coluna NULL) continuam saindo como sempre saíram,
   * mesmo que a assinatura seja cadastrada depois.
   */
  const temAssinaturaEmpresa = (await getCompanySignature()) !== null;

  // 4. grava o recibo; as constraints resolvem a corrida de emissões simultâneas
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const numero = await proximoNumero();
    try {
      const id = await insert(
        `INSERT INTO receipts (number, source_type, payment_id, deposit_id, entry_id, amount_cents, paid_at, method, body, issued_by, issued_by_name, company_signature_included)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          numero,
          fonte.tipo,
          fonte.tipo === "payment" ? fonte.paymentId : null,
          fonte.tipo === "deposit" ? fonte.depositId : null,
          dados.entry_id ?? null,
          dados.amount_cents,
          dados.data,
          dados.method ?? null,
          body,
          opts.userId ?? null,
          opts.userName ?? null,
          temAssinaturaEmpresa ? 1 : 0,
        ],
      );
      return { erro: null, receiptId: id };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      // perdeu a corrida (número ou lançamento): alguém emitiu primeiro —
      // o recibo certo é o do primeiro, devolve ele
      if (msg.includes("UNIQUE")) {
        const deOutro = await one<{ id: number }>(`SELECT id FROM receipts WHERE ${coluna} = ?`, [alvo]);
        if (deOutro) return { erro: null, receiptId: deOutro.id };
        continue;
      }
      return { erro: `Não foi possível gerar o recibo: ${msg}` };
    }
  }
  return { erro: "Não foi possível gerar o recibo. Tente novamente." };
}

/* ------------------------------------------------------------------ */
/* Consulta                                                            */
/* ------------------------------------------------------------------ */

/** Recibo de um pagamento específico, para o botão na lista de pagamentos. */
export async function reciboDePagamento(paymentId: number) {
  return await one<any>(`SELECT id, number FROM receipts WHERE payment_id = ?`, [paymentId]);
}

/** Recibo de uma caução específica, para o botão na seção de caução. */
export async function reciboDeCaucao(depositId: number) {
  return await one<any>(`SELECT id, number FROM receipts WHERE deposit_id = ?`, [depositId]);
}

/** Recibo ligado a um pagamento de adiantamento (payment aponta para a entry). */
export async function reciboDaEntry(entryId: number) {
  return await one<any>(`SELECT id, number FROM receipts WHERE payment_id IN (SELECT id FROM payments WHERE entry_id = ?)`, [entryId]);
}

/**
 * Todos os recibos de uma reserva, do mais novo ao mais antigo.
 *
 * Cobre pagamento direto, pagamento de parcela e pagamento de adiantamento
 * (todos vivem em payments apontando para a reserva) e a caução. Serve para
 * reabrir recibos antigos na tela da reserva, sem módulo novo nenhum.
 */
export async function recibosDaReserva(reservationId: number) {
  return await all(
    `SELECT rc.id, rc.number, rc.source_type, rc.amount_cents, rc.paid_at, rc.created_at,
            rc.payment_id, rc.deposit_id
       FROM receipts rc
       LEFT JOIN payments p ON p.id = rc.payment_id
       LEFT JOIN deposits d ON d.id = rc.deposit_id
      WHERE p.reservation_id = ? OR d.reservation_id = ?
      ORDER BY rc.id DESC`,
    [reservationId, reservationId],
  );
}

/**
 * Dados completos para renderizar a página do recibo.
 *
 * A página mostra os dados REAIS do lançamento (lidos do banco na hora, como
 * o pedido da funcionalidade exige) mais o número do recibo e o texto
 * registrado na emissão. Se o lançamento foi apagado (ex.: reserva excluída),
 * `lancamentoExiste` fica falso e a página explica isso — o recibo em si
 * continua existindo, como comprovante de que a emissão aconteceu.
 */
export async function obterRecibo(id: number) {
  const rec = await one<any>(`SELECT * FROM receipts WHERE id = ?`, [id]);
  if (!rec) return null;

  const s = await getSettings();
  const base = {
    recibo: rec,
    tipo: ROTULO_FONTE[rec.source_type] ?? rec.source_type,
    company: s,
    cliente: null as any,
    reserva: null as any,
    frete: null as any,
    lancamentoExiste: false,
    valorAtual: rec.amount_cents as number,
    dataAtual: rec.paid_at as string,
    methodAtual: rec.method as string | null,
    descricao: null as string | null,
    valorDivergente: false,
  };

  if (rec.source_type === "payment" && rec.payment_id) {
    const p = await one<any>(
      `SELECT p.*, r.number AS reservation_number, r.event_date, r.event_time, r.address, r.district, r.city,
              rc.name AS res_customer_name, rc.doc AS res_customer_doc, rc.phone AS res_customer_phone,
              f.number AS freight_number, f.date AS freight_date, f.origin, f.destination,
              fc.name AS freight_customer_name, fc.doc AS freight_customer_doc, fc.phone AS freight_customer_phone
         FROM payments p
         LEFT JOIN reservations r ON r.id = p.reservation_id
         LEFT JOIN customers rc ON rc.id = r.customer_id
         LEFT JOIN freights f ON f.id = p.freight_id
         LEFT JOIN customers fc ON fc.id = f.customer_id
        WHERE p.id = ?`,
      [rec.payment_id],
    );
    if (p) {
      base.lancamentoExiste = true;
      base.valorAtual = p.amount_cents;
      base.dataAtual = p.paid_at;
      base.methodAtual = p.method;
      base.descricao = p.notes;
      base.cliente = p.reservation_id
        ? { name: p.res_customer_name, doc: p.res_customer_doc, phone: p.res_customer_phone }
        : { name: p.freight_customer_name, doc: p.freight_customer_doc, phone: p.freight_customer_phone };
      base.reserva = p.reservation_id ? p : null;
      base.frete = p.freight_id ? p : null;
      base.valorDivergente = p.amount_cents !== rec.amount_cents;
    }
  }

  if (rec.source_type === "deposit" && rec.deposit_id) {
    const d = await one<any>(
      `SELECT d.*, r.number AS reservation_number, r.event_date, r.event_time, r.address, r.district, r.city,
              c.name AS customer_name, c.doc AS customer_doc, c.phone AS customer_phone
         FROM deposits d
         JOIN reservations r ON r.id = d.reservation_id
         LEFT JOIN customers c ON c.id = r.customer_id
        WHERE d.id = ?`,
      [rec.deposit_id],
    );
    if (d) {
      base.lancamentoExiste = true;
      base.valorAtual = d.amount_cents;
      base.dataAtual = d.received_at ?? rec.paid_at;
      base.methodAtual = d.method;
      base.descricao = d.reason;
      base.cliente = { name: d.customer_name, doc: d.customer_doc, phone: d.customer_phone };
      base.reserva = d;
      base.valorDivergente = d.amount_cents !== rec.amount_cents;
    }
  }

  return base;
}

/* ------------------------------------------------------------------ */
/* Dados do lançamento                                                 */
/* ------------------------------------------------------------------ */

type DadosLancamento = {
  amount_cents: number;
  data: string;
  method: string | null;
  entry_id: number | null;
  customer_name?: string | null;
  reservation_number?: string | null;
  notes?: string | null;
};

/**
 * Lê o pagamento com os dados reais dele (reserva OU frete).
 * Recusa estorno (valor negativo): recibo comprova dinheiro que entrou.
 */
async function dadosDePagamento(paymentId: number): Promise<DadosLancamento | { erro: string }> {
  const p = await one<any>(
    `SELECT p.amount_cents, p.paid_at, p.method, p.entry_id, p.notes,
            r.number AS reservation_number, rc.name AS customer_name,
            f.number AS freight_number, fc.name AS customer_name2
       FROM payments p
       LEFT JOIN reservations r ON r.id = p.reservation_id
       LEFT JOIN customers rc ON rc.id = r.customer_id
       LEFT JOIN freights f ON f.id = p.freight_id
       LEFT JOIN customers fc ON fc.id = f.customer_id
      WHERE p.id = ?`,
    [paymentId],
  );
  if (!p) return { erro: "Pagamento não encontrado." };
  if (p.amount_cents < 0) return { erro: "Não é possível gerar recibo de um estorno." };
  return {
    amount_cents: p.amount_cents,
    data: p.paid_at,
    method: p.method,
    entry_id: p.entry_id,
    reservation_number: p.reservation_number ?? p.freight_number,
    customer_name: p.customer_name ?? p.customer_name2,
    notes: p.notes,
  };
}

/** Lê a caução com os dados reais dela. Só caução recebida tem o que comprovar. */
async function dadosDeCaucao(depositId: number): Promise<DadosLancamento | { erro: string }> {
  const d = await one<any>(
    `SELECT d.amount_cents, d.method, d.received_at, d.status, r.number AS reservation_number, c.name AS customer_name
       FROM deposits d
       JOIN reservations r ON r.id = d.reservation_id
       LEFT JOIN customers c ON c.id = r.customer_id
      WHERE d.id = ?`,
    [depositId],
  );
  if (!d) return { erro: "Caução não encontrada." };
  if (d.status === "nao_recebida") return { erro: "A caução ainda não foi recebida — não há valor a comprovar." };
  if (!d.received_at) return { erro: "Informe a data em que a caução foi recebida antes de gerar o recibo." };
  return {
    amount_cents: d.amount_cents,
    data: d.received_at,
    method: d.method,
    entry_id: null,
    reservation_number: d.reservation_number,
    customer_name: d.customer_name,
  };
}

/* ------------------------------------------------------------------ */
/* Texto do recibo                                                     */
/* ------------------------------------------------------------------ */

/**
 * Declaração legal do recibo, registrada na emissão.
 *
 * Imutável por design: se o cliente mudar de nome ou a empresa trocar de
 * endereço depois, o recibo continua mostrando exatamente o que foi emitido
 * naquele dia — é isso que faz dele um comprovante, e não uma consulta.
 */
function montarTextoDeclaracao(
  v: DadosLancamento,
  ehCaucao: boolean,
  s: Record<string, string>,
): string {
  const empresa = [
    s.company_name,
    s.company_doc ? `CNPJ/CPF ${docBR(s.company_doc)}` : "",
    s.company_address,
    s.company_phone ? `fone ${phoneBR(s.company_phone)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const objeto = ehCaucao
    ? `a título de CAUÇÃO da locação ${v.reservation_number ?? "-"}, valor distinto da locação e devolvível conforme contrato`
    : `referente à locação ${v.reservation_number ?? "-"}`;
  // a observacao do lancamento (ex.: "Adiantamento", "LIMA-001 2/3 - Cliente")
  // entra no comprovante: e ela que identifica o tipo exato do recebimento
  const observacao = v.notes && !/estorno/i.test(v.notes) ? ` Observação: ${v.notes}.` : "";
  return [
    `Recebemos de ${v.customer_name ?? "cliente não identificado"} a importância de ${money(v.amount_cents)}`,
    `${objeto}.`,
    `Data do recebimento: ${dateBR(v.data)}. Forma: ${v.method ?? "não informada"}.${observacao}`,
    empresa ? `Emitido por ${empresa}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* Exclusão (somente o recibo, nunca o lançamento)                     */
/* ------------------------------------------------------------------ */

/**
 * Exclui o recibo, para reemitir do zero em caso de erro de emissão. Não
 * apaga pagamento nem caução: a exclusão aqui é só do comprovante. A action
 * que a chama exige admin.
 */
export async function excluirRecibo(receiptId: number): Promise<boolean> {
  const r = await run(`DELETE FROM receipts WHERE id = ?`, [receiptId]);
  return !!r.meta.changes;
}
