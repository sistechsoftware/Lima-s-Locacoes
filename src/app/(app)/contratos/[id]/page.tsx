import Link from "next/link";
import { notFound } from "next/navigation";
import { one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { CONTRACT_STATUS } from "@/lib/domain";
import { dateBR } from "@/lib/format";
import { Alerta, Card, PageHeader, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { regenerateContract, saveContractBody, setContractStatus } from "../actions";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

export default async function ContratoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; editar?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const c = one<any>(
    `SELECT ct.*, r.number AS reservation_number, cu.name AS customer_name
       FROM contracts ct JOIN reservations r ON r.id = ct.reservation_id JOIN customers cu ON cu.id = r.customer_id
      WHERE ct.id = ?`,
    [Number(id)],
  );
  if (!c) notFound();
  const s = getSettings();

  return (
    <div className="space-y-4">
      <div className="nao-imprimir space-y-4">
        <PageHeader
          title={c.number}
          subtitle={`${c.customer_name} - reserva ${c.reservation_number}`}
          action={
            <>
              <PrintButton />
              <Link
                href={`/reservas/${c.reservation_id}`}
                className="inline-flex items-center rounded-xl border border-areia-300 bg-white px-4 py-2.5 text-sm font-semibold"
              >
                Ver reserva
              </Link>
            </>
          }
        />

        {sp.erro && <Alerta tone="vermelho">{sp.erro}</Alerta>}

        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge defs={CONTRACT_STATUS} value={c.status} />
            {c.sent_at && <span className="text-xs text-stone-500">Enviado em {dateBR(c.sent_at)}</span>}
            {c.signed_at && <span className="text-xs text-stone-500">Assinado em {dateBR(c.signed_at)}</span>}
          </div>

          <form action={setContractStatus} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={c.id} />
            <label className="min-w-[8rem]">
              <span className="rotulo">Status</span>
              <select name="status" defaultValue={c.status} className="campo">
                {CONTRACT_STATUS.map((st) => (
                  <option key={st.value} value={st.value}>
                    {st.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[10rem] flex-1">
              <span className="rotulo">Nome de quem assinou</span>
              <input name="signer_name" defaultValue={c.signer_name ?? ""} className="campo" />
            </label>
            <SubmitButton>Salvar</SubmitButton>
          </form>

          <div className="mt-3 flex flex-wrap gap-2">
            <form action={regenerateContract}>
              <input type="hidden" name="id" value={c.id} />
              <SubmitButton
                variant="secundario"
                confirm="Regerar o texto com os dados atuais da reserva? O texto atual sera substituido."
              >
                Regerar texto
              </SubmitButton>
            </form>
            {user.role === "admin" && (
              <Link
                href={`/contratos/${c.id}?editar=1`}
                className="inline-flex items-center rounded-xl border border-areia-300 bg-white px-4 py-2.5 text-sm font-semibold"
              >
                Editar texto
              </Link>
            )}
          </div>
        </Card>

        {sp.editar === "1" && user.role === "admin" && (
          <Card>
            <form action={saveContractBody} className="space-y-2">
              <input type="hidden" name="id" value={c.id} />
              <textarea name="body" defaultValue={c.body} rows={20} className="campo font-mono text-xs" />
              <SubmitButton>Salvar texto</SubmitButton>
            </form>
          </Card>
        )}
      </div>

      {/* documento imprimivel */}
      <article className="cartao imprimivel p-6 sm:p-10">
        <header className="mb-6 flex items-center gap-3 border-b border-areia-300 pb-4">
          {s.company_logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.company_logo} alt="" className="h-14 w-14 rounded-xl object-contain" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-terra-500 text-2xl font-black text-white">
              L
            </span>
          )}
          <div>
            <p className="text-lg font-black text-carvao-900">{s.company_name}</p>
            <p className="text-xs text-stone-500">
              {[s.company_doc, s.company_phone, s.company_city].filter(Boolean).join(" - ")}
            </p>
          </div>
          <span className="ml-auto text-right text-xs text-stone-500">
            <span className="block font-bold text-carvao-900">{c.number}</span>
            {dateBR(c.created_at)}
          </span>
        </header>
        <pre className="whitespace-pre-wrap font-sans text-[0.82rem] leading-relaxed text-carvao-900">{c.body}</pre>
      </article>
    </div>
  );
}
