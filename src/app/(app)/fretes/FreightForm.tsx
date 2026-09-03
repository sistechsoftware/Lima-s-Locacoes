"use client";
import { useActionState } from "react";
import { Field, Grid } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { FREIGHT_STATUS, PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from "@/lib/domain";

type Action = (prev: string | null, fd: FormData) => Promise<string | null>;

export default function FreightForm({
  action,
  customers,
  vehicles,
  freight,
  submitLabel = "Salvar frete",
}: {
  action: Action;
  customers: { id: number; name: string; phone: string }[];
  vehicles: { id: number; name: string }[];
  freight?: any;
  submitLabel?: string;
}) {
  const [error, formAction] = useActionState(action, null);
  const v = freight ?? {};
  return (
    <form action={formAction} className="space-y-4">
      {freight && <input type="hidden" name="id" value={freight.id} />}
      <Grid>
        <Field label="Cliente cadastrado">
          <select name="customer_id" defaultValue={v.customer_id ?? ""} className="campo">
            <option value="">Sem cliente cadastrado</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nome do contato">
          <input name="contact_name" defaultValue={v.contact_name ?? ""} className="campo" />
        </Field>
        <Field label="Telefone">
          <input name="phone" defaultValue={v.phone ?? ""} inputMode="tel" className="campo" />
        </Field>
        <Field label="Data *">
          <input name="date" type="date" defaultValue={v.date ?? ""} className="campo" required />
        </Field>
        <Field label="Horario">
          <input name="time" type="time" defaultValue={v.time ?? ""} className="campo" />
        </Field>
        <Field label="Veiculo">
          <select name="vehicle_id" defaultValue={v.vehicle_id ?? ""} className="campo">
            <option value="">Sem veiculo</option>
            {vehicles.map((veic) => (
              <option key={veic.id} value={veic.id}>
                {veic.name}
              </option>
            ))}
          </select>
        </Field>
      </Grid>

      <Field label="Origem">
        <input name="origin" defaultValue={v.origin ?? ""} className="campo" />
      </Field>
      <Field label="Destino">
        <input name="destination" defaultValue={v.destination ?? ""} className="campo" />
      </Field>
      <Field label="Descricao da carga">
        <textarea name="cargo" defaultValue={v.cargo ?? ""} rows={2} className="campo" />
      </Field>

      <Grid cols={3}>
        <Field label="Valor (R$)">
          <input
            name="amount"
            defaultValue={((v.amount_cents ?? 0) / 100).toFixed(2)}
            inputMode="decimal"
            className="campo"
          />
        </Field>
        <Field label="Forma de pagamento">
          <select name="method" defaultValue={v.method ?? "pix"} className="campo">
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select name="status" defaultValue={v.status ?? "orcamento"} className="campo">
            {FREIGHT_STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </Grid>

      <Field label="Observacoes">
        <textarea name="notes" defaultValue={v.notes ?? ""} rows={2} className="campo" />
      </Field>

      {error && (
        <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
      )}
      <SubmitButton className="w-full sm:w-auto">{submitLabel}</SubmitButton>
    </form>
  );
}
