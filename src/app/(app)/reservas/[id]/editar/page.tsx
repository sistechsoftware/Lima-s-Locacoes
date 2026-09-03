import { notFound } from "next/navigation";
import { all, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { reservationItems } from "@/lib/reservations";
import { PageHeader } from "@/components/ui";
import ReservationForm from "../../ReservationForm";
import { updateReservation } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditarReservaPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const reservation = one<any>(
    `SELECT r.*, (SELECT amount_cents FROM deposits d WHERE d.reservation_id = r.id ORDER BY d.id DESC LIMIT 1) AS deposit_cents
       FROM reservations r WHERE r.id = ?`,
    [Number(id)],
  );
  if (!reservation) notFound();

  const items = reservationItems(reservation.id).map((i) => ({
    product_id: i.product_id,
    qty: i.qty,
    unit_price_cents: i.unit_price_cents,
    discount_cents: i.discount_cents,
  }));
  const products = all<any>(
    `SELECT p.id, p.code, p.name, p.rent_price_cents, p.total_qty, c.name AS category
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1 ORDER BY c.name, p.name`,
  );
  const customers = all<any>(
    `SELECT id, name, phone, address, district, city FROM customers WHERE active = 1 ORDER BY name`,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={`Editar ${reservation.number}`} subtitle="Alteracoes revalidam o estoque e a agenda" />
      <ReservationForm
        action={updateReservation}
        products={products}
        customers={customers}
        reservation={reservation}
        items={items}
        isAdmin={user.role === "admin"}
        submitLabel="Salvar alteracoes"
      />
    </div>
  );
}
