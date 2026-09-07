// @ts-ignore OpenNext generates this module during the deployment build.
import handler from "./.open-next/worker.js";
import { runNotificationScheduler, webPushSender } from "./src/lib/push-scheduler";
import { runFidelityDaily } from "./src/lib/fidelidade-cron";

export default {
  fetch: handler.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNotificationScheduler(env.DB, Math.floor(event.scheduledTime/1000),
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? webPushSender({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }) : undefined,
    ).then(result => { console.log(JSON.stringify({ event: "notification_cron", ...result })); }));
    // fidelidade uma vez por dia: expirar recompensas e preparar lembretes nao
    // pode depender de alguem abrir o sistema
    ctx.waitUntil(runFidelityDaily(env.DB, Math.floor(event.scheduledTime / 1000))
      .then(result => { if (result) console.log(JSON.stringify({ event: "fidelity_cron", ...result })); }));
  },
} satisfies ExportedHandler<CloudflareEnv>;
