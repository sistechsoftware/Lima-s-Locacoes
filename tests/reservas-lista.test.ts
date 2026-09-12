/**
 * Filtros e destaque da listagem de Reservas.
 *
 * O padrao operacional "hoje + confirmadas" e apenas uma combinacao de WHERE:
 * nenhuma reserva muda de status, data ou registro. Aqui exercitamos a funcao
 * pura que monta a consulta e a escolha do destaque de proxima reserva.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PERIODO_PADRAO,
  STATUS_PADRAO,
  dataEfetiva,
  indiceProximaReserva,
  janelaDeUmDia,
  periodoValido,
  reservasFiltro,
} from "../src/lib/reservas-lista.ts";

const SQL = (f: Parameters<typeof reservasFiltro>[0]) => {
  const { where, params } = reservasFiltro(f);
  return { sql: where.join(" AND "), params };
};

describe("filtro padrao da tela de reservas", () => {
  it("abre com hoje + confirmadas, sem alterar registros", () => {
    assert.equal(PERIODO_PADRAO, "hoje");
    assert.equal(STATUS_PADRAO, "confirmada");
  });

  it("monta WHERE de evento no dia e status confirmado", () => {
    const { sql, params } = SQL({ q: "", status: "confirmada", periodo: "hoje", data: "", hoje: "2026-09-12" });
    assert.ok(sql.includes("r.event_date = ?"));
    assert.ok(sql.includes("r.status = ?"));
    assert.deepEqual(params, ["confirmada", "2026-09-12"]);
  });
});

describe("periodos", () => {
  it("valor desconhecido cai no padrao (hoje), nunca em SQL vazio", () => {
    assert.equal(periodoValido(undefined), "hoje");
    assert.equal(periodoValido("inventado"), "hoje");
    assert.equal(periodoValido("todas"), "todas");
  });

  it("'todas' nao filtra data nem status", () => {
    const { sql, params } = SQL({ q: "", status: "", periodo: "todas", data: "", hoje: "2026-09-12" });
    assert.equal(sql, "");
    assert.deepEqual(params, []);
  });

  it("'dia' usa a data escolhida e valida; invalida cai em hoje", () => {
    const boa = SQL({ q: "", status: "", periodo: "dia", data: "2026-09-10", hoje: "2026-09-12" });
    assert.ok(boa.sql.includes("r.event_date = ?"));
    assert.deepEqual(boa.params, ["2026-09-10"]);
    assert.equal(dataEfetiva("dia", "2026-09-10", "2026-09-12"), "2026-09-10");
    assert.equal(dataEfetiva("dia", "10/09", "2026-09-12"), "2026-09-12");
  });

  it("'ontem' olha o dia anterior a hoje", () => {
    const { params } = SQL({ q: "", status: "", periodo: "ontem", data: "", hoje: "2026-09-12" });
    assert.deepEqual(params, ["2026-09-11"]);
  });

  it("periodos de um dia habilitam ordenacao/destaque por horario", () => {
    assert.ok(janelaDeUmDia("hoje"));
    assert.ok(janelaDeUmDia("dia"));
    assert.ok(janelaDeUmDia("ontem"));
    assert.ok(!janelaDeUmDia("semana"));
    assert.ok(!janelaDeUmDia("todas"));
  });

  it("semana continua comecando na segunda-feira", () => {
    const { params } = SQL({ q: "", status: "", periodo: "semana", data: "", hoje: "2026-09-12" });
    assert.deepEqual(params, ["2026-09-07", "2026-09-13"]);
  });
});

describe("ordenacao por horario", () => {
  it("dentro de um dia, ordena pelo horario e deixa sem horario no fim", () => {
    const { orderBy } = reservasFiltro({ q: "", status: "", periodo: "hoje", data: "", hoje: "2026-09-12" });
    assert.ok(orderBy.includes("NULLIF(r.event_time, '')"));
    assert.ok(orderBy.includes("ASC"));
  });

  it("fora do dia unico, mantem dias mais recentes primeiro", () => {
    const { orderBy } = reservasFiltro({ q: "", status: "", periodo: "todas", data: "", hoje: "2026-09-12" });
    assert.ok(orderBy.startsWith("r.event_date DESC"));
  });
});

describe("destaque da proxima reserva", () => {
  it("primeira confirmada e a proxima, mesmo depois de entregue/em uso", () => {
    const rows = [{ status: "entregue" }, { status: "em_uso" }, { status: "confirmada" }, { status: "confirmada" }];
    assert.equal(indiceProximaReserva(rows, { porHorario: true }), 2);
  });

  it("com todas confirmadas, a primeira do dia e a proxima", () => {
    const rows = [{ status: "confirmada" }, { status: "confirmada" }];
    assert.equal(indiceProximaReserva(rows, { porHorario: true }), 0);
  });

  it("nunca destaca cancelada sozinha nem fora de dia unico", () => {
    assert.equal(indiceProximaReserva([{ status: "cancelada" }], { porHorario: true }), -1);
    assert.equal(indiceProximaReserva([{ status: "confirmada" }], { porHorario: false }), -1);
  });

  it("filtro por status especifico (nao confirmada) nao destaca", () => {
    assert.equal(indiceProximaReserva([{ status: "entregue" }], { porHorario: true, statusFiltrado: "entregue" }), -1);
  });

  it("com 'Todos os status', a primeira confirmada do dia ainda destaca", () => {
    const rows = [{ status: "entregue" }, { status: "cancelada" }, { status: "confirmada" }];
    assert.equal(indiceProximaReserva(rows, { porHorario: true, statusFiltrado: "" }), 2);
  });

  it("filtro fixado em confirmada destaca normalmente", () => {
    const rows = [{ status: "confirmada" }, { status: "confirmada" }];
    assert.equal(indiceProximaReserva(rows, { porHorario: true, statusFiltrado: "confirmada" }), 0);
  });
});
