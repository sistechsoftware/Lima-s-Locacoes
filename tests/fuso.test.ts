/**
 * Datas do negocio no fuso de Sao Paulo.
 *
 * O Worker roda em UTC. Sem tratamento, depois das 21h no horario de Brasilia
 * o sistema ja considerava o dia seguinte, e uma retirada de amanha aparecia
 * como "hoje". Estes testes rodam com o processo em UTC de proposito.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { today, nowLocal, toISODate, utcParaLocal } from "../src/lib/format.ts";

describe("datas no fuso do negocio", () => {
  before(() => {
    // reproduz o ambiente do Worker
    process.env.TZ = "UTC";
  });

  it("22:30 de 04/09 em Brasilia ainda e dia 04, mesmo sendo 01:30 UTC do dia 05", () => {
    // 2026-09-05T01:30Z equivale a 2026-09-04 22:30 em Sao Paulo
    const instante = new Date("2026-09-05T01:30:00Z");
    assert.equal(toISODate(instante), "2026-09-04");
  });

  it("02:00 UTC vira 23:00 do dia anterior", () => {
    assert.equal(utcParaLocal("2026-09-05 02:00"), "04/09/2026 23:00");
  });

  it("meio-dia UTC continua no mesmo dia, tres horas antes", () => {
    assert.equal(toISODate(new Date("2026-09-04T12:00:00Z")), "2026-09-04");
    assert.equal(utcParaLocal("2026-09-04 12:00"), "04/09/2026 09:00");
  });

  it("today e nowLocal saem no formato esperado e sao coerentes entre si", () => {
    const d = today();
    const n = nowLocal();
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(n, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    assert.equal(n.slice(0, 10), d);
  });

  it("nao usa o fuso do processo", () => {
    // com TZ=UTC, o metodo ingenuo daria a data UTC; a nossa precisa diferir
    // dela sempre que o instante estiver entre 00:00 e 03:00 UTC
    const instante = new Date("2026-09-05T00:30:00Z");
    assert.notEqual(toISODate(instante), instante.toISOString().slice(0, 10));
    assert.equal(toISODate(instante), "2026-09-04");
  });
});
