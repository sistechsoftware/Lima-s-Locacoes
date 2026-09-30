import "server-only";
import { all, batch, one } from "./db";
import { descricaoTransferencia, validarTransferencia } from "./financeiro";
import { money } from "./format";

/**
 * Transferencia de valores entre contas.
 *
 * Um unico evento logico do caixa: o lado de saida e um pagamento NEGATIVO na
 * conta de origem e o de entrada, o pagamento POSITIVO na conta de destino.
 * Os dois lados compartilham o transfer_group e apontam um para o outro.
 *
 * Nao existe receita e despesa artificial: a receita do sistema e o livro
 * payments, e o lancamento negativo nao aumenta patrimonio nenhum. Os
 * indicadores (dashboard, relatorios, aba Entradas) excluem transfer_group IS
 * NOT NULL, entao a transferencia nao aparece como receita. O livreto de
 * expenses fica intocado: transferencia nao e despesa.
 *
 * A gravacao usa batch() do D1, que e transacao unica: ou os dois lados entram
 * juntos, ou nada entra. E o predicado de edicao/exclusao exige transfer_group
 * preenchido, para nunca alcançar um pagamento comum por engano.
 */

export type DadosTransferencia = {
  origemId: number;
  destinoId: number;
  valorCents: number;
  /** Data do calendario (YYYY-MM-DD), no fuso do negocio. */
  data: string;
  /** Observacao livre do operador; entra apos a descricao automatica. */
  observacao?: string;
  userId: number;
};

type Lado = {
  sql: string;
  params: any[];
};

/** Monta os dois lancamentos do evento: debito na origem, credito no destino. */
function ladosDoEvento(
  t: DadosTransferencia,
  grupo: string,
  nomes: { origem: string; destino: string },
): Lado[] {
  const sufixo = t.observacao?.trim() ? ` | ${t.observacao.trim()}` : "";
  const saida = descricaoTransferencia("saida", nomes.destino) + sufixo;
  const entrada = descricaoTransferencia("entrada", nomes.origem) + sufixo;

  return [
    {
      sql: `INSERT INTO payments (reservation_id, freight_id, amount_cents, method, paid_at, notes, account_id, created_by, transfer_group)
            VALUES (NULL,NULL,?, 'transferencia', ?, ?, ?, ?, ?)`,
      params: [-t.valorCents, t.data, saida, t.origemId, t.userId, grupo],
    },
    {
      sql: `INSERT INTO payments (reservation_id, freight_id, amount_cents, method, paid_at, notes, account_id, created_by, transfer_group)
            VALUES (NULL,NULL,?, 'transferencia', ?, ?, ?, ?, ?)`,
      params: [t.valorCents, t.data, entrada, t.destinoId, t.userId, grupo],
    },
  ];
}

async function nomesDasContas(origemId: number, destinoId: number) {
  const a = await one<any>(`SELECT id, name FROM financial_accounts WHERE id = ?`, [origemId]);
  const b = await one<any>(`SELECT id, name FROM financial_accounts WHERE id = ?`, [destinoId]);
  if (!a || !b) return null;
  return { origem: a.name, destino: b.name };
}

/**
 * Grava a transferencia completa e devolve o id do lado de entrada.
 *
 * Primeiro os INSERT dentro do batch, depois o cross-reference: o D1 nao
 * resolve o id dentro do mesmo batch, entao o UPDATE dos pares vem depois. Se
 * algo falhar no meio, os dois lados continuam encontraveis pelo mesmo
 * transfer_group — e consertavel com um UPDATE, sem orphanos.
 */
