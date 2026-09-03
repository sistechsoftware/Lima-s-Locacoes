"use client";
import { useMemo, useState } from "react";
import { money, parseMoney } from "@/lib/format";
import { Icon } from "./Icons";

export type Product = {
  id: number;
  code: string;
  name: string;
  category: string | null;
  rent_price_cents: number;
  total_qty: number;
};

export type ItemRow = {
  product_id: number;
  qty: number;
  unit_price_cents: number;
  discount_cents: number;
};

export type StockInfo = Record<number, { available: number; requested: number; missing: number }>;

/** Editor de itens compartilhado por reservas e orcamentos. */
export default function ItemsEditor({
  products,
  items,
  onChange,
  stock,
}: {
  products: Product[];
  items: ItemRow[];
  onChange: (items: ItemRow[]) => void;
  stock?: StockInfo;
}) {
  const [picker, setPicker] = useState("");
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const add = (productId: number) => {
    if (!productId) return;
    const p = byId.get(productId);
    if (!p) return;
    const existing = items.find((i) => i.product_id === productId);
    if (existing) {
      onChange(items.map((i) => (i.product_id === productId ? { ...i, qty: i.qty + 1 } : i)));
    } else {
      onChange([...items, { product_id: productId, qty: 1, unit_price_cents: p.rent_price_cents, discount_cents: 0 }]);
    }
    setPicker("");
  };

  const patch = (index: number, changes: Partial<ItemRow>) =>
    onChange(items.map((i, idx) => (idx === index ? { ...i, ...changes } : i)));

  const remove = (index: number) => onChange(items.filter((_, idx) => idx !== index));

  const subtotal = items.reduce((s, i) => s + Math.max(0, i.qty * i.unit_price_cents - i.discount_cents), 0);

  const grouped = useMemo(() => {
    const g = new Map<string, Product[]>();
    for (const p of products) {
      const k = p.category ?? "Outros";
      g.set(k, [...(g.get(k) ?? []), p]);
    }
    return [...g.entries()];
  }, [products]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select value={picker} onChange={(e) => add(Number(e.target.value))} className="campo flex-1">
          <option value="">+ Adicionar produto...</option>
          {grouped.map(([cat, list]) => (
            <optgroup key={cat} label={cat}>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} - {money(p.rent_price_cents)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-areia-300 bg-areia-50 px-3 py-6 text-center text-sm text-stone-500">
          Nenhum item adicionado ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => {
            const p = byId.get(item.product_id);
            const info = stock?.[item.product_id];
            const line = Math.max(0, item.qty * item.unit_price_cents - item.discount_cents);
            return (
              <div
                key={item.product_id}
                className={`rounded-xl border p-3 ${info ? "border-red-300 bg-red-50" : "border-areia-300 bg-white"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-carvao-900">{p?.name ?? "Produto"}</p>
                    <p className="text-xs text-stone-500">
                      {p?.code} - estoque total {p?.total_qty}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="rounded-lg p-1.5 text-red-600 hover:bg-red-100"
                    aria-label="Remover item"
                  >
                    <Icon name="fechar" className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[0.68rem] font-semibold uppercase text-stone-500">Qtd</span>
                    <div className="flex items-stretch overflow-hidden rounded-lg border border-areia-300 bg-white">
                      <button
                        type="button"
                        onClick={() => patch(index, { qty: Math.max(1, item.qty - 1) })}
                        className="px-2.5 text-lg font-bold text-stone-500"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={item.qty}
                        onChange={(e) => patch(index, { qty: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-full min-w-0 border-x border-areia-200 px-1 py-2 text-center text-sm outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => patch(index, { qty: item.qty + 1 })}
                        className="px-2.5 text-lg font-bold text-stone-500"
                      >
                        +
                      </button>
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-0.5 block text-[0.68rem] font-semibold uppercase text-stone-500">Valor un.</span>
                    <input
                      defaultValue={(item.unit_price_cents / 100).toFixed(2)}
                      onBlur={(e) => patch(index, { unit_price_cents: parseMoney(e.target.value) })}
                      inputMode="decimal"
                      className="w-full rounded-lg border border-areia-300 px-2 py-2 text-sm outline-none"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-0.5 block text-[0.68rem] font-semibold uppercase text-stone-500">Desconto</span>
                    <input
                      defaultValue={(item.discount_cents / 100).toFixed(2)}
                      onBlur={(e) => patch(index, { discount_cents: parseMoney(e.target.value) })}
                      inputMode="decimal"
                      className="w-full rounded-lg border border-areia-300 px-2 py-2 text-sm outline-none"
                    />
                  </label>
                </div>

                <div className="mt-2 flex items-center justify-between">
                  {info ? (
                    <span className="text-xs font-bold text-red-700">
                      Faltam {info.missing} - disponivel {info.available}
                    </span>
                  ) : (
                    <span className="text-xs text-stone-400">Subtotal</span>
                  )}
                  <span className="text-sm font-bold text-carvao-900">{money(line)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl bg-areia-100 px-3 py-2.5">
        <span className="text-sm font-semibold text-stone-600">Subtotal dos produtos</span>
        <span className="text-base font-bold text-carvao-900">{money(subtotal)}</span>
      </div>
    </div>
  );
}
