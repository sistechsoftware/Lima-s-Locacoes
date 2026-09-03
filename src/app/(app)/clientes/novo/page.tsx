import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import CustomerForm from "../CustomerForm";
import { createCustomer } from "../actions";

export default async function NovoClientePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await requireUser();
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Novo cliente" subtitle="Cadastro basico para reservas e orcamentos" />
      <Card>
        <CustomerForm action={createCustomer} next={next} />
      </Card>
    </div>
  );
}
