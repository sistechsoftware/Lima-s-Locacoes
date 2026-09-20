/**
 * Operação do dia com fretes integrados às locações.
 *
 * Cobre os cenários de regressão pedidos na auditoria: reserva sem frete,
 * frete sem reserva, reserva + frete no mesmo dia, vários fretes e horários,
 * frete cancelado, frete concluído, operação sem horário, dias sem operações,
 * operações futuras e passadas. As consultas rodam no SQL real (SQLite em
 * memória com as migrations do projeto), então o filtro de status e a
 * ordenação testados são exatamente os que o dashboard executa.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/d1.ts";
import { all, insert, one } from "../src/lib/db.ts";
import { freightsOn, lateOperations, operationsOn } from "../src/lib/queries.ts";
import { addDays, today } from "../src/lib/format.ts";

let cliente = 0;
let seq = 0;
const T0 = today();

/** Banco novo por cenario: o node:test nao propaga beforeEach de modulo. */
async function cenario() {
  createTestDb();
  seq = 0;
  cliente = await insert(`INSERT INTO customers (name, phone) VALUES ('Joao da Silva','11999990000')`);
}

async function reserva(eventDate: string = T0) {
  seq++;
  return await insert(
    `INSERT INTO reservations (number, customer_id, status, event_date) VALUES (?,?,'confirmada',?)`,
    [`LIMA-${String(seq).padStart(3, "0")}`, cliente, eventDate],
  );
}

async function operacao(reservationId: number, scheduledAt: string, status = "pendente") {
  return await insert(
    `INSERT INTO operations (kind, reservation_id, scheduled_at, status) VALUES ('entrega',?,?,?)`,
    [reservationId, scheduledAt, status],
  );
}

