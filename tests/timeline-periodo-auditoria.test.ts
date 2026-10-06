/**
 * Auditoria da Timeline de Disponibilidade — periodo-base 09/10/2026 00:00
 * ate 12/10/2026 23:59 (horario de Brasilia).
 *
 * Compara tres camadas:
 *   1. Banco  — reservas que sobrepoe a janela (regra de negocio HOLDING_STATUSES);
 *   2. Motor  — holds carregados por loadHolds (mesma fonte da tela de disponibilidade);
 *   3. Timeline — blocos efetivamente renderizados por linha (respeitando o corte
 *      de pistas aplicado pelo componente da timeline).
 *
 * Toda reserva que ocupa estoque na janela DEVE aparecer na camada 3.
 */
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/d1";
import { montarCenario, resetSequencia, criarReserva } from "./helpers/fixtures";
import { all, run, insert } from "../src/lib/db";
import { equipmentTimeline } from "../src/lib/timeline";
import { loadHolds } from "../src/lib/stock";

const DE = "2026-10-09T00:00";
const ATE = "2026-10-12T23:59";

let c: Awaited<ReturnType<typeof montarCenario>>;
beforeEach(async () => {
  createTestDb();
  resetSequencia();
  c = await montarCenario(20, 80);
});

/** Reservas que, pela regra de negocio (HOLDING_STATUSES), ocupam a janela. */
async function reservasNoBanco(): Promise<{ id: number; number: string }[]> {
  return all<{ id: number; number: string }>(
    `SELECT id, number FROM reservations
      WHERE status IN ('pre_reserva','confirmada','entregue','em_uso','aguardando_retirada')
        AND date(COALESCE(delivery_at, event_date)) <= date(?)
        AND date(COALESCE(pickup_at, event_date)) >= date(?)
      ORDER BY id`,
    [ATE, DE],
  );
}

/** Reservas visiveis na timeline (camada 3: blocos renderizados por linha). */
async function reservasNaTimeline(): Promise<Set<number>> {
  const rows = await equipmentTimeline(DE, ATE, {}, { apenasOcupados: true });
  const vistos = new Set<number>();
  for (const row of rows) {
    for (const lane of row.lanes) {
      for (const b of lane.blocks) vistos.add(b.reservationId);
    }
  }
  return vistos;
}

