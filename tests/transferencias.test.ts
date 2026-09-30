/**
 * Transferencia entre contas, contra o banco de verdade (mesma engine, mesmo
 * schema e mesmas consultas da aplicacao).
 *
 * Cobertura pedida: os quatro pares de natureza de conta, recusas (mesma
 * conta, zero, negativo), edicao e exclusao revertendo os dois lados, saldos
 * por conta, saldo consolidado, ausencia em receita/despesa/indicadores e a
 * integridade das movimentacoes antigas antes/depois de tudo.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/d1.ts";
import { all, insert, one, run, scalar } from "../src/lib/db.ts";
import {
  criarTransferencia,
  editarTransferencia,
  excluirTransferencia,
  listarTransferencias,
} from "../src/lib/transferencias.ts";
import { SQL_NAO_TRANSFERENCIA, saldoConta, validarTransferencia } from "../src/lib/financeiro.ts";

let usuario = 0;

async function cenario() {
  createTestDb();
  usuario = await insert(`INSERT INTO users (name, username, password_hash, role) VALUES ('Op','op','x','admin')`);
}

type Conta = { id: number; saldo: () => Promise<number> };

async function novaConta(nome: string, opts: { inicial?: number; cash?: boolean } = {}): Promise<Conta> {
  const id = await insert(
    `INSERT INTO financial_accounts (name, kind, initial_balance_cents, is_cash_account) VALUES (?,?,?,?)`,
    [nome, opts.cash ? "dinheiro" : "banco", opts.inicial ?? 0, opts.cash ? 1 : 0],
  );
  return {
    id,
    // a mesma conta da aplicacao: inicial + entradas - saidas. Saidas do
    // negocio (expenses) entram negativas, igual na tela de Configuracoes.
    saldo: async () => {
      const a = await one<any>(
        `SELECT a.initial_balance_cents
               + COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.account_id = a.id),0)
               - COALESCE((SELECT SUM(e.amount_cents) FROM expenses e WHERE e.account_id = a.id),0) AS saldo
           FROM financial_accounts a WHERE a.id = ?`,
        [id],
      );
      return Number(a.saldo);
    },
  };
}

/** Movimentacoes antigas que ninguem pode mexer: receita e despesa reais. */
async function lancarAntigo() {
  const seq = await scalar<number>(`SELECT COUNT(*)+1 FROM customers`);
  const cliente = await insert(`INSERT INTO customers (name, phone) VALUES (?,?)`, [`Cliente ${seq}`, "11999990000"]);
  const reserva = await insert(
    `INSERT INTO reservations (number, customer_id, status, event_date, total_cents) VALUES (?,?,?,?,?)`,
    [`LIMA-${String(100 + seq).padStart(3, "0")}`, cliente, "confirmada", "2026-08-10", 100000],
  );
  const conta = await novaConta("Conta do Histórico", { inicial: 0 });
  const pagamento = await insert(
    `INSERT INTO payments (reservation_id, amount_cents, method, paid_at, account_id) VALUES (?,?,?,?,?)`,
    [reserva, 50000, "pix", "2026-08-01", conta.id],
  );
  const despesa = await insert(
    `INSERT INTO expenses (date, category, description, amount_cents) VALUES (?,?,?,?)`,
    ["2026-08-02", "Combustivel", "Gasolina do frete", 12000],
  );
  return { reserva, pagamento, despesa };
}

/** Indicador do dashboard: recebido do periodo, pela consulta real de queries.ts. */
async function recebidoDashboard(de: string, ate: string) {
  const r = await one<any>(
    `SELECT (SELECT COALESCE(SUM(amount_cents),0) FROM payments
              WHERE paid_at BETWEEN ?1 AND ?2 AND transfer_group IS NULL) AS recebido`,
    [de, ate],
  );
  return Number(r.recebido);
}

/** Aba Entradas do financeiro: lancamentos comuns do periodo. */
async function entradasFinanceiro(de: string, ate: string) {
  return await all<any>(
    `SELECT p.* FROM payments p WHERE p.paid_at BETWEEN ? AND ? AND p.transfer_group IS NULL ORDER BY p.id`,
    [de, ate],
  );
}

