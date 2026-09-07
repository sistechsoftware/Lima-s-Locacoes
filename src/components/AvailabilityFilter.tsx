import { type AvailabilityQuery } from "@/lib/availability-time";

export default function AvailabilityFilter({ query, minutes, hidden = {}, fixed = false }: {
  query: AvailabilityQuery; minutes: number; hidden?: Record<string, string>; fixed?: boolean;
}) {
  return <section className="cartao p-4 space-y-2">
    <form className="flex flex-wrap items-end gap-3" key={query.queryString}>
      <input type="hidden" name="consulta" value="1" />
      {Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {!fixed && <>
        <label><span className="rotulo">Data e horario da consulta</span><input required type="datetime-local" name="inicio" defaultValue={query.from} className="campo" /></label>
        <label><span className="rotulo">Ate (opcional: consultar um intervalo)</span><input type="datetime-local" name="fim" defaultValue={query.to === query.from ? "" : query.to} min={query.from} className="campo" /></label>
      </>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="preparo" value="1" defaultChecked={query.considerPreparation} />Considerar tempo de deslocamento e higienizacao</label>
      <button className="rounded-xl bg-marca-600 px-4 py-2 text-sm font-semibold text-white">Consultar</button>
    </form>
    <p className="text-sm font-semibold">{query.label}</p>
    <p className="text-xs text-stone-500">Horario de Sao Paulo. {query.considerPreparation ? `Considerando ${minutes} min de deslocamento/higienizacao apos a devolucao.` : "Sem tempo adicional apos a devolucao."} O item libera exatamente no fim da ocupacao.</p>
  </section>;
}
