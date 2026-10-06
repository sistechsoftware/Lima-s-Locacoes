import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import ReservationForm from "../ReservationForm";
import { createReservation } from "../actions";
import { sellableProducts } from "@/lib/stock";
import { preparationMinutes } from "@/lib/availability-settings";
import { normalizeStamp, timeWindow } from "@/lib/availability-time";
import { CUSTOMER_PICK_COLUMNS } from "@/lib/queries";
import { activeAccounts } from "@/lib/compras";
import type { ItemRow } from "@/components/ItemsEditor";

export const dynamic = "force-dynamic";

/**
 * Prefill vindo da Timeline de disponibilidade: clique num espaco livre abre
 * esta pagina com a janela (entrega/retirada) e o produto ja escolhidos.
 *
 * Os parametros sao SEMPRE tratados como sugestao: qualquer valor invalido e
 * ignorado e o formulario abre normalmente. A confirmacao da disponibilidade
 * acontece no servidor, duas vezes — no carregamento (useStockCheck) e de novo
 * no envio (createReservation -> checkConflicts). Nao existe caminho em que a
 * janela escolhida na timeline seja salva sem revalidacao.
 */
function janelaSugerida(inicio?: string, fim?: string) {
  if (!inicio) return undefined;
  try {
    const from = normalizeStamp(inicio);
    const to = normalizeStamp(fim || inicio);
    timeWindow(from, to); // exige fim > inicio
    return { event_date: from.slice(0, 10), delivery_at: from, pickup_at: to };
  } catch {
    return undefined;
  }
}

/** Apenas caminhos internos voltam apos a criacao (nunca URL externa). */
function retornoInterno(next?: string): string | undefined {
  if (!next) return undefined;
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : undefined;
}

export default async function NovaReservaPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string; frete?: string; inicio?: string; fim?: string; produto?: string; next?: string }>;
}) {
  const user = await requireUser();
  const { cliente, frete, inicio, fim, produto, next } = await searchParams;

  const products = await sellableProducts();
  const contas = await activeAccounts();
  const customers = await all<any>(
    `SELECT ${CUSTOMER_PICK_COLUMNS} FROM customers c WHERE c.active = 1 ORDER BY c.name`,
  );

  const janela = janelaSugerida(inicio, fim);
  const produtoId = Number(produto) || 0;
  const produtoInicial = products.find((p) => p.id === produtoId);
  const items: ItemRow[] = produtoInicial
    ? [{ product_id: produtoInicial.id, qty: 1, unit_price_cents: produtoInicial.rent_price_cents, discount_cents: 0 }]
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Nova Reserva"
        subtitle={
          janela && produtoInicial
            ? `Espaço livre na timeline: ${produtoInicial.name}, ${janela.delivery_at.replace("T", " ")} → ${janela.pickup_at.replace("T", " ")}`
            : "O sistema verifica o estoque automaticamente"
        }
      />
      <ReservationForm
        preparationMinutes={await preparationMinutes()}
        action={createReservation}
        products={products}
        customers={customers}
        isAdmin={user.role === "admin"}
        defaultCustomerId={cliente ? Number(cliente) : undefined}
        freteInicial={frete}
        submitLabel="Criar reserva"
        contas={contas}
        janela={janela}
        items={items}
        next={retornoInterno(next)}
      />
    </div>
  );
}
