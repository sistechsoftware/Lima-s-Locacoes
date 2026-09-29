"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alerta, Card, Field, Grid, Row } from "@/components/ui";
import { Icon } from "@/components/Icons";
import { money, parseMoney } from "@/lib/format";
import { calcularFrete, VIAGENS, type TipoFrete } from "@/lib/freight";

export type ConfigFrete = {
  baseAddress: string;
  fuelType: string;
  fuelPriceCents: number;
  consumption: number;
  costPerKmCents: number;
  marginPercent: number;
  minimumCents: number;
  roundingCents: number;
  laborCents: number;
};

type OpcaoRota = {
  index: number;
  totalKm: number;
  durationMin: number | null;
};

const semOpcoes: OpcaoRota[] = [];
const semSugestoes: Sugestao[] = [];

/**
 * Calculo roda inteiro no navegador, a partir das configuracoes ja carregadas.
 * Assim o resultado aparece enquanto o usuario digita, sem ida ao servidor.
 *
 * A distancia pode ser digitada manualmente (como sempre) ou preenchida
 * automaticamente pela rota base → destino: a formula continua sendo a mesma,
 * so a origem do numero muda.
 */
export default function Calculator({
  configs,
  salvarPreco,
}: {
  configs: Record<TipoFrete, ConfigFrete>;
  salvarPreco: (fd: FormData) => Promise<void>;
}) {
  const [tipo, setTipo] = useState<TipoFrete>("locacao");
  const config = configs[tipo];
  function selectType(value: TipoFrete) {
    setTipo(value);
    setPrecoLitro((configs[value].fuelPriceCents/100).toFixed(2));
    setMaoDeObra((configs[value].laborCents/100).toFixed(2));
  }
  const [distancia, setDistancia] = useState("");
  const [precoLitro, setPrecoLitro] = useState((config.fuelPriceCents / 100).toFixed(2));
  const [editandoPreco, setEditandoPreco] = useState(false);
  const [pedagio, setPedagio] = useState("0,00");
  const [maoDeObra, setMaoDeObra] = useState((config.laborCents / 100).toFixed(2));
  const [mostrarAvancado, setMostrarAvancado] = useState(false);

  const km = Number(String(distancia).replace(",", ".")) || 0;

  const resultado = useMemo(
    () =>
      calcularFrete({
        distanciaIdaKm: km,
        tipo,
        consumoKmPorLitro: config.consumption,
        precoLitroCents: parseMoney(precoLitro),
        custoPorKmCents: config.costPerKmCents,
        pedagioCents: parseMoney(pedagio),
        maoDeObraCents: parseMoney(maoDeObra),
        margemPercent: config.marginPercent,
        valorMinimoCents: config.minimumCents,
        arredondamentoCents: config.roundingCents,
      }),
    [km, tipo, precoLitro, pedagio, maoDeObra, config],
  );

  const limpar = () => {
    setDistancia("");
    setPedagio("0,00");
    setMaoDeObra((config.laborCents / 100).toFixed(2));
    setPrecoLitro((config.fuelPriceCents / 100).toFixed(2));
    setEditandoPreco(false);
  };

  const temResultado = km > 0;
  const precoAlterado = parseMoney(precoLitro) !== config.fuelPriceCents;

  return (
    <div className="space-y-4">
      <Card>
        <Field label="Tipo de frete">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <TipoOpcao
              checked={tipo === "comum"}
              onSelect={() => selectType("comum")}
              titulo="Frete comum"
              descricao="Uma entrega: ida e volta."
              viagens={VIAGENS.comum}
            />
            <TipoOpcao
              checked={tipo === "locacao"}
              onSelect={() => selectType("locacao")}
              titulo="Frete de Locação"
              descricao="Entrega e, depois, retirada."
              viagens={VIAGENS.locacao}
            />
          </div>
        </Field>

        <div className="mt-3">
          <EnderecoDestino
            tipo={tipo}
            basePresente={config.baseAddress.trim().length > 0}
            onDistancia={setDistancia}
            onErroDestino={() => setDistancia("")}
          />
        </div>

        <div className="mt-3">
          <Field label="Distância de ida (km) *" hint="Somente a ida. As viagens de volta entram no cálculo.">
            <input
              value={distancia}
              onChange={(e) => setDistancia(e.target.value)}
              inputMode="decimal"
              autoFocus
              placeholder="15"
              className="campo text-lg"
            />
          </Field>
        </div>

        {temResultado && (
          <p className="mt-2 rounded-xl bg-marca-50 px-3 py-2 text-sm font-semibold text-marca-700">
            {formatarKm(km)} km x {resultado.viagens} viagens = {formatarKm(resultado.distanciaTotalKm)} km totais
          </p>
        )}

        <div className="mt-3 rounded-xl border border-nuvem-300 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-tinta-700">
              Combustível ({config.fuelType}):{" "}
              <b className="text-tinta-900">{money(parseMoney(precoLitro))}/L</b>
              <span className="ml-1 text-xs text-stone-500">- {config.consumption} km/L</span>
            </span>
            <button
              type="button"
              onClick={() => setEditandoPreco((v) => !v)}
              className="text-xs font-semibold text-marca-600 underline underline-offset-2"
            >
              {editandoPreco ? "Fechar" : "Alterar"}
            </button>
          </div>

          {editandoPreco && (
            <div className="mt-2 space-y-2">
              <input
                value={precoLitro}
                onChange={(e) => setPrecoLitro(e.target.value)}
                inputMode="decimal"
                className="campo"
                aria-label="Preço do litro"
              />
              <p className="text-xs text-stone-500">
                Vale somente para este cálculo. Para alterar permanentemente, use o botão abaixo.
              </p>
              {precoAlterado && (
                <form action={salvarPreco}>
                  <input type="hidden" name="tipo" value={tipo} />
                  <input type="hidden" name="preco" value={precoLitro} />
                  <button className="rounded-xl border border-marca-600 bg-white px-3 py-2 text-xs font-semibold text-marca-600">
                    Salvar {money(parseMoney(precoLitro))}/L como padrão
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMostrarAvancado((v) => !v)}
          className="mt-3 text-xs font-semibold text-marca-600"
        >
          {mostrarAvancado ? "Ocultar" : "Pedágio e mão de obra"}
        </button>

        {mostrarAvancado && (
          <Grid>
            <Field label="Pedágio (R$)">
              <input value={pedagio} onChange={(e) => setPedagio(e.target.value)} inputMode="decimal" className="campo" />
            </Field>
            <Field label="Mão de obra (R$)">
              <input
                value={maoDeObra}
                onChange={(e) => setMaoDeObra(e.target.value)}
                inputMode="decimal"
                className="campo"
              />
            </Field>
          </Grid>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={limpar}
            className="rounded-xl border border-nuvem-300 bg-white px-4 py-2.5 text-sm font-semibold text-tinta-900"
          >
            Limpar
          </button>
          <Link
            href="/configuracoes?aba=frete"
            className="rounded-xl border border-nuvem-300 bg-white px-4 py-2.5 text-sm font-semibold text-tinta-900"
          >
            Configuracoes
          </Link>
        </div>
      </Card>

      {!temResultado ? (
        <Alerta tone="azul">Informe a distância de ida para ver o valor sugerido.</Alerta>
      ) : (
        <>
          <div className="rounded-2xl bg-destaque-500 p-5 text-center text-tinta-900 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide opacity-80">Valor Sugerido do Frete</p>
            <p className="mt-1 text-4xl font-black">{money(resultado.valorSugeridoCents)}</p>
            {resultado.aplicouMinimo && (
              <p className="mt-1 text-xs font-semibold">
                Valor mínimo de {money(resultado.valorMinimoCents)} aplicado.
              </p>
            )}
          </div>

          <section className="cartao overflow-hidden">
            <header className="border-b border-nuvem-200 bg-nuvem-50 px-4 py-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-tinta-700">Resumo do Frete</h2>
            </header>
            <div className="p-4">
              <Row label="Tipo" value={tipo === "locacao" ? "Frete de Locação" : "Frete Comum"} />
              <Row label="Distância de ida" value={`${formatarKm(km)} km`} />
              <Row label="Quantidade de viagens" value={resultado.viagens} />
              <Row label="Distância total" value={`${formatarKm(resultado.distanciaTotalKm)} km`} />
              <Row label="Consumo" value={`${config.consumption} km/L`} />
              <Row label="Combustível utilizado" value={`${resultado.litros.toFixed(2)} L`} />
              <Row label="Custo de combustível" value={money(resultado.custoCombustivelCents)} />
              <Row label="Custo operacional" value={money(resultado.custoOperacionalCents)} />
              {resultado.pedagioCents > 0 && <Row label="Pedágios" value={money(resultado.pedagioCents)} />}
              {resultado.maoDeObraCents > 0 && <Row label="Mão de obra" value={money(resultado.maoDeObraCents)} />}
              <Row
                label="Custo total da operação"
                value={<b className="text-tinta-900">{money(resultado.custoTotalCents)}</b>}
              />
              <Row label="Margem de lucro" value={`${resultado.margemPercent}%`} />
              <Row label="Preço calculado" value={money(resultado.precoCalculadoCents)} />
              <Row
                label="Valor sugerido"
                value={<b className="text-marca-600">{money(resultado.valorSugeridoCents)}</b>}
              />
              <Row
                label="Lucro estimado"
                value={<span className="text-emerald-600">{money(resultado.lucroEstimadoCents)}</span>}
              />
            </div>
          </section>

          <Card>
            <p className="mb-2 text-sm font-semibold text-tinta-900">Usar este valor</p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/fretes/novo?valor=${(resultado.valorSugeridoCents / 100).toFixed(2)}`}
                className="inline-flex items-center gap-2 rounded-xl bg-marca-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-marca-500"
              >
                <Icon name="fretes" className="h-4 w-4" />                  Novo Frete com este Valor
              </Link>
              <Link
                href={`/reservas/nova?frete=${(resultado.valorSugeridoCents / 100).toFixed(2)}`}
                className="inline-flex items-center gap-2 rounded-xl border border-marca-600 bg-white px-4 py-2.5 text-sm font-semibold text-marca-600"
              >
                <Icon name="reservas" className="h-4 w-4" />                  Usar numa Reserva
              </Link>
            </div>
            <p className="mt-2 text-xs text-stone-500">
              Combustível, custo operacional e margem são informações internas e não aparecem para o cliente.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function TipoOpcao({
  checked,
  onSelect,
  titulo,
  descricao,
  viagens,
}: {
  checked: boolean;
  onSelect: () => void;
  titulo: string;
  descricao: string;
  viagens: number;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-xl border p-3 text-left transition ${
        checked ? "border-marca-600 bg-marca-50" : "border-nuvem-300 bg-white hover:bg-nuvem-50"
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
            checked ? "border-marca-600" : "border-stone-300"
          }`}
        >
          {checked && <span className="h-2 w-2 rounded-full bg-marca-600" />}
        </span>
        <span className="text-sm font-bold text-tinta-900">{titulo}</span>
      </span>
      <span className="mt-1 block text-xs leading-snug text-stone-500">
        {descricao} <b className="text-tinta-700">{viagens} viagens</b>
      </span>
    </button>
  );
}

type Sugestao = { label: string; lat: number; lon: number };

/**
 * Campo de destino da calculadora: consulta a rota de IDA (base → destino) a
 * partir do endereco-base da empresa e entrega a distancia da rota escolhida
 * para o campo "Distância de ida (km)". O valor sugerido e calculado pelo
 * useMemo existente, com o tipo de frete que estiver selecionado — nada aqui
 * multiplica, divide ou recalcula nada.
 */
function EnderecoDestino({
  tipo,
  basePresente,
  onDistancia,
  onErroDestino,
}: {
  tipo: TipoFrete;
  basePresente: boolean;
  onDistancia: (km: string) => void;
  onErroDestino: () => void;
}) {
  const [destino, setDestino] = useState("");
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false);
  const [opcoes, setOpcoes] = useState<OpcaoRota[]>(semOpcoes);
  const [selecionada, setSelecionada] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const generation = useRef(0);
  const raiz = useRef<HTMLDivElement | null>(null);

  // Mudou o tipo de frete: reenvia a distancia da rota selecionada, para o
  // useMemo existente recalcular com as regras do tipo marcado agora.
  useEffect(() => {
    if (opcoes.length && selecionada !== null) {
      onDistancia(opcoes[selecionada].totalKm.toFixed(2).replace(".", ","));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  // Fecha a lista de sugestoes ao clicar fora (padrao iOS: toque fora fecha).
  useEffect(() => {
    function fora(event: PointerEvent) {
      if (!raiz.current?.contains(event.target as Node)) setSugestoesAbertas(false);
    }
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, []);

  // Sugestoes so depois de 5 caracteres, com debounce: sem consulta por tecla.
  useEffect(() => {
    const consulta = destino.trim();
    if (consulta.length < 5) {
      setSugestoes(semSugestoes);
      return;
    }
    const timer = setTimeout(async () => {
      const version = ++generation.current;
      try {
        const response = await fetch("/api/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: consulta }),
        });
        const data = await response.json() as unknown;
        if (version !== generation.current) return;
        if (!response.ok || !Array.isArray(data)) return;
        setSugestoes(data.filter((s): s is Sugestao => typeof s?.label === "string" && Number.isFinite(s?.lat) && Number.isFinite(s?.lon)));
      } catch { /* offline: o usuario digita o endereco manualmente */ }
    }, 600);
    return () => clearTimeout(timer);
  }, [destino]);

  async function consultarRotas(enderecoDestino: string) {
    const alvo = enderecoDestino.trim();
    if (!basePresente) {
      setErro("Cadastre o endereço base da empresa antes de calcular o frete.");
      onErroDestino();
      return;
    }
    if (!alvo) {
      setErro("Informe o endereço de destino.");
      onErroDestino();
      return;
    }
    if (alvo.length < 10) {
      setErro("Informe o endereço completo: rua, número, cidade e estado.");
      onErroDestino();
      return;
    }
    const version = ++generation.current;
    setBusy(true);
    setErro("");
    setAviso("");
    try {
      const response = await fetch("/api/routes/opcoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, destination: alvo }),
      });
      const data = await response.json() as unknown;
      if (version !== generation.current) return;
      if (!response.ok) {
        setOpcoes(semOpcoes);
        setSelecionada(null);
        setErro(typeof (data as { error?: unknown })?.error === "string" ? (data as { error: string }).error : "Não foi possível consultar a rota. Informe a distância manualmente.");
        onErroDestino();
        return;
      }
      const brutas = Array.isArray(data) ? data : [];
      const validas = brutas
        .filter((o): o is { totalKm: number; durationMin: number | null } => !!o && typeof o === "object" && Number.isFinite((o as { totalKm?: unknown }).totalKm) && (o as { totalKm: number }).totalKm > 0)
        .map((o, index) => ({ ...o, index }));
      if (!validas.length) {
        setOpcoes(semOpcoes);
        setSelecionada(null);
        setErro("Nenhuma rota encontrada para este endereço. Informe a distância manualmente.");
        onErroDestino();
        return;
      }
      setOpcoes(validas);
      escolher(validas[0]);
      setAviso(validas.length > 1 ? `${validas.length} rotas encontradas. Escolha uma opção.` : "");
    } catch {
      if (version !== generation.current) return;
      setOpcoes(semOpcoes);
      setSelecionada(null);
      setErro("Não foi possível consultar a rota agora. Informe a distância manualmente.");
      onErroDestino();
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }

  function escolher(opcao: OpcaoRota) {
    setSelecionada(opcao.index);
    // Envia somente a ida; quem multiplica pelas viagens e a formula de sempre.
    onDistancia(opcao.totalKm.toFixed(2).replace(".", ","));
  }

  return (
    <div>
      <div ref={raiz} className="relative">
        <Field label="Endereço de destino" hint="Rua, número, cidade e estado. A origem é o endereço base da empresa.">
          <input
            value={destino}
            onChange={(e) => {
              setDestino(e.target.value);
              setSugestoesAbertas(true);
            }}
            onFocus={() => sugestoes.length > 0 && setSugestoesAbertas(true)}
            inputMode="text"
            autoComplete="off"
            placeholder="Ex.: Rua das Palmeiras, 120, Santos, SP"
            className="campo"
            aria-label="Endereço de destino"
            aria-expanded={sugestoesAbertas}
          />
        </Field>
        {sugestoesAbertas && sugestoes.length > 0 && (
          <ul className="absolute z-20 left-0 right-0 top-full mt-1 overflow-hidden rounded-xl border border-nuvem-300 bg-white shadow-lg">
            {sugestoes.map((s, i) => (
              <li key={`${s.lat}-${s.lon}-${i}`}>
                <button
                  type="button"
                  className="w-full px-3 py-3 text-left text-sm text-tinta-900 hover:bg-marca-50"
                  onClick={() => {
                    setDestino(s.label);
                    setSugestoesAbertas(false);
                    consultarRotas(s.label);
                  }}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!basePresente && (
        <p className="mt-1 text-xs text-amber-700">
          Cadastre o endereço base da empresa em Configurações para calcular o frete por endereço.
        </p>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => consultarRotas(destino)}
        className="mt-2 w-full rounded-xl bg-marca-600 px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50 sm:w-auto"
      >
        {busy ? "Calculando rota..." : "Consultar rota"}
      </button>

      {busy && (
        <p aria-live="polite" className="mt-2 text-sm font-semibold text-marca-700">
          Calculando rota...
        </p>
      )}
      {erro && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {erro}
        </p>
      )}
      {aviso && !busy && (
        <p aria-live="polite" className="mt-2 text-sm font-semibold text-tinta-700">
          {aviso}
        </p>
      )}

      {opcoes.length > 1 && (
        <div className="mt-2 space-y-2" role="radiogroup" aria-label="Rotas encontradas">
          {opcoes.map((opcao) => (
            <button
              key={opcao.index}
              type="button"
              role="radio"
              aria-checked={selecionada === opcao.index}
              onClick={() => escolher(opcao)}
              className={`w-full rounded-xl border p-3 text-left transition ${
                selecionada === opcao.index ? "border-marca-600 bg-marca-50" : "border-nuvem-300 bg-white"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-tinta-900">Rota {opcao.index + 1}</span>
                <span className="text-sm font-semibold text-tinta-900">{formatarKm(opcao.totalKm)} km</span>
              </span>
              <span className="mt-0.5 block text-xs text-stone-500">
                {opcao.durationMin !== null ? `aproximadamente ${opcao.durationMin} min` : "duração indisponível"}
                {selecionada === opcao.index ? " · selecionada" : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {opcoes.length === 1 && selecionada === 0 && !busy && !erro && (
        <p className="mt-2 text-sm text-emerald-700">
          Rota única aplicada: {formatarKm(opcoes[0].totalKm)} km de ida.
        </p>
      )}
    </div>
  );
}

const formatarKm = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