async function frete(date: string, opts: { time?: string | null; status?: string } = {}) {
  seq++;
  return await insert(
    `INSERT INTO freights (number, customer_id, contact_name, phone, date, time, origin, destination, cargo, amount_cents, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      `FRT-${String(seq).padStart(3, "0")}`,
      cliente,
      "Contato Avulso",
      "11988887777",
      date,
      opts.time ?? null,
      "Base Lima's",
      "Rua do Evento, 100",
      "2 mesas, 10 cadeiras",
      25000,
      opts.status ?? "agendado",
    ],
  );
}

describe("frete sem reserva", () => {
  beforeEach(cenario);

  it("aparece sozinho na operacao do dia, com cliente e telefone do cadastro", async () => {
    const id = await frete(T0, { time: "09:00" });
    const fretes = await freightsOn(T0);
    const ops = await operationsOn(T0);
    assert.equal(ops.length, 0, "nenhuma operacao de locacao");
    assert.equal(fretes.length, 1);
    assert.equal(fretes[0].id, id);
    assert.equal(fretes[0].customer, "Joao da Silva");
    assert.equal(fretes[0].phone, "11999990000");
    assert.equal(fretes[0].status, "agendado");
  });
});

describe("reserva sem frete", () => {
  beforeEach(cenario);

  it("operacao de locacao aparece e o bloco de fretes fica vazio", async () => {
    const r = await reserva();
    await operacao(r, `${T0}T08:00`);
    const ops = await operationsOn(T0);
    const fretes = await freightsOn(T0);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].kind, "entrega");
    assert.equal(ops[0].customer, "Joao da Silva");
    assert.equal(fretes.length, 0);
  });
});

describe("reserva + frete no mesmo dia", () => {
  beforeEach(cenario);

  it("os dois aparecem, cada um na sua lista, somando 2 operacoes do dia", async () => {
    const r = await reserva();
    await operacao(r, `${T0}T08:00`);
    await frete(T0, { time: "14:00" });
    const ops = await operationsOn(T0);
    const fretes = await freightsOn(T0);
    assert.equal(ops.length, 1);
    assert.equal(fretes.length, 1);
    assert.equal(ops.length + fretes.length, 2);
  });
});

describe("vários fretes no mesmo dia", () => {
  beforeEach(cenario);

  it("ordena por horario e o frete sem horario vem primeiro (regra da agenda)", async () => {
    await frete(T0, { time: "14:00" });
    await frete(T0, { time: "09:00" });
    await frete(T0, { time: null });
    const fretes = await freightsOn(T0);
    assert.deepEqual(
      fretes.map((f: any) => f.time),
      [null, "09:00", "14:00"],
    );
  });
});

describe("status do frete", () => {
  beforeEach(cenario);

  it("cancelado nao aparece na operacao do dia", async () => {
    await frete(T0, { time: "09:00", status: "cancelado" });
    assert.equal((await freightsOn(T0)).length, 0);
  });

  it("concluido do dia continua visivel, com o status real", async () => {
    await frete(T0, { time: "08:00", status: "concluido" });
    const fretes = await freightsOn(T0);
    assert.equal(fretes.length, 1);
    assert.equal(fretes[0].status, "concluido");
  });

  it("orcamento e em_rota tambem entram (so cancelado fica de fora)", async () => {
    await frete(T0, { time: "08:00", status: "orcamento" });
    await frete(T0, { time: "10:00", status: "em_rota" });
    const fretes = await freightsOn(T0);
    assert.equal(fretes.length, 2);
  });

  it("operacao de locacao cancelada segue de fora", async () => {
    const r = await reserva();
    await operacao(r, `${T0}T08:00`, "cancelada");
    assert.equal((await operationsOn(T0)).length, 0);
  });
});

describe("dias sem operações", () => {
  beforeEach(cenario);

  it("hoje vazio nos dois blocos", async () => {
    assert.equal((await operationsOn(T0)).length, 0);
    assert.equal((await freightsOn(T0)).length, 0);
  });
});

describe("operações futuras", () => {
  beforeEach(cenario);

  it("frete de depois de amanha nao entra hoje, mas entra no dia dele", async () => {
    const futuro = addDays(T0, 2);
    await frete(futuro, { time: "09:00" });
    assert.equal((await freightsOn(T0)).length, 0);
    const noDia = await freightsOn(futuro);
    assert.equal(noDia.length, 1);
  });

  it("operacao de locacao futura tambem nao entra hoje", async () => {
    const r = await reserva(addDays(T0, 1));
    await operacao(r, `${addDays(T0, 1)}T08:00`);
    assert.equal((await operationsOn(T0)).length, 0);
    assert.equal((await operationsOn(addDays(T0, 1))).length, 1);
  });
});

describe("operações passadas", () => {
  beforeEach(cenario);

  it("frete de ontem nao entra na operacao de hoje", async () => {
    await frete(addDays(T0, -1), { time: "09:00" });
    assert.equal((await freightsOn(T0)).length, 0);
    assert.equal((await freightsOn(addDays(T0, -1))).length, 1);
  });

  it("frete aberto de ontem NAO entra nos atrasados: lateOperations cobre so operacoes de locacao (comportamento pre-existente, preservado)", async () => {
    const ontem = addDays(T0, -1);
    await frete(ontem, { time: "09:00" });
    await frete(ontem, { time: "10:00", status: "concluido" });
    const atrasadas = await lateOperations();
    assert.equal(atrasadas.length, 0, "nem fretes abertos nem concluidos entram no alerta de atraso");
  });

  it("operacao de locacao aberta de ontem tambem aparece nos atrasados", async () => {
    const r = await reserva(addDays(T0, -1));
    await operacao(r, `${addDays(T0, -1)}T08:00`);
    const atrasadas = await lateOperations();
    assert.equal(atrasadas.length, 1);
    assert.equal(atrasadas[0].kind, "entrega");
  });
});

describe("integridade dos dados exibidos", () => {
  beforeEach(cenario);

  it("frete sem cliente cadastrado cai no contato avulso", async () => {
    seq++;
    await insert(
      `INSERT INTO freights (number, contact_name, date, time, status) VALUES (?,?,?,?,'agendado')`,
      [`FRT-${String(seq).padStart(3, "0")}`, "Maria Avulsa", T0, "11:00"],
    );
    const fretes = await freightsOn(T0);
    assert.equal(fretes.length, 1);
    assert.equal(fretes[0].customer, null);
    assert.equal(fretes[0].contact_name, "Maria Avulsa");
  });

  it("nenhum dado e escrito pelas consultas da operacao do dia", async () => {
    const r = await reserva();
    await operacao(r, `${T0}T08:00`);
    await frete(T0, { time: "09:00" });
    await operationsOn(T0);
    await freightsOn(T0);
    const reservas = await one<any>(`SELECT status, event_date FROM reservations WHERE id = ?`, [r]);
    const f = await one<any>(`SELECT status, date, time FROM freights WHERE date = ?`, [T0]);
    assert.equal(reservas.status, "confirmada");
    assert.equal(f.status, "agendado");
    assert.equal(f.time, "09:00");
    const total = await all<any>(`SELECT id FROM freights`);
    assert.equal(total.length, 1);
  });
});
