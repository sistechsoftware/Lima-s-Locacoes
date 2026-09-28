import { assertAdmin } from "@/lib/auth";
import { sellableProducts } from "@/lib/stock";
import { listarPromocoes } from "@/lib/promocoes-db";
import { PageHeader } from "@/components/ui";
import PromotionForm from "../PromotionForm";
import { createPromotion } from "../actions";

export const dynamic = "force-dynamic";

export default async function NovaPromocaoPage() {
  await assertAdmin();
  // o formulario filtra as promocoes existentes pelo produto escolhido, para a
  // conferencia por data mostrar tambem o que ja esta cadastrado
  const [produtos, outras] = await Promise.all([sellableProducts(), listarPromocoes()]);
  return (
    <div className="space-y-4">
      <PageHeader title="Nova Promoção" subtitle="O preço da faixa vale para todas as unidades do item" />
      <PromotionForm action={createPromotion} produtos={produtos} outras={outras} submitLabel="Criar Promoção" />
    </div>
  );
}
