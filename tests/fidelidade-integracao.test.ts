/**
 * Fidelidade com o SQL real: pontuacao idempotente, emissao de recompensa,
 * uso, reversao no cancelamento e preservacao da regra antiga.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/d1.ts";
import { all, insert, one, run, scalar } from "../src/lib/db.ts";
import {
  aoConcluirLocacao,
  devolverRecompensaDaReserva,
  painelDoCliente,
  pontosDe,
  pontuarReserva,
  recompensasDe,
  recompensasDisponiveis,
  reverterReserva,
  rotinaDiaria,
  simularUso,
  usarRecompensa,
} from "../src/lib/fidelidade-db.ts";
import { today } from "../src/lib/format.ts";

let cliente = 0;
let KIT = 0;
let FORRO = 0;
let seq = 0;

async function cenario() {
  createTestDb();
  seq = 0;
  await insert(
    `INSERT INTO users (id, name, username, password_hash, role) VALUES (1,'Operador','op','x','admin')`,
  );
  cliente = await insert(`INSERT INTO customers (name, phone) VALUES ('Joao Ribeiro','11999990000')`);
  KIT = await insert(
    `INSERT INTO products (code, name, kind, total_qty, rent_price_cents) VALUES ('KIT','Kit Mesa + 4 Cadeiras','kit',0,2000)`,
  );
  FORRO = await insert(
    `INSERT INTO products (code, name, kind, total_qty, rent_price_cents) VALUES ('FRM','Forro','simples',50,500)`,
  );
}

async function config(chave: string, valor: string) {
  await run(
    `INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [chave, valor],
  );
}

/** Cria uma locacao e leva ao status pedido, passando pelo gatilho real. */
async function locacao(status = "finalizada", total = 50000, itens: { produto: number; qty: number; preco: number }[] = []) {
  seq++;
  const id = await insert(
    `INSERT INTO reservations (number, customer_id, status, event_date, total_cents)
     VALUES (?,?,?,'2026-09-20',?)`,
    [`LIMA-${String(seq).padStart(3, "0")}`, cliente, status, total],
  );
  for (const i of itens) {
    await insert(
      `INSERT INTO reservation_items (reservation_id, product_id, qty, unit_price_cents, subtotal_cents)
       VALUES (?,?,?,?,?)`,
      [id, i.produto, i.qty, i.preco, i.qty * i.preco],
    );
  }
  await aoConcluirLocacao(id);
  return id;
}

describe("progressao 1/5 ate 5/5", () => {
  beforeEach(cenario);

  it("cada locacao concluida avanca um ponto", async () => {
    const esperado = [1, 2, 3, 4];
    for (const n of esperado) {
      await locacao();
      const p = await painelDoCliente(cliente);
      assert.equal(p.progresso.noCiclo, n, `deveria estar em ${n}/5`);
      assert.equal(p.recompensas.length, 0, "ainda sem recompensa");
    }
  });

  it("a quinta locacao gera uma recompensa de ate 5 kits", async () => {
    for (let i = 0; i < 5; i++) await locacao();
    const p = await painelDoCliente(cliente);
    assert.equal(p.recompensas.length, 1);
    assert.equal(p.recompensas[0].kit_quantity, 5);
    assert.equal(p.recompensas[0].situacao, "disponivel");
    assert.equal(p.progresso.faltam, 0);
  });

  it("com acumulo, 10 e 15 locacoes geram 2 e 3 recompensas", async () => {
    for (let i = 0; i < 10; i++) await locacao();
    assert.equal((await recompensasDe(cliente)).length, 2);
    for (let i = 0; i < 5; i++) await locacao();
    assert.equal((await recompensasDe(cliente)).length, 3);
  });
});

describe("o que nao pontua", () => {
  beforeEach(cenario);

  it("orcamento, pre-reserva e cancelada nao contam", async () => {
    for (const status of ["orcamento", "pre_reserva", "confirmada", "cancelada"]) {
      await locacao(status);
    }
    assert.equal(await pontosDe(cliente), 0);
  });

  it("valor minimo configurado barra a locacao pequena", async () => {
    await config("fidelity_min_value_cents", "30000");
    await locacao("finalizada", 20000);
    assert.equal(await pontosDe(cliente), 0);
    await locacao("finalizada", 30000);
    assert.equal(await pontosDe(cliente), 1);
  });

  it("programa desativado nao pontua nada", async () => {
    await config("fidelity_active", "0");
    await locacao();
    assert.equal(await pontosDe(cliente), 0);
  });
});

