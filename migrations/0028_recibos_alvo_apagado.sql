-- Recibos cujo lançamento foi apagado (0028).
--
-- O CHECK da receipts (0020 e reaproveitado na 0024) exigia
--   source_type = 'payment'  -> payment_id IS NOT NULL
--   source_type = 'deposit'  -> deposit_id IS NOT NULL
-- ao mesmo tempo em que a própria coluna é
--   INTEGER REFERENCES payments(id) / deposits(id) ON DELETE SET NULL
--
-- O SQLite avalia o CHECK também na atualização disparada pela chave estrangeira:
-- a intenção documentada na 0020 ("o recibo fica sem alvo e a pagina mostra que
-- o lancamento nao existe mais") era INALCANÇÁVEL. Na prática:
--   * apagar um pagamento com recibo emitido falhava com "CHECK constraint
--     failed" — era o erro de LIMA-014 (pagamento de R$ 48,00 com recibo
--     RCB-015) em toda tentativa de "Remover";
--   * excluir a reserva inteira falhava do mesmo jeito (payments caem em
--     CASCADE pela reservation_id);
--   * excluir uma caução com recibo emitido também falhava (deposits em CASCADE).
--
-- Correção: apenas RELAXAR o CHECK para admitir o alvo nulo quando o
-- lançamento de origem deixou de existir. Nada além disso muda:
--   * continua proibido misturar alvos (recibo de pagamento nunca tem caução,
--     recibo de caução nunca tem pagamento);
--   * quitação continua exigindo obrigação + composição congelada;
--   * recibo de pagamento/caução continua exigindo payment_ids NULL;
--   * índices (inclusive as UNIQUE por lançamento e por obrigação) são os
--     mesmos, recriados com as MESMAS definições.
--
-- Nenhum dado é alterado: as linhas existentes são copiadas fielmente.
-- Migração idempotente no padrão da 0024 (renomear -> criar nova -> copiar
-- linha a linha -> dropar a antiga), seguida da recriação dos índices.

DROP TABLE IF EXISTS receipts_old_alvo;

ALTER TABLE receipts RENAME TO receipts_old_alvo;

-- Ao renomear, os índices passam a apontar para a tabela velha; se sobrarem
-- no momento da recriação, bloqueiam as UNIQUE da nova. Zerar explícito é o
-- seguro (mesmo racional da 0024).
DROP INDEX IF EXISTS idx_receipts_payment;
DROP INDEX IF EXISTS idx_receipts_deposit;
DROP INDEX IF EXISTS idx_receipts_entry;
DROP INDEX IF EXISTS idx_receipts_obrigacao;
DROP INDEX IF EXISTS uq_receipts_payment;
DROP INDEX IF EXISTS uq_receipts_deposit;
DROP INDEX IF EXISTS uq_receipts_quitacao;

CREATE TABLE IF NOT EXISTS receipts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  number       TEXT NOT NULL UNIQUE,
  source_type  TEXT NOT NULL CHECK (source_type IN ('payment', 'deposit', 'quitacao')),
  payment_id   INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  deposit_id   INTEGER REFERENCES deposits(id) ON DELETE SET NULL,
  entry_id     INTEGER REFERENCES financial_entries(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL,
  paid_at      TEXT NOT NULL,
  method       TEXT,
  body         TEXT,
  issued_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  issued_by_name TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  /* assinatura da empresa já cadastrada no momento da emissão (0021) */
  company_signature_included INTEGER,
  /* quitação (0024): obrigação quitada e os lançamentos que a compõem */
  obrigacao_tipo TEXT CHECK (obrigacao_tipo IS NULL OR obrigacao_tipo IN ('locacao','caucao')),
  obrigacao_id   INTEGER,
  payment_ids    TEXT,
  /* 0028: o alvo pode ser NULL porque o pagamento/caução foi apagado (SET NULL).
     O que continua valido é a exclusividade dos alvos por tipo de recibo. */
  CHECK (
    (source_type = 'payment' AND deposit_id IS NULL AND payment_ids IS NULL)
    OR
    (source_type = 'deposit' AND payment_id IS NULL AND payment_ids IS NULL)
    OR
    (source_type = 'quitacao' AND payment_id IS NULL AND deposit_id IS NULL
       AND obrigacao_tipo IS NOT NULL AND obrigacao_id IS NOT NULL AND payment_ids IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_receipts_payment ON receipts(payment_id);
CREATE INDEX IF NOT EXISTS idx_receipts_deposit ON receipts(deposit_id);
CREATE INDEX IF NOT EXISTS idx_receipts_entry ON receipts(entry_id);
CREATE INDEX IF NOT EXISTS idx_receipts_obrigacao ON receipts(obrigacao_tipo, obrigacao_id);

-- Um lançamento tem no máximo um recibo (0020/0024, preservado).
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipts_payment ON receipts(payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipts_deposit ON receipts(deposit_id) WHERE deposit_id IS NOT NULL;
-- Uma obrigação tem no máximo UM recibo de quitação (0024, preservado).
CREATE UNIQUE INDEX IF NOT EXISTS uq_receipts_quitacao
  ON receipts(obrigacao_tipo, obrigacao_id) WHERE source_type = 'quitacao';

-- Cópia fiel: cada recibo existente segue com o mesmo id, número, texto,
-- flag de assinatura e vínculo de lançamento que tinha.
INSERT INTO receipts
  (id, number, source_type, payment_id, deposit_id, entry_id, amount_cents, paid_at,
   method, body, issued_by, issued_by_name, created_at, company_signature_included,
   obrigacao_tipo, obrigacao_id, payment_ids)
SELECT
  id, number, source_type, payment_id, deposit_id, entry_id, amount_cents, paid_at,
  method, body, issued_by, issued_by_name, created_at, company_signature_included,
  obrigacao_tipo, obrigacao_id, payment_ids
FROM receipts_old_alvo;

DROP TABLE receipts_old_alvo;