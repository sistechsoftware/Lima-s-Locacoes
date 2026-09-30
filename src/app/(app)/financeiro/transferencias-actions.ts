"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { money, parseMoney, today, valorValido } from "@/lib/format";
import {
  criarTransferencia,
  editarTransferencia,
  excluirTransferencia,
  transferenciaDoGrupo,
} from "@/lib/transferencias";

/** Volta para a aba de transferencias mantendo o periodo em vista. */
function destino(fd: FormData, extra: Record<string, string>): string {
  const params = new URLSearchParams({ aba: "transferencias" });
  const de = String(fd.get("de") ?? "");
  const ate = String(fd.get("ate") ?? "");
  if (de) params.set("de", de);
  if (ate) params.set("ate", ate);
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  return `/financeiro?${params}`;
}

type Campos = { origemId: number; destinoId: number; valorCents: number; data: string; observacao: string; bruto: string };

function lerCampos(fd: FormData): Campos {
  return {
    origemId: Number(fd.get("origem_id")) || 0,
    destinoId: Number(fd.get("destino_id")) || 0,
    valorCents: parseMoney(String(fd.get("amount") ?? "")),
    data: String(fd.get("date") ?? "") || today(),
    observacao: String(fd.get("observacao") ?? "").trim(),
    bruto: String(fd.get("amount") ?? ""),
  };
}

/**
 * Executa a transferencia e comunica o resultado.
 *
 * Mesma disciplina das saidas: nenhum caminho termina em silencio. Ou grava
 * e confirma, ou diz exatamente o que recusou — conta repetida, valor ilegivel,
 * valor zero ou negativo.
 */
export async function transferirValor(fd: FormData) {
  const user = await requireUser();
  const c = lerCampos(fd);

  if (!valorValido(c.bruto)) {
    redirect(destino(fd, { erro: `Nao consegui ler o valor "${c.bruto.trim()}". Use por exemplo 500,00 ou 1.234,56.` }));
  }

  const r = await criarTransferencia({
    origemId: c.origemId,
    destinoId: c.destinoId,
    valorCents: c.valorCents,
    data: c.data,
    observacao: c.observacao,
    userId: user.id,
  });
  if ("erro" in r) redirect(destino(fd, { erro: r.erro }));

  await logAction(
    user,
    "criar",
    "transferencia",
    r.id,
    `${user.name} transferiu ${money(c.valorCents)} entre contas`,
    { transfer_group: r.grupo, origem_id: c.origemId, destino_id: c.destinoId, valor_cents: c.valorCents, data: c.data },
  );
  revalidatePath("/financeiro");
  revalidatePath("/configuracoes");

  redirect(destino(fd, { ok: `Transferência de ${money(c.valorCents)} realizada. Ela não é receita nem despesa: apenas move dinheiro entre as contas.` }));
}

/** Salva a edicao dos dois lados do evento de uma vez. */
export async function editarTransferenciaAction(fd: FormData) {
  const user = await requireUser();
  const grupo = String(fd.get("grupo") ?? "");
  const c = lerCampos(fd);

  if (!valorValido(c.bruto)) {
    redirect(destino(fd, { erro: `Nao consegui ler o valor "${c.bruto.trim()}". Use por exemplo 500,00 ou 1.234,56.` }));
  }

  const atual = await transferenciaDoGrupo(grupo);
  if (!atual) redirect(destino(fd, { erro: "Transferência não encontrada." }));

  const r = await editarTransferencia(grupo, {
    origemId: c.origemId,
    destinoId: c.destinoId,
    valorCents: c.valorCents,
    data: c.data,
    observacao: c.observacao,
    userId: user.id,
  });
  if ("erro" in r) redirect(destino(fd, { erro: r.erro }));

  await logAction(
    user,
    "editar",
    "transferencia",
    null,
    `${user.name} editou a transferência de ${money(atual.valor_cents)} para ${money(c.valorCents)}`,
    { transfer_group: grupo, valor_cents: c.valorCents, data: c.data },
  );
  revalidatePath("/financeiro");
  revalidatePath("/configuracoes");
  redirect(destino(fd, { ok: `Transferência atualizada para ${money(c.valorCents)}. Os dois lados foram ajustados juntos.` }));
}

/** Remove os dois lados de uma vez: o saldo das duas contas volta ao anterior. */
export async function excluirTransferenciaAction(fd: FormData) {
  const user = await requireUser();
  const grupo = String(fd.get("grupo") ?? "");

  const atual = await transferenciaDoGrupo(grupo);
  if (!atual) redirect(destino(fd, { erro: "Transferência não encontrada." }));

  const r = await excluirTransferencia(grupo);
  if ("erro" in r) redirect(destino(fd, { erro: r.erro }));

  await logAction(
    user,
    "excluir",
    "transferencia",
    null,
    `${user.name} excluiu a transferência de ${money(atual.valor_cents)}`,
    { transfer_group: grupo },
  );
  revalidatePath("/financeiro");
  revalidatePath("/configuracoes");
  redirect(destino(fd, { ok: `Transferência de ${money(atual.valor_cents)} excluída. Os saldos das duas contas voltaram ao valor anterior.` }));
}
