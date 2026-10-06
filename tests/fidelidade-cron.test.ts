/**
 * Rotinas diarias do cron: a marca do dia so nasce depois do sucesso.
 *
 * No Diario de Erros, cron/fidelidade registrava uma falha diaria de
 * getCloudflareContext; alem disso a marca era gravada ANTES de rodar a
 * rotina, entao uma falha silenciosamente perdia o dia inteiro de expiracao
 * de recompensas e lembretes (sem nova tentativa). Este teste trava os dois
 * lados: falha nao marca, sucesso marca e deduplica.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/d1";
import { runBirthdayDaily, runFidelityDaily } from "../src/lib/fidelidade-cron";

/** Epoch de um dia fixo as 11:00 UTC (08:00 em Sao Paulo). */
const SEMANA_FIXA = Date.UTC(2026, 8, 15, 11, 0, 0) / 1000;

let db: ReturnType<typeof createTestDb>;

beforeEach(() => {
  db = createTestDb();
});

const marca = (chave: string) =>
  (db.sqlite.prepare("SELECT value FROM scheduler_state WHERE key = ?").get(chave) as { value: string } | undefined)
    ?.value;

describe("fidelidade diaria no cron", () => {
  it("sucesso grava a marca do dia e a segunda chamada do dia nao repete", async () => {
    const r = await runFidelityDaily(db as any, SEMANA_FIXA);
    assert.ok(r, "primeira chamada do dia roda a rotina");
    assert.equal(marca("fidelity_last_day"), "2026-09-15");
    const deNovo = await runFidelityDaily(db as any, SEMANA_FIXA + 60);
    assert.equal(deNovo, null, "mesmo dia ja marcado nao roda de novo");
  });

  it("falha nao marca o dia: o proximo minuto tenta de novo", async () => {
    // provoca falha real dentro da rotina: a tabela que ela consulta some
    db.sqlite.exec("DROP TABLE fidelity_rewards");
    await assert.rejects(() => runFidelityDaily(db as any, SEMANA_FIXA), "a falha precisa subir para o cron registrar");
    assert.equal(marca("fidelity_last_day"), undefined, "dia com falha nao pode ficar marcado");

    // restaura o schema e confirma que a nova tentativa consegue rodar
    db.sqlite.exec(`CREATE TABLE fidelity_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      reservation_id INTEGER,
      kit_quantity INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'disponivel',
      expires_on TEXT,
      used_reservation_id INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    )`);
    const r = await runFidelityDaily(db as any, SEMANA_FIXA + 60);
    assert.ok(r, "apos restaurar, a tentativa seguinte executa");
    assert.equal(marca("fidelity_last_day"), "2026-09-15");
  });
});

describe("aniversarios diarios no cron", () => {
  it("roda a partir da hora configurada e marca o dia so no sucesso", async () => {
    // 11:00 UTC = 08:00 de SP: na hora alvo (padrao 8)
    const r = await runBirthdayDaily(db as any, SEMANA_FIXA);
    assert.ok(r, "depois da hora alvo a rotina roda");
    assert.equal(marca("birthday_last_day"), "2026-09-15");

    const deNovo = await runBirthdayDaily(db as any, SEMANA_FIXA + 60);
    assert.equal(deNovo, null, "mesmo dia ja marcado nao repete");
  });

  it("antes da hora alvo nao roda e nao marca o dia", async () => {
    const cedo = Date.UTC(2026, 8, 15, 6, 0, 0) / 1000; // 03:00 de SP
    const r = await runBirthdayDaily(db as any, cedo);
    assert.equal(r, null);
    assert.equal(marca("birthday_last_day"), undefined, "antes da hora o dia fica livre para depois");
  });
});
