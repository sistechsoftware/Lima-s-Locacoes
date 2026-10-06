/**
 * runWithDb no modo concorrente (o cenario do cron).
 *
 * O Worker dispara varias rotinas no mesmo tick (notificacoes, fidelidade,
 * aniversarios, poda do diario). O binding do banco precisa continuar valendo
 * enquanto QUALQUER rotina ainda estiver rodando: se a primeira a terminar
 * apagasse o binding, a proxima consulta da outra caia em
 * getCloudflareContext(), que nao existe fora de requisicao — era exatamente
 * o erro do Diario de Erros em cron/aniversarios e cron/fidelidade
 * ("getCloudflareContext has been called without having called
 * initOpenNextCloudflareForDev").
 *
 * Cuidado com o atalho de teste: getDb() prioriza globalThis.__limasTestDb,
 * entao o cenario so existe com esse atalho desligado — sem ele, a falha
 * vira exatamente a excecao de getCloudflareContext.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/d1";
import { getDb, one, runWithDb } from "../src/lib/db";

describe("runWithDb sob concorrencia (cron)", () => {
  it("binding continua valendo enquanto houver rotina ativa", async () => {
    const db = createTestDb();
    // fora o atalho: sem ele, getDb() so encontra o binding do agendador
    (globalThis as any).__limasTestDb = undefined;
    try {
      let liberar!: () => void;
      const gate = new Promise<void>((r) => (liberar = r));

      // rotina A: termina ENQUANTO a rotina B ainda esta no meio do trabalho
      const a = runWithDb(db as any, async () => {
        await gate;
        return "A";
      });
      // rotina B: a consulta dela acontece DEPOIS de A ja ter terminado
      const b = runWithDb(db as any, async () => {
        await gate;
        const linha = await one<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'");
        assert.ok(linha && linha.n > 0, "consulta da rotina B precisa encontrar o banco");
        return "B";
      });

      liberar();
      const [ra, rb] = await Promise.all([a, b]);
      assert.equal(ra, "A");
      assert.equal(rb, "B");

      // com todas as rotinas fora, o binding volta a ficar indefinido:
      // fora de cron e requisicao, getDb() nao pode achar banco nenhum
      assert.throws(() => getDb(), "sem rotina ativa o binding precisa ser limpo");
    } finally {
      (globalThis as any).__limasTestDb = db;
    }
  });

  it("execucoes aninhadas no mesmo fluxo usam o mesmo banco", async () => {
    const db = createTestDb();
    (globalThis as any).__limasTestDb = undefined;
    try {
      const ok = await runWithDb(db as any, async () => {
        const externo = await one<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'");
        const interno = await runWithDb(db as any, async () => {
          return await one<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'");
        });
        assert.equal(externo!.n, interno!.n);
        return true;
      });
      assert.equal(ok, true);
      assert.throws(() => getDb());
    } finally {
      (globalThis as any).__limasTestDb = db;
    }
  });
});
