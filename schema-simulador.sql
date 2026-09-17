DROP TABLE IF EXISTS simulacoes;

CREATE TABLE simulacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,              -- 'solar' | 'bess'
  cliente TEXT,
  criado_em INTEGER NOT NULL,      -- epoch ms
  atualizado_em INTEGER NOT NULL,  -- epoch ms
  dados TEXT NOT NULL              -- JSON: todos os campos de entrada do formulário
);

CREATE INDEX idx_simulacoes_tipo ON simulacoes(tipo);
CREATE INDEX idx_simulacoes_criado ON simulacoes(criado_em);
