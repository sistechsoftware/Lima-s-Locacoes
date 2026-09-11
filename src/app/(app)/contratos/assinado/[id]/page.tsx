import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { documentoAssinado } from "@/lib/assinatura-db";
import { getSettings } from "@/lib/settings";
import { dateTimeBR, docBR } from "@/lib/format";
import { Alerta, Card, PageHeader } from "@/components/ui";
import PrintButton from "../../[id]/PrintButton";
import ContratoTexto from "@/components/ContratoTexto";

export const dynamic = "force-dynamic";

/**
 * Versao assinada do contrato, congelada.
 *
 * O texto aqui e o snapshot gravado no momento da assinatura, nunca o corpo
 * atual do contrato: editar o contrato depois nao pode mudar o que a pessoa
 * leu e aceitou. Esta pagina imprime em PDF pelo navegador, no mesmo caminho
 * que o resto do sistema ja usa para gerar documento.
 */
export default async function DocumentoAssinadoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const doc = await documentoAssinado(Number(id));
  if (!doc) notFound();
  const s = await getSettings();

  return (
    <div className="space-y-4">
      <div className="nao-imprimir space-y-4">
        <PageHeader
          title={`${doc.contract_number} Assinado`}
          subtitle={`${doc.customer_name} · ${dateTimeBR(doc.signed_at)}`}
          action={
            <>
              <PrintButton />
              <Link
                href={`/contratos/${doc.contract_id}`}
                className="inline-flex items-center rounded-xl border border-nuvem-300 bg-white px-4 py-2.5 text-sm font-semibold"
              >
                Ver contrato
              </Link>
            </>
          }
        />
        <Alerta tone="verde" title="Documento congelado">
          Este é o texto exato que o cliente leu e aceitou. Alterações feitas no contrato depois da assinatura não
          aparecem aqui: para mudar algo, gere um novo contrato.
        </Alerta>
      </div>

      <article className="cartao p-6 print:border-0 print:p-0 print:shadow-none">
        <header className="mb-4 border-b border-nuvem-200 pb-3 text-center">
          <p className="text-base font-bold text-tinta-900">{s.company_name}</p>
          {s.company_doc && <p className="text-xs text-stone-500">{docBR(s.company_doc)}</p>}
          <p className="mt-1 text-sm font-semibold">{doc.contract_number}</p>
        </header>

        <ContratoTexto texto={doc.body_snapshot} className="break-words text-sm leading-relaxed text-tinta-800" />

        <section className="mt-8 border-t border-nuvem-200 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase text-stone-500">Assinatura do Contratante</p>
          {doc.signature_file_id && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`/api/arquivo/${doc.signature_file_id}`}
              alt={`Assinatura de ${doc.signer_name}`}
              className="h-28 max-w-full object-contain"
            />
          )}
          <p className="mt-1 border-t border-tinta-900 pt-1 text-sm font-semibold text-tinta-900">{doc.signer_name}</p>
          {doc.customer_doc && <p className="text-xs text-stone-500">{docBR(doc.customer_doc)}</p>}
        </section>

        <section className="mt-6 rounded-xl bg-nuvem-100 p-3 text-[0.7rem] leading-relaxed text-stone-600 print:bg-transparent print:p-0">
          <p className="font-semibold uppercase text-stone-500">Registro da Assinatura</p>
          <p>Aceite dos termos e assinatura em {dateTimeBR(doc.signed_at)} (horário de Brasília).</p>
          <p>
            Contrato {doc.contract_number}
            {doc.reservation_number ? `, reserva ${doc.reservation_number}` : ""}, versão {doc.version}.
          </p>
          <p>Identificador da assinatura: {doc.id}.</p>
          {doc.document_hash && <p className="break-all">Verificação SHA-256: {doc.document_hash}</p>}
          {doc.ip_address && <p>Origem registrada: {doc.ip_address}</p>}
        </section>
      </article>
    </div>
  );
}
