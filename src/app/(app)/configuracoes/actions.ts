"use server";
import { preparationValue } from "@/lib/availability-time";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { insert, one, run, scalar } from "@/lib/db";
import { assertAdmin, hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { getSettings, setSettings } from "@/lib/settings";

export async function saveStockSettings(fd: FormData) {
  const user = await assertAdmin();
  let minutes: number;
  try { minutes = preparationValue(fd.get("stock_preparation_minutes")); }
  catch (e) { redirect(`/configuracoes?aba=disponibilidade&erro=${encodeURIComponent((e as Error).message)}`); }
  await setSettings({ stock_preparation_minutes: String(minutes) });
  await logAction(user, "editar", "configuracao", null, `${user.name} configurou ${minutes} minutos de preparacao do estoque`);
  revalidatePath("/", "layout");
}
import { logAction } from "@/lib/audit";
import { saveUpload, UploadError, removeFileByUrl } from "@/lib/uploads";
import { parseMoney } from "@/lib/format";

export async function saveCompanySettings(fd: FormData): Promise<void> {
  const user = await assertAdmin();
  const logoFile = fd.get("logo_file");
  let logoPath: string | null = null;
  if (logoFile instanceof File && logoFile.size > 0) {
    try {
      logoPath = await saveUpload(logoFile, user.id);
    } catch (e) {
      const motivo = e instanceof UploadError ? e.message : "Não foi possível salvar a imagem.";
      redirect(`/configuracoes?aba=empresa&erro=${encodeURIComponent(motivo)}`);
    }
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
  if (logoPath) {
    // troca a logo e descarta a anterior, para nao acumular arquivo orfao
    const anterior = (await getSettings()).company_logo;
    values.company_logo = logoPath;
    if (anterior && anterior !== logoPath) await removeFileByUrl(anterior);
  }

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
  if (!name || !username) return "Informe nome e usuário.";
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
    redirect(`/configuracoes?erro=${encodeURIComponent("Categoria em uso por produtos, não pode ser removida.")}`);
  }
  const c = await one<any>(`SELECT name FROM categories WHERE id = ?`, [id]);
  await run(`DELETE FROM categories WHERE id = ?`, [id]);
  await logAction(user, "excluir", "categoria", id, `${user.name} removeu a categoria ${c?.name}`);
  revalidatePath("/configuracoes");
}

/** Parametros usados pela calculadora de frete. */
export async function saveFreightSettings(fd: FormData) {
  const user = await assertAdmin();
  const tipo = fd.get("tipo");
  if (tipo !== "comum" && tipo !== "locacao") throw new Error("Tipo de frete inválido.");
  const values = {
    freight_fuel_type: String(fd.get("fuel_type") ?? "").trim() || "Combustivel",
    freight_fuel_price_cents: String(parseMoney(String(fd.get("fuel_price") ?? ""))),
    freight_consumption: String(Math.max(0, Number(String(fd.get("consumption") ?? "").replace(",", ".")) || 0)),
    freight_cost_per_km_cents: String(parseMoney(String(fd.get("cost_per_km") ?? ""))),
    freight_margin_percent: String(Math.max(0, Math.min(95, Number(fd.get("margin")) || 0))),
    freight_minimum_cents: String(parseMoney(String(fd.get("minimum") ?? ""))),
    freight_rounding_cents: String(parseMoney(String(fd.get("rounding") ?? ""))),
    freight_labor_cents: String(parseMoney(String(fd.get("labor") ?? ""))),
  };
  await setSettings({ ...Object.fromEntries(Object.entries(values).map(([key,value]) => [key.replace("freight_", `freight_${tipo}_`), value])), [`freight_${tipo}_base_address`]: String(fd.get("base_address") ?? "").trim().slice(0,400) });
  await logAction(user, "editar", "configuracao", null, `${user.name} atualizou os parametros do frete`);
  revalidatePath("/configuracoes");
  revalidatePath("/fretes/calculadora");
}

/**
 * Regras e mensagens da fidelidade.
 *
 * Fica tudo em settings, junto com o resto da configuracao do sistema: nao ha
 * motivo para uma tabela de programa so para guardar meia duzia de numeros que
 * o administrador edita nesta tela.
 */
export async function saveFidelitySettings(fd: FormData) {
  const user = await assertAdmin();
  const inteiro = (campo: string, padrao: number, max: number) => {
    const v = Math.trunc(Number(fd.get(campo)));
    return String(Number.isFinite(v) && v >= 0 ? Math.min(v, max) : padrao);
  };
  const marcado = (campo: string) => (String(fd.get(campo) ?? "") === "1" ? "1" : "0");

  const eventos = ["progresso", "quase_la", "conquista", "uso", "vencendo", "expirada"];
  const mensagens = Object.fromEntries(
    eventos.map((e) => [`fidelity_msg_${e}`, String(fd.get(`msg_${e}`) ?? "").trim().slice(0, 1000)]),
  );

  await setSettings({
    fidelity_active: marcado("active"),
    fidelity_goal: inteiro("goal", 5, 100) === "0" ? "1" : inteiro("goal", 5, 100),
    fidelity_kits: inteiro("kits", 5, 100),
    fidelity_validity_days: inteiro("validity_days", 0, 3650),
    fidelity_accumulate: marcado("accumulate"),
    fidelity_count_free_rental: marcado("count_free_rental"),
    fidelity_return_on_cancel: marcado("return_on_cancel"),
    fidelity_min_value_cents: String(parseMoney(String(fd.get("min_value") ?? ""))),
    fidelity_eligible_status: String(fd.get("eligible_status") ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .join(","),
    fidelity_expiry_reminders: String(fd.get("expiry_reminders") ?? "").trim().slice(0, 60),
    fidelity_window_start: String(fd.get("window_start") ?? "08:00").slice(0, 5),
    fidelity_window_end: String(fd.get("window_end") ?? "20:00").slice(0, 5),
    fidelity_notify_progress: marcado("fidelity_notify_progress"),
    fidelity_notify_almost: marcado("fidelity_notify_almost"),
    fidelity_notify_earned: marcado("fidelity_notify_earned"),
    fidelity_notify_used: marcado("fidelity_notify_used"),
    fidelity_notify_expiring: marcado("fidelity_notify_expiring"),
    fidelity_notify_expired: marcado("fidelity_notify_expired"),
    ...mensagens,
  });

  // alterar a regra nao mexe em recompensa ja conquistada: cada uma guarda o
  // retrato da regra do dia em que nasceu
  await logAction(user, "editar", "configuracao", null, `${user.name} atualizou o programa de fidelidade`);
  revalidatePath("/configuracoes");
  revalidatePath("/fidelidade");
}

/** Avisos de aniversario: antecedencia, canais e horario. */
export async function saveBirthdaySettings(fd: FormData) {
  const user = await assertAdmin();
  const inteiro = (campo: string, padrao: number, max: number) => {
    const v = Math.trunc(Number(fd.get(campo)));
    return String(Number.isFinite(v) && v >= 0 ? Math.min(v, max) : padrao);
  };
  const marcado = (campo: string) => (String(fd.get(campo) ?? "") === "1" ? "1" : "0");

  await setSettings({
    birthday_active: marcado("active"),
    birthday_days_ahead: inteiro("days_ahead", 7, 366),
    birthday_notify_today: marcado("notify_today"),
    birthday_notify_upcoming: marcado("notify_upcoming"),
    birthday_push: marcado("push"),
    birthday_hour: inteiro("hour", 8, 23),
  });
  await logAction(user, "editar", "configuracao", null, `${user.name} atualizou os avisos de aniversario`);
  revalidatePath("/configuracoes");
  revalidatePath("/aniversarios");
}
