/**
 * Rotina diaria da fidelidade, chamada pelo cron que ja existe.
 *
 * O cron do sistema roda a cada minuto por causa dos lembretes operacionais.
 * A fidelidade nao precisa disso: expirar recompensa e avisar vencimento sao
 * tarefas de uma vez por dia, e repetir a cada minuto so gastaria consulta.
 * A marca do ultimo dia processado fica em scheduler_state.
 */
export async function runFidelityDaily(db: D1Database, nowSeconds: number) {
  const hoje = new Date((nowSeconds - 10800) * 1000).toISOString().slice(0, 10); // America/Sao_Paulo
  const marca = await db
    .prepare("SELECT value FROM scheduler_state WHERE key = 'fidelity_last_day'")
    .first<{ value: string }>();
  if (marca?.value === hoje) return null;

  await db
    .prepare(
      `INSERT INTO scheduler_state(key,value) VALUES ('fidelity_last_day',?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(hoje)
    .run();

  // o modulo usa o acesso a banco da aplicacao, entao recebe o binding por
  // runWithDb: o cron nao tem contexto de requisicao
  const { rotinaDiaria } = await import("./fidelidade-db");
  const { runWithDb } = await import("./db");
  return await runWithDb(db, rotinaDiaria);
}
