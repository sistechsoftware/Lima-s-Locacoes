import Link from "next/link";
import { notFound } from "next/navigation";
import { one } from "@/lib/db";
import { requireCliente } from "@/lib/portal-auth";
import { documentoAssinado } from "@/lib/assinatura-db";
import { dateTimeBR } from "@/lib/format";
import ContratoTexto from "@/components/ContratoTexto";
import PrintButton from "@/app/(app)/contratos/[id]/PrintButton";

export const dynamic = "force-dynamic";

/**
 * Versao assinada (congelada) do contrato digital, vista pelo cliente.
 *
 * O id da assinatura vem da URL; a AUTORIZACAO vem da sessao — a consulta
 * abaixo so devolve o documento quando a assinatura pertence ao cliente
 * logado. Id de outro cliente vira 404.
 */
export default async function PortalContratoAssinadoPage({ params }: { params: Promise<{ id: string }> }) {
  const cliente = await requireCliente();
  const { id } = await params;
  const assinaturaId = Number(id);
  if (!Number.isInteger(assinaturaId) || assinaturaId <= 0) notFound();

  const dono = await one<{ customer_id: number }>(
    `SELECT customer_id FROM contract_signatures WHERE id = ? AND status = 'assinado'`,
    [assinaturaId],
  );
  if (!dono || dono.customer_id !== cliente.id) notFound();

  const doc = await documentoAssinado(assinaturaId);
  if (!doc) notFound();

  return (
    <div className="space-y-4">
      <Link href="/portal/contratos" className="inline-flex items-center gap-1 text-sm font-semibold text-marca-600">
        ← Voltar para meus contratos
      </Link>

      <div className="space-y-3">
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ✅ Contrato assinado digitalmente por <b>{doc.signer_name}</b> em {dateTimeBR(doc.signed_at)}. Este é o texto
          exato que foi lido e aceito — impressões feitas a partir daqui valem como via do contrato.
        </div>

        <PrintButton />

        <article className="cartao p-5 sm:p-6">
          <ContratoTexto texto={doc.body_snapshot} className="break-words text-sm leading-relaxed text-tinta-800" />

          <section className="mt-8 border-t border-nuvem-200 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase text-stone-500">Assinatura do Contratante</p>
            {doc.signature_file_id && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/portal/arquivo/${doc.signature_file_id}`}
                alt={`Assinatura de ${doc.signer_name}`}
                className="h-24 max-w-full object-contain"
              />
            )}
            <p className="mt-1 border-t border-tinta-900 pt-1 text-sm font-semibold text-tinta-900">
              {doc.signer_name}
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