export async function criarTransferencia(t: DadosTransferencia): Promise<{ id: number; grupo: string } | { erro: string }> {
  const erro = validarTransferencia(t.origemId, t.destinoId, t.valorCents, t.data);
  if (erro) return { erro };

  const nomes = await nomesDasContas(t.origemId, t.destinoId);
  if (!nomes) return { erro: "Conta de origem ou destino não encontrada." };

  const grupo = `TF-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [saida, entrada] = ladosDoEvento(t, grupo, nomes);

  const rs = await batch([saida, entrada]);
  const idSaida = Number(rs[0]?.meta?.last_row_id ?? 0);
  const idEntrada = Number(rs[1]?.meta?.last_row_id ?? 0);
  if (!idSaida || !idEntrada) return { erro: "A transferência não foi gravada. Nada foi lançado; tente novamente." };

  await batch([
    { sql: `UPDATE payments SET transfer_counterpart_id = ? WHERE id = ? AND transfer_group = ?`, params: [idEntrada, idSaida, grupo] },
    { sql: `UPDATE payments SET transfer_counterpart_id = ? WHERE id = ? AND transfer_group = ?`, params: [idSaida, idEntrada, grupo] },
  ]);

  return { id: idEntrada, grupo };
}

/**
 * Os dois lados do evento, pela chave do grupo.
 *
 * `amount_cents < 0` identifica a origem: o sinal e o proprio debito, e nao
 * um texto que alguem pode ter editado.
 */
async function ladosDoGrupo(grupo: string): Promise<{ saida: any; entrada: any } | null> {
  const saida = await one<any>(`SELECT * FROM payments WHERE transfer_group = ? AND amount_cents < 0`, [grupo]);
  const entrada = await one<any>(`SELECT * FROM payments WHERE transfer_group = ? AND amount_cents >= 0`, [grupo]);
  if (!saida || !entrada) return null;
  return { saida, entrada };
}

/**
 * Edita valor, data, contas e observacao de uma transferencia inteira.
 *
 * A regra e a diferenca, nao apagar e recriar: os ids originais sobrevivem
 * (recibos, auditoria e atalhos que apontam para eles continuam validos) e
 * uma falha no meio da edicao nunca deixa so um lado na tela. O sinal dos
 * valores continua mandando: saida negativa, entrada positiva.
 */
export async function editarTransferencia(
  grupo: string,
  t: DadosTransferencia,
): Promise<{ ok: true } | { erro: string }> {
  const erro = validarTransferencia(t.origemId, t.destinoId, t.valorCents, t.data);
  if (erro) return { erro };

  const lados = await ladosDoGrupo(grupo);
  if (!lados) return { erro: "Transferência não encontrada." };

  const nomes = await nomesDasContas(t.origemId, t.destinoId);
  if (!nomes) return { erro: "Conta de origem ou destino não encontrada." };

  const sufixo = t.observacao?.trim() ? ` | ${t.observacao.trim()}` : "";
  await batch([
    {
      sql: `UPDATE payments
              SET amount_cents = ?, paid_at = ?, account_id = ?, notes = ?
            WHERE id = ? AND transfer_group = ? AND transfer_counterpart_id IS NOT NULL`,
      params: [-t.valorCents, t.data, t.origemId, descricaoTransferencia("saida", nomes.destino) + sufixo, lados.saida.id, grupo],
    },
    {
      sql: `UPDATE payments
              SET amount_cents = ?, paid_at = ?, account_id = ?, notes = ?
            WHERE id = ? AND transfer_group = ? AND transfer_counterpart_id IS NOT NULL`,
      params: [t.valorCents, t.data, t.destinoId, descricaoTransferencia("entrada", nomes.origem) + sufixo, lados.entrada.id, grupo],
    },
  ]);
  return { ok: true };
}

/**
 * Reverte a transferencia removendo os DOIS lados de uma vez.
 *
 * batch() e transacao: ou os dois saem, ou nenhum sai — nunca fica um lado
 * orfao contando sozinho no saldo de uma conta.
 */
export async function excluirTransferencia(grupo: string): Promise<{ ok: true } | { erro: string }> {
  const lados = await ladosDoGrupo(grupo);
  if (!lados) return { erro: "Transferência não encontrada." };

  await batch([
    { sql: `DELETE FROM payments WHERE id = ? AND transfer_group = ? AND amount_cents < 0`, params: [lados.saida.id, grupo] },
    { sql: `DELETE FROM payments WHERE id = ? AND transfer_group = ? AND amount_cents >= 0`, params: [lados.entrada.id, grupo] },
  ]);
  return { ok: true };
}

/**
 * Lista os grupos ainda completos, do mais recente ao mais antigo.
 *
 * O grupo com apenas um lado (falha historica, ou lado apagado isoladamente)
 * fica fora da lista ate ser consertado: aparecer pela metade na tela seria
 * pior, porque a exclusao da tela removeria so o que ela enxerga.
 */
export async function listarTransferencias(limite = 100) {
  const grupos = await all<any>(
    `SELECT transfer_group AS grupo,
            MIN(CASE WHEN amount_cents < 0 THEN account_id END) AS origem_id,
            MAX(CASE WHEN amount_cents >= 0 THEN account_id END) AS destino_id,
            MIN(CASE WHEN amount_cents < 0 THEN amount_cents END) AS saida_cents,
            MAX(CASE WHEN amount_cents >= 0 THEN amount_cents END) AS entrada_cents,
            MIN(paid_at) AS data,
            MIN(CASE WHEN amount_cents < 0 THEN notes END) AS notes_saida,
            MAX(CASE WHEN amount_cents >= 0 THEN notes END) AS notes_entrada,
            COUNT(*) AS lados
       FROM payments
      WHERE transfer_group IS NOT NULL
      GROUP BY transfer_group
      HAVING COUNT(*) = 2
      ORDER BY data DESC, grupo DESC
      LIMIT ?`,
    [limite],
  );
  if (!grupos.length) return [];

  // nomes no momento da listagem: a descricao gravada ja carrega o nome da
  // epoca; aqui so complementa para o filtro atual ficar legivel
  const contas = await all<any>(`SELECT id, name, is_cash_account, active FROM financial_accounts ORDER BY name COLLATE NOCASE`);
  const nomeDe = new Map<number, string>(contas.map((c: any) => [c.id, c.name]));

  return grupos.map((g: any) => ({
    grupo: g.grupo,
    origem_id: g.origem_id,
    destino_id: g.destino_id,
    origem_nome: nomeDe.get(g.origem_id) ?? "conta removida",
    destino_nome: nomeDe.get(g.destino_id) ?? "conta removida",
    valor_cents: Math.abs(Number(g.saida_cents ?? 0)) || Number(g.entrada_cents ?? 0),
    data: g.data,
    observacao: extrairObservacao(g.notes_saida, g.notes_entrada),
    descricao_saida: g.notes_saida,
    descricao_entrada: g.notes_entrada,
  }));
}

/** A observacao do operador vem depois do " | " na descricao gravada. */
function extrairObservacao(...notas: (string | null | undefined)[]): string {
  for (const n of notas) {
    if (!n) continue;
    const i = n.indexOf(" | ");
    if (i >= 0) return n.slice(i + 3);
  }
  return "";
}

/** Busca um grupo completo para os fluxos de editar/excluir. */
export async function transferenciaDoGrupo(grupo: string) {
  const lados = await ladosDoGrupo(grupo);
  if (!lados) return null;
  return {
    grupo,
    origem_id: lados.saida.account_id,
    destino_id: lados.entrada.account_id,
    valor_cents: Math.abs(lados.entrada.amount_cents),
    data: lados.entrada.paid_at,
    observacao: extrairObservacao(lados.saida.notes, lados.entrada.notes),
  };
}
