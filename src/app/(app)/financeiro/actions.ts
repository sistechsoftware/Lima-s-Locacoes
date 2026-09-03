"use server";
import { revalidatePath } from "next/cache";
import { insert, one, run } from "@/lib/db";
import { assertAdmin, requireUser } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { money, parseMoney, today } from "@/lib/format";

export async function addExpense(fd: FormData) {
  const user = await requireUser();
  const amount = parseMoney(String(fd.get("amount") ?? ""));
  if (amount <= 0) return;
  const id = await insert(
    `INSERT INTO expenses (date, category, description, amount_cents, method, reservation_id, status, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      String(fd.get("date") ?? "") || today(),
      String(fd.get("category") ?? "Outros"),
      String(fd.get("description") ?? ""),
      amount,
      String(fd.get("method") ?? "pix"),
      Number(fd.get("reservation_id")) || null,
      String(fd.get("status") ?? "pago"),
      user.id,
    ],
  );
  await logAction(user, "criar", "despesa", id, `${user.name} lancou despesa de ${money(amount)}`);
  revalidatePath("/financeiro");
}

export async function deleteExpense(fd: FormData) {
  const user = await assertAdmin();
  const id = Number(fd.get("id"));
  const e = await one<any>(`SELECT * FROM expenses WHERE id = ?`, [id]);
  if (!e) return;
  await run(`DELETE FROM expenses WHERE id = ?`, [id]);
  await logAction(user, "excluir", "despesa", id, `${user.name} removeu despesa de ${money(e.amount_cents)}`);
  revalidatePath("/financeiro");
}

/** Lancamento avulso de entrada, sem reserva vinculada. */
export async function addIncome(fd: FormData) {
  const user = await requireUser();
  const amount = parseMoney(String(fd.get("amount") ?? ""));
  if (amount <= 0) return;
  const id = await insert(
    `INSERT INTO payments (reservation_id, freight_id, amount_cents, method, paid_at, notes, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [
      Number(fd.get("reservation_id")) || null,
      Number(fd.get("freight_id")) || null,
      amount,
      String(fd.get("method") ?? "pix"),
      String(fd.get("paid_at") ?? "") || today(),
      String(fd.get("notes") ?? "Entrada avulsa"),
      user.id,
    ],
  );
  await logAction(user, "criar", "pagamento", id, `${user.name} lancou entrada de ${money(amount)}`);
  revalidatePath("/financeiro");
}
