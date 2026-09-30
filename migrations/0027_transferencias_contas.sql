-- Transferencia entre contas e natureza "dinheiro em especie".
--
-- A transferencia NAO ganha livro novo nem cria receita/despesa artificial:
-- ela e um lancamento duplo no livro de caixa que ja existe. O lado de saida
-- grava um pagamento NEGATIVO na conta de origem; o lado de entrada grava o
-- pagamento POSITIVO na conta de destino. Os dois lados compartilham o mesmo
-- transfer_group e apontam um para o outro, formando um unico evento logico.
--
-- Como o saldo de conta sempre foi inicial + entradas - saidas (soma por
-- account_id), os dois lados aparecem no saldo e no extrato de cada conta sem
-- nenhuma mudanca nas consultas existentes. O saldo consolidado (soma das
-- contas) nao se altera: o que sai de uma entra na outra.
--
-- Os indicadores de receita somam payments sem filtro (relatorios, dashboard,
-- aba Entradas do Financeiro); para a transferencia nao virar receita, essas
-- consultas passam a excluir transfer_group IS NOT NULL. expenses nunca
-- recebe transferencia, entao despesa nao muda.
--
-- Nada aqui altera lancamento antigo nenhum: todas as colunas novas nascem
-- nulas/zero e as linhas existentes continuam exatamente como estao.

-- Natureza do dinheiro: carteira fisica, caixa, dinheiro na mao. Zero nao
-- muda conta existente: a marca so existe quando o administrador gravar a
-- conta com ela, e a conta continua funcionando como qualquer outra.
ALTER TABLE financial_accounts ADD COLUMN is_cash_account INTEGER NOT NULL DEFAULT 0;

-- Identificacao do evento duplo de transferencia (os dois lados carregam o
-- mesmo grupo). Nulo = lancamento comum, sem nenhum comportamento novo.
ALTER TABLE payments ADD COLUMN transfer_group TEXT;

-- Par do evento: o debito aponta para o credito e vice-versa. ON DELETE SET
-- NULL: apagar um lado isoladamente nao apaga o outro por cascata.
ALTER TABLE payments
  ADD COLUMN transfer_counterpart_id INTEGER REFERENCES payments(id) ON DELETE SET NULL;

-- A listagem de transferencias agrupa por transfer_group; sem indice, cada
-- abertura da aba varreria payments inteiro.
CREATE INDEX IF NOT EXISTS idx_pay_transfer_group ON payments(transfer_group);
