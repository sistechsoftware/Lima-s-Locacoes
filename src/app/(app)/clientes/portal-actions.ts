"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { gerarConviteAcesso } from "@/lib/portal-auth";
import { logAction } from "@/lib/audit";
import { waLink } from "@/lib/format";

/**
 * Gera (ou renova) o convite de acesso ao portal de um cliente.
 *
 * Acao administrativa: quem decide quem tem portal e a equipe. O token so
 * existe legivel aqui, nesta resposta — o banco guarda o SHA-256. A tela
 * recebe o link pronto para copiar/mandar pelo WhatsApp.
 */
export async function gerarAcessoPortal(fd: FormData) {
  const user = await requireUser();
  const id = Number(fd.get("id"));
  const convite = await gerarConviteAcesso(id);
  if (!convite) redirect(`/clientes/${id}?aviso=${encodeURIComponent("Cliente não encontrado ou inativo.")}`);

  const origem = process.env.PORTAL_BASE_URL || "";
  const link = `${origem}/portal/primeiro-acesso?token=${convite!.token}`;

  await logAction(
    user,
    "criar",
    "cliente",
    id,
    `${user.name} gerou um convite de acesso ao portal para o cliente`,
  );
  revalidatePath(`/clientes/${id}`);
  redirect(`/clientes/${id}?portal_link=${encodeURIComponent(link)}&portal_wa=${encodeURIComponent(convite!.whatsapp ?? "")}`);
}
