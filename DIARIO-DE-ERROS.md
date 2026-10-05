# Diário de Erros — Lima's Locações

> **Auditoria realizada em 05/10/2026 na branch `fix/auditoria-diario-erros`.**
> Fonte: tabela `error_logs` (migration `0026_error_logs`), exibida na tela `/erros`.
> Leitura feita por consulta somente leitura ao banco de produção (`wrangler d1 execute --remote`
> com `SELECT *`); **nenhum registro de produção foi alterado, criado ou apagado**.
> Esta página preserva o histórico completo: os erros antigos não foram removidos.

## Panorama

| Métrica | Valor |
| --- | --- |
| Registros no Diário (produção) | **10** (ids 1–10, 28/09 a 05/10, todos `resolved = 0`) |
| Problemas distintos | **3** |
| Registros corrigidos | **8** (problemas A e B) |
| Registros não reproduzidos | **2** (problema C) |
| Registros pendentes | **0** |
| Erros relacionados não registrados, encontrados e corrigidos | **2** (ver seção própria) |

### Histórico bruto (como estava no Diário)

| id | Quando (UTC) | Fonte | Rota | Resumo |
| --- | --- | --- | --- | --- |
| 1 | 28/09 11:00 | cron | cron/aniversarios | `getCloudflareContext ... initOpenNextCloudflareForDev` |
| 2 | 30/09 01:45 | api/log-erro | — (url `/reservas/38`) | digest 65470111 (navegador) |
| 3 | 30/09 01:45 | api/log-erro | — (url `/reservas/38`) | digest 65470111 (navegador, repetição) |
| 4 | 30/09 23:29 | onRequestError | /disponibilidade/timeline | `TypeError: a2.trim is not a function` |
| 5 | 30/09 23:29 | api/log-erro | — (url `/disponibilidade/timeline`) | digest 4003482966 (navegador, par do id 4) |
| 6 | 03/10 03:00 | cron | cron/fidelidade | `getCloudflareContext ... initOpenNextCloudflareForDev` |
| 7 | 03/10 11:01 | cron | cron/aniversarios | `getCloudflareContext ... initOpenNextCloudflareForDev` |
| 8 | 04/10 15:26 | onRequestError | /disponibilidade/timeline | `TypeError: a2.trim is not a function` |
| 9 | 04/10 15:26 | api/log-erro | — (url `/disponibilidade/timeline`) | digest 500597913 (navegador, par do id 8) |
| 10 | 05/10 03:01 | cron | cron/fidelidade | `getCloudflareContext ... initOpenNextCloudflareForDev` |

**Agrupamento (duplicatas):** os ids 4+5 são o **mesmo incidente** (erro de servidor +
eco do boundary do navegador, mesmo digest) e idem 8+9; id 2+3 são duas tentativas do
**mesmo incidente** (mesmo digest, 33 s de diferença, mesmo iPhone). Os ids 1/6/7/10 são
quatro ocorrências do **mesmo bug** (duas rotinas de cron, duas execuções cada).

---

## Problema A — Erro do cron ao acessar o banco (ids 1, 6, 7, 10) — STATUS: **CORRIGIDO**

### Erro
`ERROR: getCloudflareContext has been called without having called initOpenNextCloudflareForDev`
em `cron/aniversarios` (`runBirthdayDaily`) e `cron/fidelidade` (`runFidelityDaily`).

### Causa raiz
O cron roda **fora de request**: não existe contexto Cloudflare, e o acesso ao D1 passa pelo
binding injetado em `runWithDb` (`src/lib/db.ts`). O cron dispara várias rotinas **no mesmo
tick** (notificações, fidelidade, aniversários e a poda do Diário). O `runWithDb` antigo
salvava o binding anterior num local e o **restaurava no `finally`** — quando a rotina A
terminava enquanto a rotina B ainda rodava, A **apagava o binding** e a próxima consulta de B
caía em `getCloudflareContext()` → exatamente o erro registrado. Intermitente (depende do
intercalamento), o que explica apenas 4 ocorrências e as rotinas "conseguindo na segunda
tentativa".