describe("idempotencia", () => {
  beforeEach(cenario);

  it("processar a mesma locacao duas vezes da um ponto so", async () => {
    const id = await locacao();
    await aoConcluirLocacao(id);
    await pontuarReserva(id);
    assert.equal(await pontosDe(cliente), 1);
  });

  it("passar de novo pela quinta locacao nao gera recompensa duplicada", async () => {
    let ultima = 0;
    for (let i = 0; i < 5; i++) ultima = await locacao();
    await aoConcluirLocacao(ultima);
    await aoConcluirLocacao(ultima);
    assert.equal((await recompensasDe(cliente)).length, 1);
  });

  it("o aviso de 'falta 1' e preparado uma unica vez por ciclo", async () => {
    for (let i = 0; i < 4; i++) await locacao();
    const primeira = await scalar<number>(`SELECT COUNT(*) FROM fidelity_messages WHERE event='quase_la'`);
    const ultima = await one<any>(`SELECT id FROM reservations ORDER BY id DESC LIMIT 1`);
    await aoConcluirLocacao(ultima.id);
    await aoConcluirLocacao(ultima.id);
    assert.equal(primeira, 1);
    assert.equal(await scalar<number>(`SELECT COUNT(*) FROM fidelity_messages WHERE event='quase_la'`), 1);
  });
});

describe("uso da recompensa", () => {
  beforeEach(cenario);

  async function comRecompensa() {
    for (let i = 0; i < 5; i++) await locacao();
    const [r] = await recompensasDisponiveis(cliente);
    return r;
  }

  it("3 kits numa recompensa de 5: os 3 saem de graca", async () => {
    const r = await comRecompensa();
    const nova = await locacao("confirmada", 6000, [{ produto: KIT, qty: 3, preco: 2000 }]);
    const b = await simularUso(r.id, nova);
    assert.equal(b!.kitsGratis, 3);
    assert.equal(b!.descontoCents, 6000);
  });

  it("7 kits: so 5 sao cobertos", async () => {
    const r = await comRecompensa();
    const nova = await locacao("confirmada", 14000, [{ produto: KIT, qty: 7, preco: 2000 }]);
    const b = await simularUso(r.id, nova);
    assert.equal(b!.kitsGratis, 5);
    assert.equal(b!.descontoCents, 10000);
  });

  it("forro e frete continuam cobrados", async () => {
    const r = await comRecompensa();
    const nova = await locacao("confirmada", 20000, [
      { produto: KIT, qty: 2, preco: 2000 },
      { produto: FORRO, qty: 20, preco: 500 },
    ]);
    const b = await simularUso(r.id, nova);
    assert.equal(b!.descontoCents, 4000, "so os 2 kits");
  });

  it("usar aplica o desconto na reserva e marca a recompensa", async () => {
    const r = await comRecompensa();
    const nova = await locacao("confirmada", 0, [{ produto: KIT, qty: 3, preco: 2000 }]);
    const erro = await usarRecompensa(r.id, nova, 1);
    assert.equal(erro, null);

    const reserva = await one<any>(`SELECT * FROM reservations WHERE id = ?`, [nova]);
    assert.equal(reserva.discount_cents, 6000);
    assert.equal(reserva.total_cents, 0, "R$ 60 de kits menos R$ 60 de recompensa");

    const usada = await one<any>(`SELECT * FROM fidelity_rewards WHERE id = ?`, [r.id]);
    assert.equal(usada.status, "usada");
    assert.equal(usada.used_reservation_id, nova);
    assert.equal(usada.used_kits, 3);
  });

  it("dois cliques simultaneos consomem a recompensa uma vez so", async () => {
    const r = await comRecompensa();
    const nova = await locacao("confirmada", 0, [{ produto: KIT, qty: 3, preco: 2000 }]);
    const [a, b] = await Promise.all([usarRecompensa(r.id, nova, 1), usarRecompensa(r.id, nova, 1)]);
    const falhas = [a, b].filter(Boolean);
    assert.equal(falhas.length, 1, "uma das duas tem que ser recusada");
    const reserva = await one<any>(`SELECT discount_cents FROM reservations WHERE id = ?`, [nova]);
    assert.equal(reserva.discount_cents, 6000, "o desconto entrou uma vez");
  });

  it("recompensa de outro cliente e recusada", async () => {
    const r = await comRecompensa();
    const outro = await insert(`INSERT INTO customers (name) VALUES ('Outra pessoa')`);
    const alheia = await insert(
      `INSERT INTO reservations (number, customer_id, status, event_date, total_cents)
       VALUES ('LIMA-900',?,'confirmada','2026-09-20',6000)`,
      [outro],
    );
    await insert(
      `INSERT INTO reservation_items (reservation_id, product_id, qty, unit_price_cents) VALUES (?,?,3,2000)`,
      [alheia, KIT],
    );
    assert.match((await usarRecompensa(r.id, alheia, 1)) ?? "", /outro cliente/i);
  });

  it("reserva sem kit nao consome a recompensa", async () => {
    const r = await comRecompensa();
    const nova = await locacao("confirmada", 10000, [{ produto: FORRO, qty: 20, preco: 500 }]);
    assert.match((await usarRecompensa(r.id, nova, 1)) ?? "", /kits/i);
    assert.equal((await one<any>(`SELECT status FROM fidelity_rewards WHERE id=?`, [r.id])).status, "disponivel");
  });
});

