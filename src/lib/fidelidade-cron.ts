import { runWithDb } from "./db";

/**
 * Rotina diaria da fidelidade, chamada pelo cron que ja existe.
 *
 * O cron do sistema roda a cada minuto por causa dos lembretes operacionais.
 * A fidelidade nao precisa disso: expirar recompensa e avisar vencimento sao
 * tarefas de uma vez por dia, e repetir a cada minuto so gastaria consulta.
 * A marca do ultimo dia processado fica em scheduler_state, gravada SO quando
 * a rotina termina com sucesso — uma falha deixa a marcacao vazia e o proximo
 * minuto tenta de novo (mesma estrategia dos aniversarios).
 */
export async function runFidelityDaily(db: D1Database, nowSeconds: number) {
  const hoje = new Date((nowSeconds - 10800) * 1000).toISOString().slice(0, 10); // America/Sao_Paulo
  const marca = await db
    .prepare("SELECT value FROM scheduler_state WHERE key = 'fidelity_last_day'")
    .first<{ value: string }>();
  if (marca?.value === hoje) return null;

  // o modulo usa o acesso a banco da aplicacao, entao recebe o binding por
  // runWithDb: o cron nao tem contexto de requisicao. O import tambem entra
  // dentro da janela para que nada do modulo execute sem o binding ativo.
  const resultado = await runWithDb(db, async () => {
    const { rotinaDiaria } = await import("./fidelidade-db");
    return await rotinaDiaria();
  });

  // A marca fica SO depois de dar certo: uma falha nao pode perder o dia
  // inteiro de expiracao/lembretes (o cron tenta de novo no minuto seguinte,
  // como ja fazem os aniversarios). Rotina idempotente: repetir nao duplica.
  await db
    .prepare(
      `INSERT INTO scheduler_state(key,value) VALUES ('fidelity_last_day',?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(hoje)
    .run();
  return resultado;
}

/**
 * Rotina diaria dos aniversarios, no mesmo cron do resto.
 *
 * Roda uma vez por dia, a partir da hora configurada. Antes disso o dia nao e
 * marcado, entao a rotina tenta de novo no minuto seguinte: uma falha as 8h
 * nao faz a empresa perder o aviso do dia.
 */
export async function runBirthdayDaily(db: D1Database, nowSeconds: number) {
  const local = new Date((nowSeconds - 10800) * 1000); // America/Sao_Paulo
  const hoje = local.toISOString().slice(0, 10);

  const marca = await db
    .prepare("SELECT value FROM scheduler_state WHERE key = 'birthday_last_day'")
    .first<{ value: string }>();
  if (marca?.value === hoje) return null;

  const hora = await db.prepare("SELECT value FROM settings WHERE key = 'birthday_hour'").first<{ value: string }>();
  const alvo = Math.max(0, Math.min(23, Number(hora?.value ?? 8) || 0));
  if (local.getUTCHours() < alvo) return null;

  // marca o dia so depois de dar certo, para uma falha poder ser repetida;
  // o import do modulo tambem entra dentro da janela do runWithDb
  const resultado = await runWithDb(db, async () => {
    const { rotinaAniversarios } = await import("./aniversarios-db");
    return await rotinaAniversarios(hoje);
  });
  await db
    .prepare(
      `INSERT INTO scheduler_state(key,value) VALUES ('birthday_last_day',?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(hoje)
    .run();
  return resultado;
}