### Local
`src/lib/db.ts` (`runWithDb`/`getDb`), `custom-worker.ts` (orquestração do cron),
`src/lib/fidelidade-cron.ts` (rotinas diárias).

### Impacto
- Rotina de aniversários/fidelidade morria naquele minuto (tentava de novo — avisos atrasados).
- **Efeito colateral mais grave encontrado:** `runFidelityDaily` gravava a marca
  `fidelity_last_day` **ANTES** de rodar a rotina — uma falha **perdia o dia inteiro** de
  expiração de recompensas e lembretes de vencimento, sem nova tentativa (dado de negócio
  silenciosamente não processado).
- Sem perda/duplicação de dados: as rotinas são idempotentes.

### Correção (estrutural)
1. `runWithDb` agora usa um **contador de execuções ativas**: o binding só é limpo quando a
   **última** rotina concorrente termina (todas usam o mesmo `env.DB` por contrato).
   Bônus: o código antigo podia **deixar o binding ligado para sempre** após uma falha
   concorrente; o contador zera sempre.
2. `runFidelityDaily`: a marca do dia passa a ser gravada **só após sucesso** (mesma
   estratégia já usada pelos aniversários); falha ⇒ nova tentativa no minuto seguinte.
3. Os `import()` dinâmicos dos módulos de rotina agora rodam **dentro** da janela
   `runWithDb` (nenhum código do módulo executa sem o binding ativo).

### Arquivos alterados
`src/lib/db.ts`, `src/lib/fidelidade-cron.ts`

### Testes
- `tests/db-agendador.test.ts` (novo, 2 testes): reproduz a corrida A-termina-enquanto-B-rodar
  e o aninhamento. **Validação de que o teste captura o bug:** com `db.ts` revertido ao
  código antigo (via `git show HEAD:`), os 2 testes falham; com a correção, passam
  (3 execuções seguidas estáveis).
- `tests/fidelidade-cron.test.ts` (novo, 4 testes): sucesso grava a marca e deduplica;
  **falha NÃO marca** (tabela removida em banco de teste descartável → `rejects` → marca
  vazia → nova tentativa roda); aniversários rodam a partir da hora alvo e antes dela não
  marcam.
- Suíte completa: **962 testes, 0 falhas**.

### Risco de regressão
Baixo. `runWithDb` só é usado fora de request (cron); o caminho de requisição normal
(`getCloudflareContext`) não muda. Comportamento novo aceitável: uma falha persistente do cron
gera **1 registro por tentativa** no Diário (é para isso que o Diário existe).

### Observações
- Registros 1/6/7/10 podem ser marcados como resolvidos **após deploy** (ação admin em `/erros`);
  a retenção de 30 dias cuida do histórico.

---

## Problema B — Timeline de disponibilidade quebra com `trim` (ids 4, 5, 8, 9) — STATUS: **CORRIGIDO**

### Erro
`TypeError: a2.trim is not a function` na renderização de `/disponibilidade/timeline`
(servidor, digests 4003482966 e 500597913) + eco no boundary do navegador.

### Causa raiz (dupla)
1. **Gerador de URL duplicava parâmetros:** o link de período (Hoje/Amanhã/7 dias/30 dias)
   montava `?${qs}&inicio=...&fim=...`, mas `qs` (`query.queryString`) **já continha**
   `inicio`/`fim` — a URL ficava com os dois pares repetidos.
2. **Parser sem tolerância a array:** o App Router entrega parâmetro repetido como
   `string[]`; `availabilityQuery`/`normalizeStamp` chamavam `.trim()` direto → TypeError.

URLs reais registradas (ids 4 e 8) batem exatamente com essa assinatura
(`inicio=…&inicio=…&fim=…&fim=…&preparo=1&consulta=1&modo=ocupados`).

### Local
`src/app/(app)/disponibilidade/timeline/page.tsx` (`linkPeriodo`, `modo`),
`src/lib/availability-time.ts` (`normalizeStamp`, `availabilityQuery`, `timeWindow`,
`AvailabilityParams`). Consomem as mesmas funções: `/disponibilidade`, dashboard, estoque,
orçamentos, reservas, alertas.

