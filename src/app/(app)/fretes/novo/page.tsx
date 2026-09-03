import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import FreightForm from "../FreightForm";
import { createFreight } from "../actions";

export const dynamic = "force-dynamic";

export default async function NovoFretePage() {
  await requireUser();
  const customers = await all<any>(`SELECT id, name, phone FROM customers WHERE active = 1 ORDER BY name`);
  const vehicles = await all<any>(`SELECT id, name FROM vehicles WHERE active = 1 ORDER BY name`);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Novo frete" subtitle="Servico de transporte avulso" />
      <Card>
        <FreightForm action={createFreight} customers={customers} vehicles={vehicles} />
      </Card>
    </div>
  );
}