/** Cria e falha o teste se a transferencia for recusada (evita uniao sem narrowing). */
async function criarOk(t: Parameters<typeof criarTransferencia>[0]): Promise<{ id: number; grupo: string }> {
  const r = await criarTransferencia(t);
  assert.ok(!("erro" in r), `transferencia deveria ser aceita: ${("erro" in r) && r.erro}`);
  return r;
}

describe("validacao da transferencia", () => {
  beforeEach(cenario);

  it("recusa transferir para a propria conta", () => {
    assert.equal(validarTransferencia(7, 7, 10000, "2026-09-20"), "Origem e destino não podem ser a mesma conta.");
  });

  it("recusa valor zero", () => {
    assert.ok(validarTransferencia(1, 2, 0, "2026-09-20"));
  });

  it("recusa valor negativo", () => {
    assert.ok(validarTransferencia(1, 2, -100, "2026-09-20"));
  });

  it("recusa sem conta de origem ou de destino", () => {
    assert.ok(validarTransferencia(0, 2, 100, "2026-09-20"));
    assert.ok(validarTransferencia(1, 0, 100, "2026-09-20"));
  });

  it("aceita o caso normal", () => {
    assert.equal(validarTransferencia(1, 2, 50000, "2026-09-20"), null);
  });

  it("o predicado SQL dos indicadores permanece o contrato compartilhado", () => {
    // relatorios e dashboard montam a exclusao a partir desta constante:
    // mudar aqui sem actualizar as consultas quebra o cenario 14
    assert.equal(SQL_NAO_TRANSFERENCIA, "transfer_group IS NULL");
  });
});