describe("cancelamento", () => {
  beforeEach(cenario);

  it("cancelar uma locacao pontuada reverte o ponto sem apagar o historico", async () => {
    const id = await locacao();
    assert.equal(await pontosDe(cliente), 1);

    await run(`UPDATE reservations SET status='cancelada' WHERE id=?`, [id]);
    await reverterReserva(id, 1);

    assert.equal(await pontosDe(cliente), 0, "saldo volta a zero");
    const linhas = await all<any>(`SELECT kind FROM fidelity_events WHERE reservation_id = ?`, [id]);
    assert.deepEqual(linhas.map((l) => l.kind).sort(), ["ponto", "reversao"], "as duas linhas ficam");
  });

  it("reverter duas vezes nao dobra a reversao", async () => {
    const id = await locacao();
    await reverterReserva(id, 1);
    await reverterReserva(id, 1);
    assert.equal(await pontosDe(cliente), 0);
  });

  it("recompensa indevida e cancelada quando o saldo nao a sustenta", async () => {
    let ultima = 0;
    for (let i = 0; i < 5; i++) ultima = await locacao();
    assert.equal((await recompensasDisponiveis(cliente)).length, 1);

    await run(`UPDATE reservations SET status='cancelada' WHERE id=?`, [ultima]);
    await reverterReserva(ultima, 1);

    const r = await one<any>(`SELECT status FROM fidelity_rewards WHERE customer_id=?`, [cliente]);
    assert.equal(r.status, "cancelada");
    assert.equal((await recompensasDisponiveis(cliente)).length, 0);
  });

  it("recompensa ja usada nao e mexida por um cancelamento de outra locacao", async () => {
    let quinta = 0;
    for (let i = 0; i < 5; i++) quinta = await locacao();
    const [r] = await recompensasDisponiveis(cliente);
    const usadaEm = await locacao("confirmada", 0, [{ produto: KIT, qty: 3, preco: 2000 }]);
    await usarRecompensa(r.id, usadaEm, 1);

    await run(`UPDATE reservations SET status='cancelada' WHERE id=?`, [quinta]);
    await reverterReserva(quinta, 1);

    assert.equal((await one<any>(`SELECT status FROM fidelity_rewards WHERE id=?`, [r.id])).status, "usada");
  });

  it("cancelar a locacao que usou a recompensa devolve a recompensa", async () => {
    for (let i = 0; i < 5; i++) await locacao();
    const [r] = await recompensasDisponiveis(cliente);
    const usadaEm = await locacao("confirmada", 0, [{ produto: KIT, qty: 3, preco: 2000 }]);
    await usarRecompensa(r.id, usadaEm, 1);

    await devolverRecompensaDaReserva(usadaEm);
    const volta = await one<any>(`SELECT * FROM fidelity_rewards WHERE id=?`, [r.id]);
    assert.equal(volta.status, "disponivel");
    assert.equal(volta.used_reservation_id, null);
  });

  it("configurado para manter consumida, a recompensa nao volta", async () => {
    await config("fidelity_return_on_cancel", "0");
    for (let i = 0; i < 5; i++) await locacao();
    const [r] = await recompensasDisponiveis(cliente);
    const usadaEm = await locacao("confirmada", 0, [{ produto: KIT, qty: 3, preco: 2000 }]);
    await usarRecompensa(r.id, usadaEm, 1);

    assert.equal(await devolverRecompensaDaReserva(usadaEm), false);
    assert.equal((await one<any>(`SELECT status FROM fidelity_rewards WHERE id=?`, [r.id])).status, "usada");
  });
});

