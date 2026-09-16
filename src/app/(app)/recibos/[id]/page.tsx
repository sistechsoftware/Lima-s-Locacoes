import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { obterRecibo } from "@/lib/recibos";
import { dateBR, dateUtcBR, docBR, money, phoneBR } from "@/lib/format";
import { formaLabel, sanitizarNomeArquivo, valorPorExtenso } from "@/lib/recibo-visual";
import PrintButton from "@/app/(app)/contratos/[id]/PrintButton";

export const dynamic = "force-dynamic";

/**
 * Recibo de lançamento (pagamento, adiantamento ou caução).
 *
 * Página própria, fora do fluxo de lançamento: o lançamento já aconteceu, e
 * esta tela apenas lê os dados reais dele na hora da exibição e o snapshot
 * registrado na emissão. Nada aqui escreve no banco. A impressão e o PDF
 * usam o mesmo mecanismo dos contratos e orçamentos (dialogo de impressão do
 * navegador), reaproveitando o CSS .imprimivel/.nao-imprimir já existente.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const r = await obterRecibo(Number(id));
  if (!r) return { title: "Recibo" };
  const cliente = sanitizarNomeArquivo(r.cliente?.name);
  return { title: `Recibo-${sanitizarNomeArquivo(r.recibo.number)}${cliente ? `-${cliente}` : ""}` };
}

export default async function ReciboPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const data = await obterRecibo(Number(id));
  if (!data) notFound();

  const { recibo, company, cliente, reserva, frete, lancamentoExiste } = data;
  const s = company as Record<string, string>;
  const ehCaucao = recibo.source_type === "deposit";
  const ehFrete = !!frete;
  const tipoRotulo = ehCaucao ? "Caução" : "Pagamento";
  const referencia = reserva?.reservation_number ?? frete?.freight_number ?? null;
  const nomeCliente = cliente?.name ?? "—";
  const enderecoEvento = reserva
    ? [reserva.address, reserva.district, reserva.city].filter(Boolean).join(", ")
    : frete
      ? [frete.origin, frete.destination].filter(Boolean).join(" → ")
      : "";
  const contatoEmpresa = [phoneBR(s.company_phone), s.company_email].filter(Boolean).join(" - ");
  const enderecoEmpresa = [s.company_address, s.company_city].filter(Boolean).join(" - ");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="nao-imprimir flex flex-wrap items-center justify-between gap-2">
        <Link href="/reservas" className="text-sm font-semibold text-marca-600">
          Voltar
        </Link>
        <PrintButton />
      </div>

      {data.valorDivergente && lancamentoExiste && (
        <div className="nao-imprimir rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          O valor do lançamento foi alterado após a emissão deste recibo (emitido por{" "}
          {money(recibo.amount_cents)}; hoje o lançamento registra {money(data.valorAtual)}). Os dados abaixo são os
          registrados na emissão; verifique se um novo recibo é necessário.
        </div>
      )}

      <article className="cartao imprimivel bg-white p-6 text-tinta-900 sm:p-10">
        {/* cabecalho: empresa, como no orcamento impresso */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-marca-600 pb-4">
          <div className="flex items-center gap-3">
            {s.company_logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.company_logo} alt="" className="h-16 w-16 rounded-xl object-contain" />
            ) : null}
            <div>
              <p className="text-lg font-black leading-tight text-marca-600">{s.company_name}</p>
              {s.company_tagline && <p className="text-xs text-stone-500">{s.company_tagline}</p>}
              {s.company_doc && <p className="text-xs text-stone-600">CNPJ/CPF: {docBR(s.company_doc)}</p>}
              {contatoEmpresa && <p className="text-xs text-stone-600">{contatoEmpresa}</p>}
              {enderecoEmpresa && <p className="text-xs text-stone-600">{enderecoEmpresa}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Recibo de {tipoRotulo}</p>
            <p className="text-xl font-black text-marca-600">{recibo.number}</p>
            <p className="text-xs text-stone-600">Emitido em {dateUtcBR(recibo.created_at)}</p>
            {recibo.issued_by_name && <p className="text-xs text-stone-500">Por {recibo.issued_by_name}</p>}
          </div>
        </header>

        {lancamentoExiste ? (
          <>
            {/* declaracao principal */}
            <section className="mt-6">
              <p className="text-base leading-relaxed text-stone-800">
                Recebemos de <b className="text-tinta-900">{nomeCliente}</b>
                {cliente?.doc ? (
                  <>
                    {" "}
                    (CPF/CNPJ <span className="text-stone-700">{docBR(cliente.doc)}</span>)
                  </>
                ) : null}
                {cliente?.phone ? (
                  <>
                    {" "}
                    · fone <span className="text-stone-700">{phoneBR(cliente.phone)}</span>
                  </>
                ) : null}{" "}
                a importância de{" "}
                <b className="text-lg text-marca-700">{money(data.valorAtual)}</b>{" "}
                ({valorPorExtenso(data.valorAtual)}){ehCaucao ? ", a título de caução" : ""}, referente
                {ehCaucao ? " à" : ""}{" "}
                <b className="text-tinta-900">
                  {ehCaucao
                    ? `caução da locação ${referencia ?? "—"}`
                    : `locação ${referencia ?? "—"}`}
                </b>
                .
              </p>
              <p className="mt-3 rounded-lg bg-nuvem-100 px-3 py-2 text-xs text-stone-600">
                Esta declaração foi registrada na emissão do recibo e permanece como comprovante:
              </p>
              <p className="whitespace-pre-wrap rounded-lg bg-nuvem-100 px-3 py-2.5 text-sm text-stone-700">
                {recibo.body}
              </p>
            </section>

            {/* dados do lancamento */}
            <section className="mt-5">
              <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-marca-600">Dados do recebimento</h2>
              <div className="rounded-lg border border-nuvem-200">
                <Linha rotulo="Tipo de lançamento" valor={ehCaucao ? "Caução" : "Pagamento"} destaque />
                <Linha rotulo="Valor recebido" valor={money(data.valorAtual)} destaque />
                <Linha rotulo="Data do recebimento" valor={dateBR(data.dataAtual)} />
                <Linha rotulo="Forma de pagamento" valor={formaLabel(data.methodAtual)} />
                {data.descricao && <Linha rotulo="Descrição / observação" valor={data.descricao} />}
                {recibo.method && recibo.method !== data.methodAtual && (
                  <Linha rotulo="Forma registrada na emissão" valor={formaLabel(recibo.method)} />
                )}
              </div>
            </section>

            {/* identificacao da reserva ou do frete */}
            {referencia && (
              <section className="mt-4">
                <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-marca-600">
                  {ehFrete ? "Frete" : "Reserva"}
                </h2>
                <div className="rounded-lg bg-nuvem-100 px-3 py-2.5 text-sm text-stone-700">
                  <p>
                    Número: <b className="text-tinta-900">{referencia}</b>
                  </p>
                  {reserva?.event_date && (
                    <p>
                      Data do evento: {dateBR(reserva.event_date)}
                      {reserva.event_time ? ` às ${reserva.event_time}` : ""}
                    </p>
                  )}
                  {frete?.freight_date && <p>Data do frete: {dateBR(frete.freight_date)}</p>}
                  {enderecoEvento && <p>Local / trajeto: {enderecoEvento}</p>}
                </div>
              </section>
            )}

            {!ehCaucao && ehFrete && (
              <p className="mt-3 text-xs text-stone-500">
                Recibo emitido sobre um pagamento de frete; o tipo exato do lançamento é o registrado no sistema.
              </p>
            )}
          </>
        ) : (
          <section className="mt-6">
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              O lançamento original deste recibo não existe mais no sistema (por exemplo, a reserva foi excluída). O
              recibo permanece registrado como comprovante da emissão, com os dados abaixo capturados na data em que
              foi gerado.
            </p>
            <div className="mt-4 rounded-lg border border-nuvem-200">
              <Linha rotulo="Tipo" valor={tipoRotulo} />
              <Linha rotulo="Valor emitido" valor={money(recibo.amount_cents)} destaque />
              <Linha rotulo="Data do recebimento" valor={dateBR(recibo.paid_at)} />
              <Linha rotulo="Forma" valor={formaLabel(recibo.method)} />
            </div>
          </section>
        )}

        <footer className="mt-8 border-t border-nuvem-300 pt-3 text-center text-xs text-stone-500">
          <p className="font-semibold text-tinta-900">{s.company_name}</p>
          {contatoEmpresa && <p>{contatoEmpresa}</p>}
        </footer>
      </article>
    </div>
  );
}

function Linha({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-nuvem-200 px-3 py-2 text-sm last:border-0">
      <span className="text-stone-500">{rotulo}</span>
      <span className={`text-right font-medium ${destaque ? "text-marca-700" : "text-tinta-900"}`}>{valor}</span>
    </div>
  );
}
