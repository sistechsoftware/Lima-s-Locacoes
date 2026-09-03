"use client";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import ItemsEditor, { type ItemRow, type Product, type StockInfo } from "@/components/ItemsEditor";
import { Alerta, Field, Grid } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { money, parseMoney } from "@/lib/format";
import { QUOTE_STATUS } from "@/lib/domain";
import { checkStock } from "../reservas/actions";

type Customer = { id: number; name: string; address: string; district: string; city: string };
type Action = (prev: string | null, fd: FormData) => Promise<string | null>;

export default function QuoteForm({
  action,
  products,
  customers,
  quote,
  items: initialItems = [],
  defaultCustomerId,
  submitLabel = "Salvar orcamento",
}: {
  action: Action;
  products: Product[];
  customers: Customer[];
  quote?: any;
  items?: ItemRow[];
  defaultCustomerId?: number;
  submitLabel?: string;
}) {
  const [error, formAction] = useActionState(action, null);
  const [items, setItems] = useState<ItemRow[]>(initialItems);
  const [customerId, setCustomerId] = useState(String(quote?.customer_id ?? defaultCustomerId ?? ""));
  const [eventDate, setEventDate] = useState(quote?.event_date ?? "");
  const [address, setAddress] = useState(quote?.address ?? "");
  const [district, setDistrict] = useState(quote?.district ?? "");
  const [city, setCity] = useState(quote?.city ?? "");
  const [freight, setFreight] = useState(cents(quote?.freight_cents));
  const [assembly, setAssembly] = useState(cents(quote?.assembly_cents));
  const [disassembly, setDisassembly] = useState(cents(quote?.disassembly_cents));
  const [other, setOther] = useState(cents(quote?.other_cents));
  const [discount, setDiscount] = useState(cents(quote?.discount_cents));
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [, startCheck] = useTransition();

  useEffect(() => {
    const c = customers.find((x) => String(x.id) === customerId);
    if (!c) return;
    if (!address) setAddress(c.address ?? "");
    if (!district) setDistrict(c.district ?? "");
    if (!city) setCity(c.city ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  useEffect(() => {
    if (!items.length || !eventDate) {
      setConflicts([]);
      return;
    }
    const timer = setTimeout(() => {
      startCheck(async () => {
        setConflicts(await checkStock({ items, from: `${eventDate}T00:00`, to: `${eventDate}T23:59` }));
      });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, eventDate]);

  const stockInfo: StockInfo = useMemo(
    () =>
      Object.fromEntries(
        conflicts.map((c) => [c.product_id, { available: c.available, requested: c.requested, missing: c.missing }]),
      ),
    [conflicts],
  );

  const itemsTotal = items.reduce((s, i) => s + Math.max(0, i.qty * i.unit_price_cents - i.discount_cents), 0);
  const total = Math.max(
    0,
    itemsTotal + parseMoney(freight) + parseMoney(assembly) + parseMoney(disassembly) + parseMoney(other) - parseMoney(discount),
  );

  return (
    <form action={formAction} className="space-y-4">
      {quote && <input type="hidden" name="id" value={quote.id} />}
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <input type="hidden" name="freight" value={freight} />
      <input type="hidden" name="assembly" value={assembly} />
      <input type="hidden" name="disassembly" value={disassembly} />
      <input type="hidden" name="other" value={other} />
      <input type="hidden" name="discount" value={discount} />

      <section className="cartao p-4">
        <div className="space-y-3">
          <Field label="Cliente *">
            <div className="flex gap-2">
              <select
                name="customer_id"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="campo flex-1"
                required
              >
                <option value="">Selecione...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Link
                href="/clientes/novo"
                className="flex items-center rounded-xl border border-areia-300 bg-white px-3 text-sm font-semibold"
              >
                Novo
              </Link>
            </div>
          </Field>
          <Grid>
            <Field label="Data do evento">
              <input
                name="event_date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="campo"
              />
            </Field>
            <Field label="Horario">
              <input name="event_time" type="time" defaultValue={quote?.event_time ?? ""} className="campo" />
            </Field>
            <Field label="Entrega prevista">
              <input
                name="delivery_at"
                type="datetime-local"
                defaultValue={quote?.delivery_at ?? ""}
                className="campo"
              />
            </Field>
            <Field label="Retirada prevista">
              <input name="pickup_at" type="datetime-local" defaultValue={quote?.pickup_at ?? ""} className="campo" />
            </Field>
          </Grid>
          <Field label="Endereco">
            <input name="address" value={address} onChange={(e) => setAddress(e.target.value)} className="campo" />
          </Field>
          <Grid>
            <Field label="Bairro">
              <input name="district" value={district} onChange={(e) => setDistrict(e.target.value)} className="campo" />
            </Field>
            <Field label="Cidade">
              <input name="city" value={city} onChange={(e) => setCity(e.target.value)} className="campo" />
            </Field>
          </Grid>
        </div>
      </section>

      <section className="cartao p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500">Itens</h2>
        {conflicts.length > 0 && (
          <div className="mb-3">
            <Alerta tone="ambar" title="Atencao: estoque apertado nesta data">
              <ul className="mt-1 space-y-0.5 text-xs">
                {conflicts.map((c) => (
                  <li key={c.product_id}>
                    <b>{c.product}</b>: pedido {c.requested}, disponivel {c.available}.
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs">
                O orcamento pode ser salvo assim mesmo. A checagem sera refeita na conversao em reserva.
              </p>
            </Alerta>
          </div>
        )}
        <ItemsEditor products={products} items={items} onChange={setItems} stock={stockInfo} />
      </section>

      <section className="cartao p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500">Servicos e valores</h2>
        <Grid>
          <Field label="Frete (R$)">
            <input value={freight} onChange={(e) => setFreight(e.target.value)} inputMode="decimal" className="campo" />
          </Field>
          <Field label="Montagem (R$)">
            <input value={assembly} onChange={(e) => setAssembly(e.target.value)} inputMode="decimal" className="campo" />
          </Field>
          <Field label="Desmontagem (R$)">
            <input
              value={disassembly}
              onChange={(e) => setDisassembly(e.target.value)}
              inputMode="decimal"
              className="campo"
            />
          </Field>
          <Field label="Outros (R$)">
            <input value={other} onChange={(e) => setOther(e.target.value)} inputMode="decimal" className="campo" />
          </Field>
          <Field label="Desconto (R$)">
            <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className="campo" />
          </Field>
          <Field label="Valido ate">
            <input name="valid_until" type="date" defaultValue={quote?.valid_until ?? ""} className="campo" />
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={quote?.status ?? "rascunho"} className="campo">
              {QUOTE_STATUS.filter((s) => s.value !== "convertido").map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Observacoes">
            <input name="notes" defaultValue={quote?.notes ?? ""} className="campo" />
          </Field>
        </Grid>

        <div className="mt-3 flex items-center justify-between rounded-xl bg-areia-100 px-3 py-3 text-base font-bold">
          <span>Total do orcamento</span>
          <span>{money(total)}</span>
        </div>
      </section>

      {error && (
        <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p>
      )}
      <div className="sticky bottom-20 z-10 md:bottom-4">
        <SubmitButton className="w-full py-3 text-base shadow-lg">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

const cents = (v: number | undefined) => ((v ?? 0) / 100).toFixed(2);
