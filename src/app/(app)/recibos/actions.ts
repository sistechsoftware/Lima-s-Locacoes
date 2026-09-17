"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { assertAdmin, requireUser } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { emitirRecibo, excluirRecibo } from "@/lib/recibos";

/**
 * Actions dos recibos.
 *
 * Toda a escrita fica isolada aqui e so toca na tabela receipts. Os
 * lancamentos financeiros (payments, financial_entries, deposits) nao sao
 * lidos para alterar: sao lidos apenas para MONTAR o recibo. Um erro em
 * qualquer ponto abaixo nunca perde, altera ou duplica o lancamento original,
 * que ja esta gravado antes de qualquer chamada chegar aqui.
 */

/**
 * So aceita caminhos internos como destino de volta: o campo vem do formulario
 * e nunca pode virar um redirect para fora do sistema.
 */
function destinoSeguro(bruto: string, fallback: string): string {
  return bruto.startsWith("/") ? bruto : fallback;
}

/**
 * Gera o recibo de um pagamento e abre a pagina dele.
 *
 * Idempotente: se o pagamento ja tem recibo, apenas redireciona para ele.
 * Em caso de erro, volta para a tela de origem com a mensagem, sem tocar em
 * nada — e o usuario pode tentar de novo quantas vezes quiser.
 */
export async function gerarReciboPayment(fd: FormData) {
  const user = await requireUser();
  const paymentId = Number(fd.get("payment_id"));
  const voltarPara = destinoSeguro(String(fd.get("voltar") ?? ""), "/financeiro?aba=receber");

  const { erro, receiptId } = await emitirRecibo(
    { tipo: "payment", paymentId },
    { userId: user.id, userName: user.name },
  );
  if (!erro && receiptId) {
    await logAction(user, "gerar", "recibo", receiptId, `${user.name} gerou o recibo do pagamento #${paymentId}`);
    revalidatePath("/reservas");
    redirect(`/recibos/${receiptId}`);
  }
  redirect(`${voltarPara}${voltarPara.includes("?") ? "&" : "?"}erro=${encodeURIComponent(erro ?? "Erro ao gerar o recibo.")}`);
}

/**
 * Gera o recibo de uma caucao recebida e abre a pagina dele.
 * O recibo da caucao identifica expressamente que se trata de caucao.
 */
export async function gerarReciboDeposit(fd: FormData) {
  const user = await requireUser();
  const depositId = Number(fd.get("deposit_id"));
  const voltarPara = destinoSeguro(String(fd.get("voltar") ?? ""), "/financeiro");

  const { erro, receiptId } = await emitirRecibo(
    { tipo: "deposit", depositId },
    { userId: user.id, userName: user.name },
  );
  if (!erro && receiptId) {
    await logAction(user, "gerar", "recibo", receiptId, `${user.name} gerou o recibo da caução #${depositId}`);
    revalidatePath("/reservas");
    redirect(`/recibos/${receiptId}`);
  }
  redirect(`${voltarPara}${voltarPara.includes("?") ? "&" : "?"}erro=${encodeURIComponent(erro ?? "Erro ao gerar o recibo.")}`);
}

/**
 * Exclui somente o recibo (nunca o lancamento) para permitir reemissao limpa.
 * Somente o administrador pode, no mesmo padrao das demais exclusoes.
 */
export async function excluirReciboAction(fd: FormData) {
  const user = await assertAdmin();
  const receiptId = Number(fd.get("receipt_id"));
  const voltarPara = destinoSeguro(String(fd.get("voltar") ?? ""), "/financeiro");

  const apagou = await excluirRecibo(receiptId);
  if (apagou) {
    await logAction(user, "excluir", "recibo", receiptId, `${user.name} excluiu o recibo ${receiptId} (o lançamento original foi preservado)`);
  }
  revalidatePath("/reservas");
  redirect(voltarPara);
}