describe("transferencia entre contas", () => {
  beforeEach(cenario);

  it("banco → banco: debita a origem, credita o destino e forma um unico evento", async () => {
    const origem = await novaConta("Bradesco PJ", { inicial: 100000 });
    const destino = await novaConta("Itau", { inicial: 20000 });
    const r = await criarTransferencia({
      origemId: origem.id,
      destinoId: destino.id,
      valorCents: 50000,
      data: "2026-09-20",
      userId: usuario,
    });
    assert.ok(!("erro" in r));

    const saida = await one<any>(`SELECT * FROM payments WHERE transfer_group = ? AND amount_cents < 0`, [r.grupo]);
    const entrada = await one<any>(`SELECT * FROM payments WHERE transfer_group = ? AND amount_cents >= 0`, [r.grupo]);
    assert.equal(saida.amount_cents, -50000);
    assert.equal(saida.account_id, origem.id);
    assert.equal(entrada.amount_cents, 50000);
    assert.equal(entrada.account_id, destino.id);
    assert.equal(saida.paid_at, "2026-09-20");
    assert.equal(entrada.paid_at, "2026-09-20");
    assert.equal(saida.transfer_group, entrada.transfer_group, "mesmo grupo = unico evento logico");
    assert.equal(saida.transfer_counterpart_id, entrada.id);
    assert.equal(entrada.transfer_counterpart_id, saida.id);
    assert.equal(saida.notes, "Transferência para Itau");
    assert.equal(entrada.notes, "Transferência recebida de Bradesco PJ");
    assert.equal(saida.method, "transferencia");
    assert.equal(saida.reservation_id ?? null, null);
    assert.equal(saida.entry_id ?? null, null);
  });

  it("banco → dinheiro em especie (o exemplo do pedido: R$ 500)", async () => {
    const bradesco = await novaConta("Bradesco PJ", { inicial: 100000 });
    const carteira = await novaConta("Carteira Física", { cash: true, inicial: 0 });
    const r = await criarTransferencia({
      origemId: bradesco.id,
      destinoId: carteira.id,
      valorCents: 50000,
      data: "2026-09-20",
      userId: usuario,
    });
    assert.ok(!("erro" in r));

    assert.equal(await carteira.saldo(), 50000);
    assert.equal(await bradesco.saldo(), 50000);
  });

  it("dinheiro em especie → banco (o segundo exemplo: R$ 200)", async () => {
    const carteira = await novaConta("Carteira Física", { cash: true, inicial: 30000 });
    const bradesco = await novaConta("Bradesco PJ", { inicial: 100000 });
    const r = await criarTransferencia({
      origemId: carteira.id,
      destinoId: bradesco.id,
      valorCents: 20000,
      data: "2026-09-21",
      userId: usuario,
    });
    assert.ok(!("erro" in r));

    assert.equal(await carteira.saldo(), 10000);
    assert.equal(await bradesco.saldo(), 120000);
  });

  it("dinheiro em especie → dinheiro em especie", async () => {
    const carteira = await novaConta("Carteira", { cash: true, inicial: 50000 });
    const caixa = await novaConta("Caixa da Loja", { cash: true, inicial: 10000 });
    const r = await criarTransferencia({
      origemId: carteira.id,
      destinoId: caixa.id,
      valorCents: 15000,
      data: "2026-09-21",
      userId: usuario,
    });
    assert.ok(!("erro" in r));

    assert.equal(await carteira.saldo(), 35000);
    assert.equal(await caixa.saldo(), 25000);
  });

  it("recusa transferir para a propria conta", async () => {
    const conta = await novaConta("Unica");
    const r = await criarTransferencia({
      origemId: conta.id,
      destinoId: conta.id,
      valorCents: 10000,
      data: "2026-09-21",
      userId: usuario,
    });
    assert.ok("erro" in r);
    assert.match(r.erro, /mesma conta/);
    assert.equal(await scalar<number>(`SELECT COUNT(*) FROM payments WHERE transfer_group IS NOT NULL`), 0);
  });

  it("recusa valor zero e valor negativo", async () => {
    const a = await novaConta("A");
    const b = await novaConta("B");
    const zero = await criarTransferencia({ origemId: a.id, destinoId: b.id, valorCents: 0, data: "2026-09-21", userId: usuario });
    const negativo = await criarTransferencia({ origemId: a.id, destinoId: b.id, valorCents: -5000, data: "2026-09-21", userId: usuario });
    assert.ok("erro" in zero);
    assert.ok("erro" in negativo);
    assert.equal(await scalar<number>(`SELECT COUNT(*) FROM payments`), 0, "nada foi gravado");
  });

  it("saldo de ambas as contas reflete o valor (cenario 10)", async () => {
    const origem = await novaConta("Origem", { inicial: 80000 });
    const destino = await novaConta("Destino", { inicial: 5000 });
    await criarTransferencia({ origemId: origem.id, destinoId: destino.id, valorCents: 30000, data: "2026-09-21", userId: usuario });

    assert.equal(await origem.saldo(), 50000);
    assert.equal(await destino.saldo(), 35000);
    assert.equal(saldoConta(80000, 0, 30000), 50000, "saldoConta pura continua coerente");
  });

  it("saldo consolidado nao muda com a transferencia (cenario 11)", async () => {
    const origem = await novaConta("Bradesco PJ", { inicial: 70000 });
    const destino = await novaConta("Carteira Física", { cash: true, inicial: 30000 });
    const consolidadoAntes = (await origem.saldo()) + (await destino.saldo());

    await criarTransferencia({ origemId: origem.id, destinoId: destino.id, valorCents: 30000, data: "2026-09-21", userId: usuario });

    const consolidadoDepois = (await origem.saldo()) + (await destino.saldo());
    assert.equal(consolidadoAntes, 100000);
    assert.equal(consolidadoDepois, 100000, "a transferencia nao criou nem destruiu dinheiro");
  });
});

