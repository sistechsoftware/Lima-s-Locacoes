import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import QuoteForm from "../QuoteForm";
import { createQuote } from "../actions";

export const dynamic = "force-dynamic";

export default async function NovoOrcamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  await requireUser();
  const { cliente } = await searchParams;
  const products = await all<any>(
    `SELECT p.id, p.code, p.name, p.rent_price_cents, p.total_qty, c.name AS category
       FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1 ORDER BY c.name, p.name`,
  );
  const customers = await all<any>(`SELECT id, name, address, district, city FROM customers WHERE active = 1 ORDER BY name`);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Novo orcamento" subtitle="Depois basta converter em reserva" />
      <QuoteForm
        action={createQuote}
        products={products}
        customers={customers}
        defaultCustomerId={cliente ? Number(cliente) : undefined}
        submitLabel="Criar orcamento"
      />
    </div>
  );
}
