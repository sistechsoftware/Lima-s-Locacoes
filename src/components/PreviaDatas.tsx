"use client";
import { useMemo } from "react";
import { dateBR, money, today } from "@/lib/format";
import { promocaoVencedora, rotuloFaixa, datasDePrevia, type Faixa, type Promocao } from "@/lib/promocoes";

/**
 * Conferencia visual do cadastro: para os proximos meses, qual promocao desta
 * lista vale numa data de amostragem e quanto custaria uma quantidade de
 * exemplo. Usa exatamente a mesma escolha do calculo do preco (promocaoVencedora),
 * entao o que a tela promete e o que orcamento e reserva aplicam.
 *
 * Para a promocao em edicao vale mesmo desativada (a lista chega com ela em
 * primeiro lugar): o administrador precisa conferir o periodo antes de ativar.
 */
export default function PreviaDatas({
  promocoes,
  precoNormalCents,
  quantidadeExemplo,
  dataBase,
  className,
}: {
  /** Lista a conferir; a promocao em edicao vem em primeiro lugar. */
  promocoes: Promocao[];
  /** Preco normal do produto, para mostrar o preco cheio fora de vigencia. */
  precoNormalCents: number;
  /** Quantidade usada nos exemplos (ex.: "15 un. em 15/10 = R$ 150"). */
  quantidadeExemplo: number;
  /** Data base dos meses mostrados; por padrao, hoje. */
  dataBase?: string;
  className?: string;
}) {
  const base = dataBase || today();
  const datas = useMemo(() => datasDePrevia(base), [base]);
  if (datas.length === 0 || quantidadeExemplo < 1) return null;

  return (
    <div className={className}>
      <p className="mb-1 text-xs font-semibold uppercase text-stone-500">
        Conferência por data
      </p>
      <p className="mb-2 text-xs text-stone-500">
        Qual promoção vale no dia 15 de cada mês, para {quantidadeExemplo} unidade
        {quantidadeExemplo === 1 ? "" : "s"} — a mesma escolha que o sistema faz no orçamento e na reserva.
      </p>
      <ul className="divide-y divide-nuvem-200 overflow-hidden rounded-xl border border-nuvem-300 bg-white">
        {datas.map((data) => {
          const vencedora = promocaoVencedora(promocoes, quantidadeExemplo, data);
          const nome = vencedora?.promocao.name?.trim();
          return (
            <li key={data} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="shrink-0 text-stone-600">{dateBR(data)}</span>
              {vencedora ? (
                <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 text-right">
                  {nome && <span className="truncate text-xs text-stone-500">{nome}</span>}
                  <span className="font-semibold text-emerald-700">{rotuloFaixa(vencedora.faixa as Faixa)}</span>
                  <span className="font-bold text-tinta-900">
                    {money(vencedora.faixa.unit_price_cents * quantidadeExemplo)}
                  </span>
                </span>
              ) : (
                <span className="text-stone-500">
                  preço normal <s className="text-stone-400">{money(precoNormalCents * quantidadeExemplo)}</s>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
