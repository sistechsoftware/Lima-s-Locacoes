import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import ReservationForm from "../ReservationForm";
import { createReservation } from "../actions";
import { sellableProducts } from "@/lib/stock";

export const dynamic = "force-dynamic";

export default async function NovaReservaPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  const user = await requireUser();
  const { cliente } = await searchParams;

  const products = await sellableProducts();
  const customers = await all<any>(
    `SELECT id, name, phone, address, district, city FROM customers WHERE active = 1 ORDER BY name`,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Nova reserva" subtitle="O sistema verifica o estoque automaticamente" />
      <ReservationForm
        action={createReservation}
        products={products}
        customers={customers}
        isAdmin={user.role === "admin"}
        defaultCustomerId={cliente ? Number(cliente) : undefined}
        submitLabel="Criar reserva"
      />
    </div>
  );
}