describe("auditoria da timeline — periodo 09/10/2026 a 12/10/2026", () => {
  it("reserva que atravessa o INICIO da janela aparece", async () => {
    await criarReserva(c.clienteId, [{ product_id: c.mesaId, qty: 2 }], "confirmada", {
      from: "2026-10-08T14:00",
      to: "2026-10-10T10:00",
    });
    const banco = await reservasNoBanco();
    const timeline = await reservasNaTimeline();
    assert.equal(banco.length, 1);
    assert.ok(timeline.has(banco[0].id), "reserva que comeca antes da janela sumiu da timeline");
  });

  it("reserva que atravessa o FIM da janela aparece", async () => {
    await criarReserva(c.clienteId, [{ product_id: c.mesaId, qty: 2 }], "confirmada", {
      from: "2026-10-11T09:00",
      to: "2026-10-13T18:00",
    });
    const banco = await reservasNoBanco();
    const timeline = await reservasNaTimeline();
    assert.equal(banco.length, 1);
    assert.ok(timeline.has(banco[0].id), "reserva que termina depois da janela sumiu da timeline");
  });

  it("reserva de varios dias dentro da janela aparece", async () => {
    await criarReserva(c.clienteId, [{ product_id: c.mesaId, qty: 1 }], "confirmada", {
      from: "2026-10-09T10:00",
      to: "2026-10-12T10:00",
    });
    const banco = await reservasNoBanco();
    const timeline = await reservasNaTimeline();
    assert.equal(banco.length, 1);
    assert.ok(timeline.has(banco[0].id), "reserva multi-dia sumiu da timeline");
  });

  it("reservas consecutivas (fim de uma = inicio da outra) aparecem todas", async () => {
    await criarReserva(c.clienteId, [{ product_id: c.mesaId, qty: 1 }], "confirmada", {
      from: "2026-10-10T08:00",
      to: "2026-10-10T12:00",
    });
    await criarReserva(c.clienteId, [{ product_id: c.mesaId, qty: 1 }], "confirmada", {
      from: "2026-10-10T12:00",
      to: "2026-10-10T16:00",
    });
    const banco = await reservasNoBanco();
    const timeline = await reservasNaTimeline();
    assert.equal(banco.length, 2);
    for (const r of banco) assert.ok(timeline.has(r.id), `reserva ${r.number} consecutiva sumiu`);
  });

  it("reserva sem horario definido (so data do evento) aparece cobrindo o dia todo", async () => {
    const id = await insert(
      `INSERT INTO reservations (number, customer_id, status, event_date) VALUES (?,?,?,?)`,
      ["LIMA-SEM-HORARIO", c.clienteId, "confirmada", "2026-10-10"],
    );
    await insert(`INSERT INTO reservation_items (reservation_id, product_id, qty, unit_price_cents) VALUES (?,?,?,0)`, [
      id, c.mesaId, 1,
    ]);
    const { rebuildReservationComponents } = await import("../src/lib/stock");
    const { recalcReservation } = await import("../src/lib/reservations");
    await rebuildReservationComponents(id);
    await recalcReservation(id);

    const banco = await reservasNoBanco();
    const timeline = await reservasNaTimeline();
    assert.equal(banco.length, 1);
    assert.ok(timeline.has(id), "reserva sem horario sumiu da timeline");
  });

  it("reserva cancelada nao aparece (regra atual preservada)", async () => {
    const id = await criarReserva(c.clienteId, [{ product_id: c.mesaId, qty: 1 }], "confirmada", {
      from: "2026-10-10T08:00",
      to: "2026-10-10T12:00",
    });
    await run(`UPDATE reservations SET status = 'cancelada' WHERE id = ?`, [id]);
    const timeline = await reservasNaTimeline();
    assert.ok(!timeline.has(id), "reserva cancelada nao deveria aparecer");
  });

  it("DUAS reservas simultaneas de grande quantidade aparecem ambas na mesma linha", async () => {
    // 60 + 60 cadeiras simultaneas: a segunda empilha a partir da pista 60
    await criarReserva(c.clienteId, [{ product_id: c.cadeiraId, qty: 60 }], "confirmada", {
      from: "2026-10-10T08:00",
      to: "2026-10-10T18:00",
    });
    await criarReserva(c.clienteId, [{ product_id: c.cadeiraId, qty: 60 }], "confirmada", {
      from: "2026-10-10T10:00",
      to: "2026-10-10T20:00",
    });
    const banco = await reservasNoBanco();
    assert.equal(banco.length, 2);
    const timeline = await reservasNaTimeline();
    for (const r of banco) {
      assert.ok(timeline.has(r.id), `reserva ${r.number} (60 cadeiras) nao renderizada na timeline`);
    }
  });

  it("todas as reservas do periodo aparecem — varredura completa", async () => {
    // cenario completo misturando bordas, multi-dia, consecutivas e sobreposicao
    await criarReserva(c.clienteId, [{ product_id: c.mesaId, qty: 2 }, { product_id: c.cadeiraId, qty: 40 }], "confirmada", {
      from: "2026-10-08T14:00", to: "2026-10-10T10:00",
    }); // atravessa o inicio
    await criarReserva(c.clienteId, [{ product_id: c.cadeiraId, qty: 20 }], "confirmada", {
      from: "2026-10-09T09:00", to: "2026-10-09T18:00",
    }); // dia unico no inicio
    await criarReserva(c.clienteId, [{ product_id: c.mesaId, qty: 3 }], "confirmada", {
      from: "2026-10-10T14:00", to: "2026-10-10T18:00",
    }); // dia unico ao meio
    await criarReserva(c.clienteId, [{ product_id: c.mesaId, qty: 1 }], "confirmada", {
      from: "2026-10-10T18:00", to: "2026-10-10T22:00",
    }); // consecutiva
    await criarReserva(c.clienteId, [{ product_id: c.kitId, qty: 2 }], "confirmada", {
      from: "2026-10-09T10:00", to: "2026-10-12T10:00",
    }); // kit multi-dia
    await criarReserva(c.clienteId, [{ product_id: c.cadeiraId, qty: 30 }], "pre_reserva", {
      from: "2026-10-11T09:00", to: "2026-10-13T18:00",
    }); // atravessa o fim
    await criarReserva(c.clienteId, [{ product_id: c.cadeiraId, qty: 10 }], "confirmada", {
      from: "2026-10-12T08:00", to: "2026-10-12T20:00",
    }); // ultimo dia da janela

    const banco = await reservasNoBanco();
    const timeline = await reservasNaTimeline();
    const holds = await loadHolds(DE, ATE);
    const noMotor = new Set(holds.map((h) => h.reservation_id));

    assert.equal(banco.length, 7, "banco deveria ter 7 reservas na janela");
    for (const r of banco) {
      assert.ok(noMotor.has(r.id), `reserva ${r.number} ausente do motor (loadHolds)`);
      assert.ok(timeline.has(r.id), `reserva ${r.number} ausente da TIMELINE (renderizacao)`);
    }
  });
});