### Impacto
- Tela inteira derrubada (500) para qualquer um que clicasse num preset de período —
  sem perda de dados, mas a funcionalidade central de consulta ficava inutilizável.
- Sem impacto em estoque/financeiro (falha é na leitura).

### Correção (estrutural)
1. `linkPeriodo` agora **substitui** `inicio`/`fim` via `URLSearchParams.set()` — nunca gera
   par repetido; `modo` também é setado (URL canônica).
2. `normalizeStamp`/`availabilityQuery`/`timeWindow` aceitam `string[]` e usam o **último
   valor** (o clique mais recente — nos URLs históricos do bug, o preset que o usuário
   clicou por último). `AvailabilityParams` tipado como `string | string[]`.
3. `sp.modo` repetido também normalizado.

### Arquivos alterados
`src/app/(app)/disponibilidade/timeline/page.tsx`, `src/lib/availability-time.ts`

### Testes
- **Reprodução confirmada antes da correção:** harness de página (invocação do server component
  com dados reais de produção) executou a URL exata do id 8 e reproduziu
  `TypeError: value.trim is not a function @ normalizeStamp` — o mesmo `a2.trim` (minificado).
- **Após a correção:** a mesma URL renderiza normalmente (verificado no harness).
- Varredura dos links gerados pelos presets: **6 links, todos com par único** `inicio`/`fim`.
- `tests/parametros-url.test.ts` (novo, 7 testes): arrays, vazio, as duas URLs exatas do
  Diário (#4 e #8), `preparo`/`consulta` repetidos, `timeWindow` e regressão de valores normais.
- Suíte completa: **962 testes, 0 falhas**; `tsc --noEmit` limpo; `next build` completo OK.

### Risco de regressão
Baixo. Valores normais (string única) seguem o mesmo caminho de antes; a única mudança de
comportamento é para URLs **com parâmetro repetido**, que hoje quebravam.

### Observações
- Os registros 4/5/8/9 podem ser marcados como resolvidos após deploy.

---

## Problema C — `/reservas/38` digest 65470111 (ids 2, 3) — STATUS: **NÃO REPRODUZIDO**

### Erro
Boundary do navegador registrou duas vezes (33 s de intervalo, mesmo iPhone/iOS 18.7,
29/09 22:45 BRT) o erro genérico de render de Server Components com digest 6547111/65470111
para `/reservas/38` (LIMA-037, criada às 19:51 do mesmo dia).

### Investigação realizada
1. **Não existe linha correspondente no servidor** (`onRequestError` não registrou nada para
   esse digest) — diferente dos ids 4/8, em que servidor+navegador vieram juntos. Indício de
   que a falha ocorreu em navegação client-side (payload RSC) ou que a escrita do registro
   falhou naquele instante.
2. Export somente leitura do banco de produção → **scratch offline** (fora do repositório);
   a página foi invocada com os **dados reais da reserva 38**:
   - código atual (`09b929b`) → **renderiza**;
   - código da época do erro (`44aadc5`, PR #20, worktree isolado) → **renderiza**;
   - estado reconstruído de 29/09 (status `confirmada`, operações `pendente`, sem contrato,
     sem pagamento 55, activities `pending`) → **renderiza**;
   - como usuário 3 (Dayana, criadora da reserva) → **renderiza**.
3. A página sobrescreve `inicio`/`fim` (`holdWindow`), então o bug de duplicação (problema B)
   **não** atinge esta rota — causa já descartada por teste.
4. Páginas relacionadas (reservas, operação, orçamentos, dashboard...) renderizam sem erro
   (varredura de 30 páginas).

### Conclusão
Com os dados e o código disponíveis não foi possível reproduzir. Nenhuma correção foi
aplicada **para não inventar causa**. Os 2 registros permanecem no Diário como evidência.

### Recomendação
- Ao voltar a ocorrer: o `onRequestError` (servidor) gravará a mensagem real com stack —
  basta conferir `/erros?aba=server` para fechar o diagnóstico.
- Possíveis fontes restantes: componente client no SSR desta tela, ou falha transiente de
  escrita do próprio `error_logs` (o registro de erro engole falhas por design).

---

## Erros relacionados NÃO registrados no Diário (encontrados na auditoria)

### R1 — `adminOnly` declarado na navegação, nunca aplicado — STATUS: **CORRIGIDO**
- **Onde:** registrado no protótipo de navegação (`prototipo-navegacao/index.html`, "sev.
  média — Registrado para correção futura"). `NavItem.adminOnly` existia em `src/lib/nav.ts`
  mas nenhum componente filtrava: "Diário de erros" aparecia para operador em **todos** os
  surfaces (sidebar clássica, modo agrupado, barra inferior, sheets "Mais" dos dois modos).
- **Correção:** helpers centrais `visiveis()`/`gruposVisiveis()` em `src/lib/nav.ts`,
  aplicados em `src/components/Shell.tsx` (NavPlano, NavGrupos, MaisClassico, MaisAgrupado,
  barra inferior e cálculo de "Mais ativo"), com `admin={user.role === "admin"}` vindo de
  `src/app/(app)/layout.tsx`. A rota `/erros` continua se defendendo sozinha (ação
  `alternarResolvido` exige admin).
- **Testes:** `tests/nav-estrutura.test.ts` +4 testes (falta para operador em todas as listas,
  grupos não vazios, ordem preservada, nenhum `adminOnly` vaza).

### R2 — Listas com `(sp.q ?? "").trim()` vulneráveis a `?q=a&q=b` — STATUS: **PENDENTE (documentado, sem correção)**
- **Onde:** `/reservas`, `/clientes`, `/orcamentos`, `/historico`, etc. (10+ páginas).
- **Análise:** nenhum gerador do sistema produz `q` repetido (formulários GET substituem a
  query; links constroem a partir de `q` já parseado). Só URL montada à mão quebra — e quebra
  com o mesmo `trim is not a function`.
- **Por que não corrigido agora:** exige decisão de escopo (helper compartilhado em 10+
  páginas). Recomendação: adotar o mesmo normalizador de `availability-time.ts` num util
  comum de `searchParams` numa próxima manutenção.

### R3 — Binding do agendador podia ficar ligado após falha concorrente — STATUS: **CORRIGIDO**
- Efeito colateral do mesmo bug do problema A, revelado pelo teste de regressão no código
  antigo (o binding antigo era restaurado para um valor já obsoleto). Corrigido pelo
  contador em `runWithDb`.

---

## Verificação final

| Verificação | Resultado |
| --- | --- |
| Testes (suíte completa) | **962 pass / 0 fail** (base 945 + 17 novos) |
| TypeScript (`tsc --noEmit`) | **limpo** |
| Build (`next build --turbopack`) | **OK** (compila + typecheck de todas as rotas) |
| Lint | **não existe** no projeto (`eslint.ignoreDuringBuilds: true`, sem script de lint) |
| Migrations / schema | **nenhuma alteração** — nada destrutivo, nenhum dado tocado |
| Banco de produção | **somente leitura** (SELECT/export para diagnóstico) |
| Páginas renderizadas com dados de produção | **30/30 OK** (listas, detalhes e layout) |
| Reprodução do problema B antes/depois | **reproduzido → corrigido → re-verificado** |

### Limitações do ambiente desta máquina
- O `workerd` (runtime Cloudflare local) **não inicia** nesta máquina (access violation
  `0xc0000005` em qualquer config, também com wrangler mais novo) — `next dev` e
  `wrangler d1 --local` ficam indisponíveis aqui. Isso é **anterior e independente** desta
  auditoria (o último dev server bem-sucedido foi em 09/09).
- Contorno usado para verificação de telas: harness fora do repositório que invoca os server
  components com stubs de `next/headers` + uma cópia offline do export de produção.
  O build de produção rodou com skip temporário do proxy (`initOpenNextCloudflareForDev`)
  **revertido em seguida** — `next.config.mjs` está intacto no diff.

### Pendências operacionais (após revisão/deploy)
1. Marcar como resolvidos os ids **1, 4, 5, 6, 7, 8, 9, 10** em `/erros` (admin) — nada foi
   alterado em produção.
2. Observar os ids **2 e 3**: se recorrerem, a linha de servidor trará a mensagem real.
3. Decidir sobre R2 (normalizador de `searchParams` nas listas).
