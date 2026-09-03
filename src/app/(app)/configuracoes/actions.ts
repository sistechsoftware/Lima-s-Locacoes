"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { insert, one, run, scalar } from "@/lib/db";
import { assertAdmin, hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { setSettings } from "@/lib/settings";
import { logAction } from "@/lib/audit";
import { saveUpload } from "@/lib/uploads";
import { parseMoney } from "@/lib/format";

export async function saveCompanySettings(fd: FormData): Promise<void> {
  const user = await assertAdmin();
  const logoFile = fd.get("logo_file");
  let logoPath: string | null = null;
  if (logoFile instanceof File && logoFile.size > 0) {
    logoPath = await saveUpload(logoFile);
  }

  const values: Record<string, string> = {
    company_name: String(fd.get("company_name") ?? "").trim() || "Lima's Locacoes",
    company_tagline: String(fd.get("company_tagline") ?? "").trim(),
    company_doc: String(fd.get("company_doc") ?? "").trim(),
    company_phone: String(fd.get("company_phone") ?? "").trim(),
    company_whatsapp: String(fd.get("company_whatsapp") ?? "").trim(),
    company_email: String(fd.get("company_email") ?? "").trim(),
    company_address: String(fd.get("company_address") ?? "").trim(),
    company_city: String(fd.get("company_city") ?? "").trim(),
    pix_key: String(fd.get("pix_key") ?? "").trim(),
    bank_info: String(fd.get("bank_info") ?? "").trim(),
    default_deposit_cents: String(parseMoney(String(fd.get("default_deposit") ?? ""))),
  };
  if (logoPath) values.company_logo = logoPath;

  await setSettings(values);
  await logAction(user, "editar", "configuracao", null, `${user.name} atualizou os dados da empresa`);
  revalidatePath("/configuracoes");
  revalidatePath("/dashboard", "layout");
}

export async function saveTemplates(fd: FormData) {
  const user = await assertAdmin();
  await setSettings({
    contract_template: String(fd.get("contract_template") ?? ""),
    wa_confirm: String(fd.get("wa_confirm") ?? ""),
    wa_delivery: String(fd.get("wa_delivery") ?? ""),
    wa_pickup: String(fd.get("wa_pickup") ?? ""),
    wa_payment: String(fd.get("wa_payment") ?? ""),
    wa_quote: String(fd.get("wa_quote") ?? ""),
  });
  await logAction(user, "editar", "configuracao", null, `${user.name} atualizou os modelos de contrato e WhatsApp`);
  revalidatePath("/configuracoes");
}

/* ---------------------------------- usuarios ----------------------------------- */

export async function createUser(_prev: string | null, fd: FormData): Promise<string | null> {
  const user = await assertAdmin();
  const name = String(fd.get("name") ?? "").trim();
  const username = String(fd.get("username") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const role = String(fd.get("role") ?? "operador");
  if (!name || !username) return "Informe nome e usuario.";
  if (password.length < 6) return "A senha deve ter ao menos 6 caracteres.";
  if (await scalar<number>(`SELECT COUNT(*) FROM users WHERE username = ?`, [username]) > 0) return "Usuario ja existe.";

  const id = await insert(`INSERT INTO users (name, username, email, phone, password_hash, role) VALUES (?,?,?,?,?,?)`, [
    name,
    username,
    String(fd.get("email") ?? ""),
    String(fd.get("phone") ?? ""),
    hashPassword(password),
    role === "admin" ? "admin" : "operador",
  ]);
  await logAction(user, "criar", "usuario", id, `${user.name} criou o usuario ${name} (${role})`);
  revalidatePath("/configuracoes");
  return null;
}

export async function toggleUser(fd: FormData) {
  const admin = await assertAdmin();
  const id = Number(fd.get("id"));
  if (id === admin.id) return; // nao permite se autodesativar
  const u = await one<any>(`SELECT * FROM users WHERE id = ?`, [id]);
  if (!u) return;
  await run(`UPDATE users SET active = ? WHERE id = ?`, [u.active ? 0 : 1, id]);
  await logAction(admin, u.active ? "inativar" : "reativar", "usuario", id, `${admin.name} ${u.active ? "inativou" : "reativou"} ${u.name}`);
  revalidatePath("/configuracoes");
}

export async function resetPassword(fd: FormData): Promise<void> {
  const admin = await assertAdmin();
  const id = Number(fd.get("id"));
  const password = String(fd.get("password") ?? "");
  if (password.length < 6) {
    redirect(`/configuracoes?aba=usuarios&erro=${encodeURIComponent("A senha deve ter ao menos 6 caracteres.")}`);
  }
  const u = await one<any>(`SELECT name FROM users WHERE id = ?`, [id]);
  await run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hashPassword(password), id]);
  await logAction(admin, "editar", "usuario", id, `${admin.name} redefiniu a senha de ${u?.name}`);
  revalidatePath("/configuracoes");
}

export async function changeOwnPassword(_prev: string | null, fd: FormData): Promise<string | null> {
  const user = await requireUser();
  const current = String(fd.get("current") ?? "");
  const next = String(fd.get("next") ?? "");
  if (next.length < 6) return "A nova senha deve ter ao menos 6 caracteres.";
  const row = await one<any>(`SELECT password_hash FROM users WHERE id = ?`, [user.id]);
  if (!row || !verifyPassword(current, row.password_hash)) return "Senha atual incorreta.";
  await run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hashPassword(next), user.id]);
  await logAction(user, "editar", "usuario", user.id, `${user.name} alterou a propria senha`);
  return null;
}

/* --------------------------------- categorias ----------------------------------- */

export async function addCategory(fd: FormData) {
  const user = await requireUser();
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return;
  await run(`INSERT OR IGNORE INTO categories (name) VALUES (?)`, [name]);
  await logAction(user, "criar", "categoria", null, `${user.name} criou a categoria ${name}`);
  revalidatePath("/configuracoes");
}

export async function removeCategory(fd: FormData) {
  const user = await assertAdmin();
  const id = Number(fd.get("id"));
  const usados = await scalar<number>(`SELECT COUNT(*) FROM products WHERE category_id = ?`, [id]);
  if (usados > 0) {
    redirect(`/configuracoes?erro=${encodeURIComponent("Categoria em uso por produtos, nao pode ser removida.")}`);
  }
  const c = await one<any>(`SELECT name FROM categories WHERE id = ?`, [id]);
  await run(`DELETE FROM categories WHERE id = ?`, [id]);
  await logAction(user, "excluir", "categoria", id, `${user.name} removeu a categoria ${c?.name}`);
  revalidatePath("/configuracoes");
}
