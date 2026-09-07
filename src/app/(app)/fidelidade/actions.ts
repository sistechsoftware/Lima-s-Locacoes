"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { nowLocal } from "@/lib/format";

/** Marca a mensagem como enviada ou dispensada, para sair da fila. */
export async function marcarMensagem(fd: FormData) {
  await requireUser();
  const id = Number(fd.get("id"));
  const status = String(fd.get("status"));
  if (status !== "enviada" && status !== "dispensada") return;
  await run(
    `UPDATE fidelity_messages SET status=?, sent_at=? WHERE id=? AND status='pendente'`,
    [status, status === "enviada" ? nowLocal() : null, id],
  );
  revalidatePath("/fidelidade");
}