describe("regra antiga preservada", () => {
  beforeEach(cenario);

  it("mudar a meta de 5 para 10 nao mexe na recompensa ja conquistada", async () => {
    for (let i = 0; i < 5; i++) await locacao();
    const antes = await one<any>(`SELECT * FROM fidelity_rewards WHERE customer_id=?`, [cliente]);
    assert.equal(antes.rule_goal, 5);
    assert.equal(antes.kit_quantity, 5);

    await config("fidelity_goal", "10");
    await config("fidelity_kits", "10");

    const depois = await one<any>(`SELECT * FROM fidelity_rewards WHERE id=?`, [antes.id]);
    assert.equal(depois.rule_goal, 5, "a recompensa guarda a regra do dia da conquista");
    assert.equal(depois.kit_quantity, 5);
    assert.equal(depois.status, "disponivel", "continua valendo");

    // e a regra nova passa a valer para o proximo ciclo
    const p = await painelDoCliente(cliente);
    assert.equal(p.progresso.meta, 10);
  });

  it("a validade e calculada na conquista e nao muda depois", async () => {
    await config("fidelity_validity_days", "30");
    for (let i = 0; i < 5; i++) await locacao();
    const r = await one<any>(`SELECT * FROM fidelity_rewards WHERE customer_id=?`, [cliente]);
    assert.ok(r.expires_on, "tem validade");
    assert.equal(r.rule_validity_days, 30);

    await config("fidelity_validity_days", "90");
    const depois = await one<any>(`SELECT expires_on FROM fidelity_rewards WHERE id=?`, [r.id]);
    assert.equal(depois.expires_on, r.expires_on, "o vencimento nao foi recalculado");
  });
});

describe("rotina diaria", () => {
  beforeEach(cenario);

  it("expira a recompensa vencida e avisa o cliente", async () => {
    for (let i = 0; i < 5; i++) await locacao();
    const r = await one<any>(`SELECT id FROM fidelity_rewards WHERE customer_id=?`, [cliente]);
    await run(`UPDATE fidelity_rewards SET expires_on='2020-01-01' WHERE id=?`, [r.id]);
    await config("fidelity_notify_expired", "1");

    const resultado = await rotinaDiaria();
    assert.equal(resultado.expiradas, 1);
    assert.equal((await one<any>(`SELECT status FROM fidelity_rewards WHERE id=?`, [r.id])).status, "expirada");
    assert.equal(await scalar<number>(`SELECT COUNT(*) FROM fidelity_messages WHERE event='expirada'`), 1);
  });

  it("prepara o lembrete de vencimento na antecedencia configurada", async () => {
    for (let i = 0; i < 5; i++) await locacao();
    const r = await one<any>(`SELECT id FROM fidelity_rewards WHERE customer_id=?`, [cliente]);
    await run(`UPDATE fidelity_rewards SET expires_on = date(?, '+7 days') WHERE id=?`, [today(), r.id]);

    const resultado = await rotinaDiaria();
    assert.equal(resultado.lembretes, 1);
    // rodar de novo no mesmo dia nao repete o aviso
    assert.equal((await rotinaDiaria()).lembretes, 0);
  });

  it("recompensa sem validade nunca expira", async () => {
    for (let i = 0; i < 5; i++) await locacao();
    const resultado = await rotinaDiaria();
    assert.equal(resultado.expiradas, 0);
    assert.equal((await recompensasDisponiveis(cliente)).length, 1);
  });
});