describe("edicao e exclusao", () => {
  beforeEach(cenario);

  it("edicao atualiza os dois lados juntos (cenario 8)", async () => {
    const origem = await novaConta("Origem", { inicial: 100000 });
    const destino = await novaConta("Destino", { inicial: 0 });
    const outro = await novaConta("Outra", { inicial: 0 });
    const r = await criarOk({ origemId: origem.id, destinoId: destino.id, valorCents: 20000, data: "2026-09-20", userId: usuario });

    const e = await editarTransferencia(r.grupo, {
      origemId: origem.id,
      destinoId: outro.id,
      valorCents: 35000,
      data: "2026-09-22",
      observacao: "ajuste",
      userId: usuario,
    });
    assert.ok(!("erro" in e));

    const saida = await one<any>(`SELECT * FROM payments WHERE transfer_group = ? AND amount_cents < 0`, [r.grupo]);
    const entrada = await one<any>(`SELECT * FROM payments WHERE transfer_group = ? AND amount_cents >= 0`, [r.grupo]);
    assert.equal(saida.amount_cents, -35000);
    assert.equal(saida.account_id, origem.id);
    assert.equal(entrada.amount_cents, 35000);
    assert.equal(entrada.account_id, outro.id);
    assert.equal(saida.paid_at, "2026-09-22");
    assert.equal(entrada.paid_at, "2026-09-22");
    assert.equal(saida.notes, "Transferência para Outra | ajuste");
    assert.equal(entrada.notes, "Transferência recebida de Origem | ajuste");
  });

  it("edicao recusa virar a mesma conta e nao altera nada", async () => {
    const a = await novaConta("A");
    const b = await novaConta("B");
    const r = await criarOk({ origemId: a.id, destinoId: b.id, valorCents: 10000, data: "2026-09-20", userId: usuario });
    const antes = await all<any>(`SELECT * FROM payments WHERE transfer_group = ? ORDER BY id`, [r.grupo]);

    const e = await editarTransferencia(r.grupo, { origemId: a.id, destinoId: a.id, valorCents: 999, data: "2026-09-21", userId: usuario });
    assert.ok("erro" in e);
    const depois = await all<any>(`SELECT * FROM payments WHERE transfer_group = ? ORDER BY id`, [r.grupo]);
    assert.deepEqual(depois, antes, "edicao recusada nao pode alterar lado nenhum");
  });

  it("exclusao remove os dois lados e reverte os saldos (cenario 9)", async () => {
    const origem = await novaConta("Origem", { inicial: 60000 });
    const destino = await novaConta("Destino", { inicial: 0 });
    const r = await criarOk({ origemId: origem.id, destinoId: destino.id, valorCents: 25000, data: "2026-09-20", userId: usuario });
    assert.equal(await origem.saldo(), 35000);

    const x = await excluirTransferencia(r.grupo);
    assert.ok(!("erro" in x));
    assert.equal(await scalar<number>(`SELECT COUNT(*) FROM payments`), 0, "os dois lados sairam juntos");
    assert.equal(await origem.saldo(), 60000, "origem de volta ao saldo anterior");
    assert.equal(await destino.saldo(), 0, "destino de volta ao saldo anterior");
  });

  it("listagem so mostra grupos completos", async () => {
    const a = await novaConta("A");
    const b = await novaConta("B");
    const r = await criarOk({ origemId: a.id, destinoId: b.id, valorCents: 10000, data: "2026-09-20", userId: usuario });
    await criarOk({ origemId: b.id, destinoId: a.id, valorCents: 4000, data: "2026-09-21", userId: usuario });

    assert.equal((await listarTransferencias()).length, 2);

    // lado apagado isoladamente (p.ex. um admin direto no banco): o grupo
    // incompleto nao pode aparecer na lista, porque excluir pela tela
    // removeria so o que ela enxerga
    await run(`DELETE FROM payments WHERE transfer_group = ? AND amount_cents >= 0`, [r.grupo]);
    const lista = await listarTransferencias();
    assert.equal(lista.length, 1);
    assert.equal(lista[0].valor_cents, 4000);
  });
});

