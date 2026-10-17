/**
 * Excluir um lançamento que já tem recibo emitido.
 *
 * Reproduz o incidente de 16/10/2026 (reserva LIMA-014, pagamento de R$ 48,00
 * com recibo RCB-015): o CHECK da receipts (0020/0024) exigia
 * payment_id/deposit_id NOT NULL e a própria chave estrangeira, que aponta com
 * ON DELETE SET NULL, dispara uma atualização que VIOLA esse CHECK. O SQLite
 * avalia o CHECK nessa atualização, então toda tentativa de "Remover" morria
 * com "CHECK constraint failed" — sem apagar nada. O mesmo barra excluir a
 * reserva inteira (payments caem em CASCADE) e excluir a caução.
 *
 * Depois da migration 0028 o alvo pode ficar nulo, que é o cenário que
 * `obterRecibo` já sabe narrar ("o lançamento não existe mais"). Os últimos
 * testes garantem que o CHECK continua barrando o que ele deve barrar.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/d1.ts";
import { insert, one, run, scalar } from "../src/lib/db.ts";
import { emitirRecibo, obterRecibo } from "../src/lib/recibos.ts";

let cliente = 0;
let seq = 0;

async function cenario() {
  createTestDb();
  seq = 0;
  await insert(`INSERT INTO users (id, name, username, password_hash, role) VALUES (1,'Admin','admin','x','admin')`);
  cliente = await insert(`INSERT INTO customers (name, doc, phone) VALUES ('Joao da Silva','12345678909','11999990000')`);
}

async function reserva(totalCents = 16000) {
  seq++;
  return await insert(
    `INSERT INTO reservations (number, customer_id, status, event_date, total_cents, address, city)
     VALUES (?,?,'confirmada','2026-10-16',?, 'Rua das Flores, 100','Sao Paulo')`,
    [`LIMA-${String(seq).padStart(3, "0")}`, cliente, totalCents],
  );
}

async function pagamento(reservationId: number, amountCents: number) {
  return await insert(
    `INSERT INTO payments (reservation_id, amount_cents, method, paid_at, created_by)
     VALUES (?,?,?,?,1)`,
    [reservationId, amountCents, "pix", "2026-09-25"],
  );
}

async function caucaoRecebida(reservationId: number, amountCents: number) {
  return await insert(
    `INSERT INTO deposits (reservation_id, amount_cents, method, received_at, status)
     VALUES (?,?,'pix','2026-09-25','recebida')`,
    [reservationId, amountCents],
  );
}

describe("excluir pagamento com recibo emitido", () => {
  beforeEach(cenario);

  it("apaga o pagamento (mesmo SQL da action Remover) e o recibo fica sem alvo", async () => {
    const r = await reserva();
    const p = await pagamento(r, 4800);
    const { erro, receiptId } = await emitirRecibo({ tipo: "payment", paymentId: p }, { userId: 1, userName: "Admin" });
    assert.equal(erro, null);

    // exatamente o SQL de deletePayment (src/app/(app)/reservas/actions.ts)
    await assert.doesNotReject(run(`DELETE FROM payments WHERE id = ?`, [p]));

    assert.equal(await scalar(`SELECT COUNT(*) FROM payments WHERE id = ?`, [p]), 0);
    const rec = await one<any>(`SELECT * FROM receipts WHERE id = ?`, [receiptId]);
    assert.equal(rec.number, "RCB-001");
    assert.equal(rec.source_type, "payment");
    assert.equal(rec.payment_id, null);

    // a pagina do recibo continua abrindo e explica que o lancamento sumiu
    const dados = await obterRecibo(rec.id);
    assert.equal(dados!.lancamentoExiste, false);
    assert.equal(dados!.tipo, "Pagamento");
    assert.equal(dados!.valorAtual, 4800); // snapshot congelado na emissao
  });

  it("excluir a reserva inteira passa (payments e deposits caem em cascade)", async () => {
    const r = await reserva();
    const p = await pagamento(r, 4800);
    const dep = await caucaoRecebida(r, 2000);
    const pgto = await emitirRecibo({ tipo: "payment", paymentId: p }, { userId: 1, userName: "Admin" });
    const caucao = await emitirRecibo({ tipo: "deposit", depositId: dep }, { userId: 1, userName: "Admin" });
    assert.equal(pgto.erro, null);
    assert.equal(caucao.erro, null);

    await assert.doesNotReject(run(`DELETE FROM reservations WHERE id = ?`, [r]));

    assert.equal(await scalar(`SELECT COUNT(*) FROM payments WHERE reservation_id = ?`, [r]), 0);
    assert.equal(await scalar(`SELECT COUNT(*) FROM deposits WHERE reservation_id = ?`, [r]), 0);
    assert.equal(await scalar(`SELECT COUNT(*) FROM receipts`), 2); // comprovantes sobrevivem
    assert.equal(await scalar(`SELECT payment_id FROM receipts WHERE id = ?`, [pgto.receiptId!]), null);
    assert.equal(await scalar(`SELECT deposit_id FROM receipts WHERE id = ?`, [caucao.receiptId!]), null);
  });

  it("excluir a caução com recibo emitido tambem passa", async () => {
    const r = await reserva();
    const dep = await caucaoRecebida(r, 5000);
    const { erro, receiptId } = await emitirRecibo({ tipo: "deposit", depositId: dep }, { userId: 1, userName: "Admin" });
    assert.equal(erro, null);

    await assert.doesNotReject(run(`DELETE FROM deposits WHERE id = ?`, [dep]));

    const rec = await one<any>(`SELECT * FROM receipts WHERE id = ?`, [receiptId]);
    assert.equal(rec.deposit_id, null);
    const dados = await obterRecibo(rec.id!);
    assert.equal(dados!.lancamentoExiste, false);
  });
});

describe("o CHECK continua valendo para lançamento inválido", () => {
  beforeEach(cenario);

  it("nao deixa misturar alvos nem recibo de quitação sem obrigação/congelamento", async () => {
    const r = await reserva();
    const p = await pagamento(r, 4800);
    const dep = await caucaoRecebida(r, 5000);

    // recibo de pagto com caução de alvo (alvos precisam continuar exclusivos)
    await assert.rejects(
      insert(
        `INSERT INTO receipts (number, source_type, payment_id, deposit_id, amount_cents, paid_at)
         VALUES ('RCB-900','payment',?,?,4800,'2026-09-25')`,
        [p, dep],
      ),
      /CHECK constraint/i,
    );

    // recibo de caução apontando tambem para um pagamento
    await assert.rejects(
      insert(
        `INSERT INTO receipts (number, source_type, payment_id, deposit_id, amount_cents, paid_at)
         VALUES ('RCB-901','deposit',?,?,5000,'2026-09-25')`,
        [p, dep],
      ),
      /CHECK constraint/i,
    );

    // quitação exige obrigação E composição congelada
    await assert.rejects(
      insert(
        `INSERT INTO receipts (number, source_type, amount_cents, paid_at, obrigacao_tipo, obrigacao_id, payment_ids)
         VALUES ('RCB-902','quitacao',16000,'2026-10-16','locacao',?,NULL)`,
        [r],
      ),
      /CHECK constraint/i,
    );
  });
});