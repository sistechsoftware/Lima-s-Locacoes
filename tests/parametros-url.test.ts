/**
 * Parametros repetidos na URL (query string).
 *
 * O App Router entrega valores repetidos como string[]. O Diario de Erros
 * registrou duas telas derrubadas por "trim is not a function"
 * (/disponibilidade/timeline, registros #4/#5/#8/#9): o link de periodo
 * acumulava inicio/fim por cima dos que ja estavam na query e o parse
 * quebrava. Aqui ficam travados o comportamento defensivo (ultimo valor
 * vence, que e o clique mais recente) e a invariante de geracao de links
 * da timeline (um unico par inicio/fim por URL).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { availabilityQuery, normalizeStamp, timeWindow } from "../src/lib/availability-time";

describe("parametro repetido na URL", () => {
  it("normalizeStamp aceita array e usa o ultimo valor (clique mais recente)", () => {
    assert.equal(normalizeStamp(["2026-10-09T12:23", "2026-10-04T00:00"]), "2026-10-04T00:00");
    assert.equal(normalizeStamp(["2026-10-04T00:00"]), "2026-10-04T00:00");
  });

  it("normalizeStamp vazio (string ou array) devolve string vazia, sem excecao", () => {
    assert.equal(normalizeStamp(""), "");
    assert.equal(normalizeStamp([]), "");
    assert.equal(normalizeStamp(null), "");
    assert.equal(normalizeStamp(undefined), "");
  });

  it("a URL exata do erro do Diario (#8) parseia sem quebrar", () => {
    // ?inicio=2026-10-09T12:23&inicio=2026-10-04T00:00&fim=2026-10-12T12:23
    //   &fim=2026-11-02T23:59&preparo=1&consulta=1&modo=ocupados
    const q = availabilityQuery({
      inicio: ["2026-10-09T12:23", "2026-10-04T00:00"],
      fim: ["2026-10-12T12:23", "2026-11-02T23:59"],
      preparo: "1",
      consulta: "1",
    });
    assert.equal(q.from, "2026-10-04T00:00", "vale o clique do preset (ultimo)");
    assert.equal(q.to, "2026-11-02T23:59");
    assert.equal(q.considerPreparation, true);
  });

  it("a URL do erro do Diario (#4): fim vazio no primeiro par nao zera o intervalo", () => {
    // ?inicio=2026-09-30T20:29&fim=&preparo=1&consulta=1&inicio=...&fim=2026-10-29T23:59
    const q = availabilityQuery({
      inicio: ["2026-09-30T20:29", "2026-09-30T00:00"],
      fim: ["", "2026-10-29T23:59"],
      preparo: ["1", "1"],
      consulta: "1",
    });
    assert.equal(q.from, "2026-09-30T00:00");
    assert.equal(q.to, "2026-10-29T23:59");
  });

  it("preparo/consulta repetidos tambem viram string unica", () => {
    const q = availabilityQuery({
      inicio: "2026-10-04T00:00",
      preparo: ["0", "1"],
      consulta: ["1", "1"],
    });
    assert.equal(q.considerPreparation, true, "ultimo preparo vence");
    const semConsulta = availabilityQuery({
      inicio: "2026-10-04T00:00",
      preparo: ["0", "0"],
      consulta: undefined,
    });
    assert.equal(semConsulta.considerPreparation, false, "sem consulta, ultimo preparo!=1 vale");
  });

  it("timeWindow tambem tolera array (usada por stock/timeline)", () => {
    const w = timeWindow(["2026-10-01T10:00", "2026-10-02T10:00"], "2026-10-03T10:00");
    assert.deepEqual(w, { from: "2026-10-02T10:00", to: "2026-10-03T10:00" });
  });

  it("valores normais continuam identificados (regressao)", () => {
    const q = availabilityQuery({ inicio: "2026-10-04T09:30", fim: "2026-10-05T09:30", preparo: "1", consulta: "1" });
    assert.equal(q.from, "2026-10-04T09:30");
    assert.equal(q.to, "2026-10-05T09:30");
    assert.equal(q.queryString.includes("inicio=2026-10-04T09%3A30"), true);
  });
});
