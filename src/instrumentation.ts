/** Executado uma vez na inicializacao do servidor Next. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("./lib/db");
  const { ensureSeed } = await import("./lib/seed");
  const { purgeExpiredSessions } = await import("./lib/auth");
  const { purgeExpiredPortalSessions } = await import("./lib/portal-auth");
  getDb();
  await ensureSeed();
  await purgeExpiredSessions();
  await purgeExpiredPortalSessions();
}