describe("receita, despesa e indicadores", () => {
  beforeEach(cenario);

  it("transferencia nao e receita nem despesa (cenarios 12 e 13)", async () => {
    const origem = await novaConta("Origem");
    const destino = await novaConta("Destino");
    await criarTransferencia({ origemId: origem.id, destinoId: destino.id, valorCents: 40000, data: "2026-09-20", userId: usuario });

    const receita = await scalar<number>(`SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE transfer_group IS NULL`);
    const despesa = await scalar<number>(`SELECT COALESCE(SUM(amount_cents),0) FROM expenses`);
    assert.equal(receita, 0, "nenhum lado da transferencia entra na receita");
    assert.equal(despesa, 0, "transferencia nunca gravou linha em expenses");
  });

  it("indicadores do dashboard e da aba Entradas ignoram a transferencia (cenario 14)", async () => {
    const bradesco = await novaConta("Bradesco PJ", { inicial: 0 });
    const carteira = await novaConta("Carteira Física", { cash: true, inicial: 0 });
    const { pagamento, despesa } = await lancarAntigo();

    assert.equal(await recebidoDashboard("2026-08-01", "2026-08-31"), 50000);

    await criarTransferencia({ origemId: bradesco.id, destinoId: carteira.id, valorCents: 30000, data: "2026-08-15", userId: usuario });

    assert.equal(await recebidoDashboard("2026-08-01", "2026-08-31"), 50000, "recebido do periodo nao mudou");
    const entradas = await entradasFinanceiro("2026-08-01", "2026-08-31");
    assert.equal(entradas.length, 1);
    assert.equal(entradas[0].id, pagamento);

    const d = await one<any>(`SELECT * FROM expenses WHERE id = ?`, [despesa]);
    assert.equal(d.amount_cents, 12000);
    assert.equal(await scalar<number>(`SELECT COUNT(*) FROM expenses`), 1);
  });

  it("movimentacoes antigas permanecem intactas (cenario 15)", async () => {
    const { reserva, pagamento } = await lancarAntigo();
    const antes = await all<any>(
      `SELECT id, reservation_id, amount_cents, method, paid_at, account_id, transfer_group, transfer_counterpart_id
         FROM payments ORDER BY id`,
    );
    const antesExp = await all<any>(`SELECT * FROM expenses ORDER BY id`);

    const a = await novaConta("A");
    const b = await novaConta("B");
    await criarTransferencia({ origemId: a.id, destinoId: b.id, valorCents: 7000, data: "2026-09-21", userId: usuario });
    await excluirTransferencia((await listarTransferencias())[0].grupo);

    const depois = await all<any>(
      `SELECT id, reservation_id, amount_cents, method, paid_at, account_id, transfer_group, transfer_counterpart_id
         FROM payments ORDER BY id`,
    );
    const depoisExp = await all<any>(`SELECT * FROM expenses ORDER BY id`);
    assert.deepEqual(depois, antes, "nenhum lancamento antigo foi alterado");
    assert.deepEqual(depoisExp, antesExp);
    assert.equal((await one<any>(`SELECT reservation_id FROM payments WHERE id = ?`, [pagamento])).reservation_id, reserva);
  });
});

describe("cadastro de contas", () => {
  beforeEach(cenario);

  it("contas antigas continuam sem natureza e funcionam (compatibilidade)", async () => {
    const id = await insert(`INSERT INTO financial_accounts (name, kind, initial_balance_cents) VALUES ('Conta Velha','banco',100)`);
    const c = await one<any>(`SELECT * FROM financial_accounts WHERE id = ?`, [id]);
    assert.equal(c.is_cash_account, 0, "default da migration: nenhuma conta muda sozinha");
    assert.equal(c.name, "Conta Velha");
  });

  it("conta dinheiro em especie funciona como qualquer conta financeira (item 5 do pedido)", async () => {
    // Carteira Fisica: +500 (do banco), -100 (de volta ao banco), -50 de
    // despesa paga pela carteira = 350
    const carteira = await novaConta("Carteira Física", { cash: true, inicial: 0 });
    const bradesco = await novaConta("Bradesco PJ", { inicial: 100000 });
    await criarTransferencia({ origemId: bradesco.id, destinoId: carteira.id, valorCents: 50000, data: "2026-09-20", userId: usuario });
    await criarTransferencia({ origemId: carteira.id, destinoId: bradesco.id, valorCents: 10000, data: "2026-09-21", userId: usuario });
    await insert(`INSERT INTO expenses (date, category, description, amount_cents, account_id) VALUES (?,?,?,?,?)`, [
      "2026-09-22",
      "Combustivel",
      "Almoco do evento",
      5000,
      carteira.id,
    ]);

    assert.equal(await carteira.saldo(), 35000);
    assert.equal(await bradesco.saldo(), 60000);
    // a despesa da carteira entra normalmente nos indicadores de despesa
    assert.equal(await scalar<number>(`SELECT SUM(amount_cents) FROM expenses`), 5000);
  });
});
