"use client";
import { useActionState } from "react";
import { Field, Grid } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

type Action = (prev: string | null, fd: FormData) => Promise<string | null>;

export default function ProductForm({
  action,
  product,
  categories,
  submitLabel = "Salvar produto",
}: {
  action: Action;
  product?: any;
  categories: { id: number; name: string }[];
  submitLabel?: string;
}) {
  const [error, formAction] = useActionState(action, null);
  const v = product ?? {};
  return (
    <form action={formAction} className="space-y-4">
      {product && <input type="hidden" name="id" value={product.id} />}
      <Grid>
        <Field label="Codigo *" hint="Prefixo das unidades (MESA-001, CAD-001).">
          <input name="code" defaultValue={v.code ?? ""} className="campo uppercase" required />
        </Field>
        <Field label="Nome *">
          <input name="name" defaultValue={v.name ?? ""} className="campo" required />
        </Field>
        <Field label="Categoria">
          <select name="category_id" defaultValue={v.category_id ?? ""} className="campo">
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantidade total *">
          <input name="total_qty" type="number" min={0} defaultValue={v.total_qty ?? 0} className="campo" required />
        </Field>
        <Field label="Estoque minimo" hint="Gera alerta quando o disponivel fica abaixo.">
          <input name="min_qty" type="number" min={0} defaultValue={v.min_qty ?? 0} className="campo" />
        </Field>
        <Field label="Valor de locacao (R$)">
          <input
            name="rent_price"
            defaultValue={((v.rent_price_cents ?? 0) / 100).toFixed(2)}
            inputMode="decimal"
            className="campo"
          />
        </Field>
        <Field label="Valor de reposicao (R$)">
          <input
            name="replace_price"
            defaultValue={((v.replace_cents ?? 0) / 100).toFixed(2)}
            inputMode="decimal"
            className="campo"
          />
        </Field>
        <Field label="Foto (URL)">
          <input name="photo" defaultValue={v.photo ?? ""} className="campo" placeholder="https://..." />
        </Field>
      </Grid>
      <Field label="Descricao">
        <textarea name="description" defaultValue={v.description ?? ""} rows={3} className="campo" />
      </Field>
      {error && (
        <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
      )}
      <SubmitButton className="w-full sm:w-auto">{submitLabel}</SubmitButton>
    </form>
  );
}
