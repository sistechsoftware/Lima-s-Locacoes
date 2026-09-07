"use client";
import Link from "next/link";
import RouteEstimate from "@/components/RouteEstimate";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import ItemsEditor, { type ItemRow, type Product, type StockInfo } from "@/components/ItemsEditor";
import ConflictList from "@/components/ConflictList";
import { Field, Grid, Alerta } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { money, parseMoney } from "@/lib/format";
import { RESERVATION_STATUS } from "@/lib/domain";
import { checkStock } from "./actions";

type Customer = { id: number; name: string; phone: string; address: string; district: string; city: string };
type Action = (prev: string | null, fd: FormData) => Promise<string | null>;

export default function ReservationForm({
  action,
  products,
  customers,
  reservation,
  items: initialItems = [],
  isAdmin,
  defaultCustomerId,
  freteInicial,
  submitLabel = "Salvar reserva",
}: {
  action: Action;
  products: Product[];
  customers: Customer[];
  reservation?: any;
  items?: ItemRow[];
  isAdmin: boolean;
  defaultCustomerId?: number;
  /** Preenche o frete quando vem da calculadora. */
  freteInicial?: string;
  submitLabel?: string;
}) {
  const [error, formAction] = useActionState(action, null);
  const [items, setItems] = useState<ItemRow[]>(initialItems);
  const [customerId, setCustomerId] = useState(String(reservation?.customer_id ?? defaultCustomerId ?? ""));
  const [eventDate, setEventDate] = useState(reservation?.event_date ?? "");
  const [deliveryAt, setDeliveryAt] = useState(reservation?.delivery_at ?? "");
  const [pickupAt, setPickupAt] = useState(reservation?.pickup_at ?? "");
  const [address, setAddress] = useState(reservation?.address ?? "");
  const [district, setDistrict] = useState(reservation?.district ?? "");
  const [city, setCity] = useState(reservation?.city ?? "");

  const [freight, setFreight] = useState(freteInicial ?? cents(reservation?.freight_cents));
  const [assembly, setAssembly] = useState(cents(reservation?.assembly_cents));
  const [disassembly, setDisassembly] = useState(cents(reservation?.disassembly_cents));
  const [other, setOther] = useState(cents(reservation?.other_cents));
  const [discount, setDiscount] = useState(cents(reservation?.discount_cents));

  const [conflicts, setConflicts] = useState<any[]>([]);
  const [checking, startCheck] = useTransition();
  const [override, setOverride] = useState(false);

  // preenche o endereco a partir do cliente quando ainda estiver vazio
  useEffect(() => {
    const c = customers.find((x) => String(x.id) === customerId);
    if (!c) return;
    if (!address) setAddress(c.address ?? "");
    if (!district) setDistrict(c.district ?? "");
    if (!city) setCity(c.city ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  // sugere janela de entrega/retirada a partir da data do evento
  useEffect(() => {
    if (!eventDate) return;
    if (!deliveryAt) setDeliveryAt(`${eventDate}T08:00`);
    if (!pickupAt) setPickupAt(`${nextDay(eventDate)}T10:00`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventDate]);

  // verifica estoque sempre que itens ou janela mudarem
  useEffect(() => {
    const from = deliveryAt || (eventDate ? `${eventDate}T00:00` : "");
    const to = pickupAt || (eventDate ? `${eventDate}T23:59` : "");
    if (!items.length || !from || !to) {
      setConflicts([]);
      return;
    }
    const timer = setTimeout(() => {
      startCheck(async () => {
        const result = await checkStock({ items, from, to, excludeId: reservation?.id ?? null });
        setConflicts(result);
      });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, deliveryAt, pickupAt, eventDate]);

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
    itemsTotal +
      parseMoney(freight) +
      parseMoney(assembly) +
      parseMoney(disassembly) +
      parseMoney(other) -
      parseMoney(discount),
  );

  return (
    <form action={formAction} className="space-y-4">
      {reservation && <input type="hidden" name="id" value={reservation.id} />}
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      <input type="hidden" name="override" value={override ? "1" : "0"} />
      <input type="hidden" name="freight" value={freight} />
      <input type="hidden" name="assembly" value={assembly} />
      <input type="hidden" name="disassembly" value={disassembly} />
      <input type="hidden" name="other" value={other} />
      <input type="hidden" name="discount" value={discount} />

      <section className="cartao p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500">Cliente e evento</h2>
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
                href="/clientes/novo?next=reserva"
                className="flex items-center rounded-xl border border-nuvem-300 bg-white px-3 text-sm font-semibold"
              >
                Novo
              </Link>
            </div>
          </Field>

          <Grid>
            <Field label="Data do evento *">
              <input
                name="event_date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="campo"
                required
              />
            </Field>
            <Field label="Horario do evento">
              <input name="event_time" type="time" defaultValue={reservation?.event_time ?? ""} className="campo" />
            </Field>
          </Grid>

          <Field label="Endereco do evento">
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

      <RouteEstimate tipo="locacao" destination={[address, district, city].filter(Boolean).join(", ")} onApply={setFreight} />
      <section className="cartao p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500">Entrega e retirada</h2>
        <Grid>
          <Field label="Entrega em" hint="Define quando o equipamento sai do estoque.">
            <input
              name="delivery_at"
              type="datetime-local"
              value={deliveryAt}
              onChange={(e) => setDeliveryAt(e.target.value)}
              className="campo"
            />
          </Field>
          <Field label="Retirada em" hint="Define quando o equipamento volta ao estoque.">
            <input
              name="pickup_at"
              type="datetime-local"
              value={pickupAt}
              onChange={(e) => setPickupAt(e.target.value)}
              className="campo"
            />
          </Field>
        </Grid>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[
            ["needs_delivery", "Entrega", reservation ? !!reservation.needs_delivery : true],
            ["needs_pickup", "Retirada", reservation ? !!reservation.needs_pickup : true],
            ["needs_assembly", "Montagem", reservation ? !!reservation.needs_assembly : false],
            ["needs_disassembly", "Desmontagem", reservation ? !!reservation.needs_disassembly : false],
          ].map(([name, label, checked]) => (
            <label
              key={name as string}
              className="flex items-center gap-2 rounded-xl border border-nuvem-300 bg-white px-3 py-2.5 text-sm font-medium"
            >
              <input type="checkbox" name={name as string} defaultChecked={checked as boolean} className="h-4 w-4" />
              {label as string}
            </label>
          ))}
        </div>
      </section>

      <section className="cartao p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-stone-500">Itens</h2>
          {checking && <span className="text-xs text-stone-400">verificando estoque...</span>}
        </div>

        {conflicts.length > 0 && (
          <div className="mb-3">
            <Alerta tone="vermelho" title="Estoque insuficiente nesta data">
              <ConflictList conflicts={conflicts} />
              {isAdmin ? (
                <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={(e) => setOverride(e.target.checked)}
                    className="h-4 w-4"
                  />
                  Autorizar mesmo assim (administrador)
                </label>
              ) : (
                <p className="mt-2 text-xs font-semibold">
                  Ajuste as quantidades ou peca autorizacao ao administrador.
                </p>
              )}
            </Alerta>
          </div>
        )}

        <ItemsEditor products={products} items={items} onChange={setItems} stock={stockInfo} dataReferencia={eventDate} />
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
          <Field label="Outros servicos (R$)">
            <input value={other} onChange={(e) => setOther(e.target.value)} inputMode="decimal" className="campo" />
          </Field>
          <Field label="Desconto (R$)">
            <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className="campo" />
          </Field>
          <Field label="Caucao (R$)" hint="Valor separado da locacao.">
            <input
              name="deposit"
              defaultValue={cents(reservation?.deposit_cents)}
              inputMode="decimal"
              className="campo"
            />
          </Field>
        </Grid>

        <div className="mt-3 space-y-1 rounded-xl bg-nuvem-100 p-3 text-sm">
          <Linha label="Produtos" value={money(itemsTotal)} />
          <Linha label="Frete" value={money(parseMoney(freight))} />
          <Linha label="Montagem" value={money(parseMoney(assembly))} />
          <Linha label="Desmontagem" value={money(parseMoney(disassembly))} />
          <Linha label="Outros" value={money(parseMoney(other))} />
          <Linha label="Desconto" value={"- " + money(parseMoney(discount))} />
          <div className="flex items-center justify-between border-t border-nuvem-300 pt-2 text-base font-bold">
            <span>Total da reserva</span>
            <span>{money(total)}</span>
          </div>
        </div>
      </section>

      <section className="cartao p-4">
        <Grid>
          <Field label="Status">
            <select name="status" defaultValue={reservation?.status ?? "pre_reserva"} className="campo">
              {RESERVATION_STATUS.filter((s) => s.value !== "orcamento").map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Observacoes">
            <input name="notes" defaultValue={reservation?.notes ?? ""} className="campo" />
          </Field>
        </Grid>
      </section>

      {error && (
        <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      <div className="sticky bottom-20 z-10 md:bottom-4">
        <SubmitButton className="w-full py-3 text-base shadow-lg">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

function Linha({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-stone-600">
      <span>{label}</span>
      <span className="font-medium text-tinta-900">{value}</span>
    </div>
  );
}

const cents = (v: number | undefined) => ((v ?? 0) / 100).toFixed(2);

function nextDay(dateISO: string) {
  const d = new Date(dateISO + "T12:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
