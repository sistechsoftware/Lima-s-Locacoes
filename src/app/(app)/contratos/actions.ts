"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { one, run } from "@/lib/db";
import { assertAdmin, requireUser } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { buildContractBody, ensureContract } from "@/lib/contracts";
import { today } from "@/lib/format";

export async function generateContract(fd: FormData) {
  const user = await requireUser();
  const reservationId = Number(fd.get("reservation_id"));
  const id = ensureContract(reservationId, user.id);
  const c = one<any>(`SELECT number FROM contracts WHERE id = ?`, [id]);
  logAction(user, "criar", "contrato", id, `${user.name} gerou o contrato ${c?.number}`);
  revalidatePath(`/reservas/${reservationId}`);
  redirect(`/contratos/${id}`);
}

/** Regera o texto a partir do modelo atual e dos dados atuais da reserva. */
export async function regenerateContract(fd: FormData) {
  const user = await requireUser();
  const id = Number(fd.get("id"));
  const c = one<any>(`SELECT * FROM contracts WHERE id = ?`, [id]);
  if (!c) return;
  if (c.status === "assinado") {
    redirect(`/contratos/${id}?erro=${encodeURIComponent("Contrato assinado nao pode ser regerado.")}`);
  }
  const body = buildContractBody(c.reservation_id, c.number);
  run(`UPDATE contracts SET body = ? WHERE id = ?`, [body, id]);
  logAction(user, "editar", "contrato", id, `${user.name} regerou o contrato ${c.number}`);
  revalidatePath(`/contratos/${id}`);
}

export async function setContractStatus(fd: FormData) {
  const user = await requireUser();
  const id = Number(fd.get("id"));
  const status = String(fd.get("status"));
  const signer = String(fd.get("signer_name") ?? "");
  const c = one<any>(`SELECT * FROM contracts WHERE id = ?`, [id]);
  if (!c) return;

  run(
    `UPDATE contracts SET status = ?, signer_name = COALESCE(NULLIF(?,''), signer_name),
            sent_at = CASE WHEN ? = 'enviado' THEN ? ELSE sent_at END,
            signed_at = CASE WHEN ? = 'assinado' THEN ? ELSE signed_at END
      WHERE id = ?`,
    [status, signer, status, today(), status, today(), id],
  );
  logAction(user, "status", "contrato", id, `${user.name} marcou o contrato ${c.number} como ${status}`);
  revalidatePath(`/contratos/${id}`);
  revalidatePath(`/reservas/${c.reservation_id}`);
}

export async function saveContractBody(fd: FormData) {
  const user = await assertAdmin();
  const id = Number(fd.get("id"));
  const body = String(fd.get("body") ?? "");
  run(`UPDATE contracts SET body = ? WHERE id = ?`, [body, id]);
  logAction(user, "editar", "contrato", id, `${user.name} editou o texto do contrato`);
  revalidatePath(`/contratos/${id}`);
}
