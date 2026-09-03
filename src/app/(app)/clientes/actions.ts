"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { insert, one, run, scalar } from "@/lib/db";
import { assertAdmin, requireUser } from "@/lib/auth";
import { logAction } from "@/lib/audit";

function readCustomer(fd: FormData) {
  return {
    name: String(fd.get("name") ?? "").trim(),
    doc: String(fd.get("doc") ?? "").trim(),
    phone: String(fd.get("phone") ?? "").trim(),
    whatsapp: String(fd.get("whatsapp") ?? "").trim(),
    email: String(fd.get("email") ?? "").trim(),
    address: String(fd.get("address") ?? "").trim(),
    district: String(fd.get("district") ?? "").trim(),
    city: String(fd.get("city") ?? "").trim(),
    zip: String(fd.get("zip") ?? "").trim(),
    notes: String(fd.get("notes") ?? "").trim(),
  };
}

export async function createCustomer(_prev: string | null, fd: FormData): Promise<string | null> {
  const user = await requireUser();
  const c = readCustomer(fd);
  if (!c.name) return "Informe o nome do cliente.";

  const id = await insert(
    `INSERT INTO customers (name, doc, phone, whatsapp, email, address, district, city, zip, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [c.name, c.doc, c.phone, c.whatsapp || c.phone, c.email, c.address, c.district, c.city, c.zip, c.notes],
  );
  await logAction(user, "criar", "cliente", id, `${user.name} cadastrou o cliente ${c.name}`);
  revalidatePath("/clientes");

  const next = String(fd.get("next") ?? "");
  redirect(next === "reserva" ? `/reservas/nova?cliente=${id}` : `/clientes/${id}`);
}

export async function updateCustomer(_prev: string | null, fd: FormData): Promise<string | null> {
  const user = await requireUser();
  const id = Number(fd.get("id"));
  const c = readCustomer(fd);
  if (!c.name) return "Informe o nome do cliente.";

  await run(
    `UPDATE customers SET name=?, doc=?, phone=?, whatsapp=?, email=?, address=?, district=?, city=?, zip=?, notes=?,
            updated_at = datetime('now','localtime')
      WHERE id = ?`,
    [c.name, c.doc, c.phone, c.whatsapp || c.phone, c.email, c.address, c.district, c.city, c.zip, c.notes, id],
  );
  await logAction(user, "editar", "cliente", id, `${user.name} alterou o cliente ${c.name}`);
  revalidatePath(`/clientes/${id}`);
  redirect(`/clientes/${id}`);
}

/** Inativacao logica: preserva o historico de locacoes do cliente. */
export async function toggleCustomer(fd: FormData) {
  const user = await assertAdmin();
  const id = Number(fd.get("id"));
  const c = await one<any>(`SELECT * FROM customers WHERE id = ?`, [id]);
  if (!c) return;
  const active = c.active ? 0 : 1;
  await run(`UPDATE customers SET active = ? WHERE id = ?`, [active, id]);
  await logAction(user, active ? "reativar" : "inativar", "cliente", id, `${user.name} ${active ? "reativou" : "inativou"} o cliente ${c.name}`);
  revalidatePath(`/clientes/${id}`);
}

/** Exclusao definitiva, permitida apenas quando o cliente nao tem historico. */
export async function deleteCustomer(fd: FormData) {
  const user = await assertAdmin();
  const id = Number(fd.get("id"));
  const usados = await scalar<number>(
    `SELECT (SELECT COUNT(*) FROM reservations WHERE customer_id = ?) + (SELECT COUNT(*) FROM quotes WHERE customer_id = ?)`,
    [id, id],
  );
  const c = await one<any>(`SELECT name FROM customers WHERE id = ?`, [id]);
  if (usados > 0) {
    await run(`UPDATE customers SET active = 0 WHERE id = ?`, [id]);
    await logAction(user, "inativar", "cliente", id, `${user.name} inativou o cliente ${c?.name} (possui historico)`);
    redirect(`/clientes/${id}?aviso=inativado`);
  }
  await run(`DELETE FROM customers WHERE id = ?`, [id]);
  await logAction(user, "excluir", "cliente", id, `${user.name} excluiu o cliente ${c?.name}`);
  redirect("/clientes");
}
