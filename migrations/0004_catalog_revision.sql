-- Revisão global persistente; nenhuma linha comercial é alterada pela migration.
CREATE TABLE catalog_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991)
) STRICT;
INSERT INTO catalog_meta (singleton, revision) VALUES (1, 0);

-- A view é um comando transacional, sem payload persistido ou save_guard global.
CREATE VIEW catalog_save AS SELECT singleton, revision, NULL AS payload FROM catalog_meta;

CREATE TRIGGER products_revision_insert AFTER INSERT ON products
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
CREATE TRIGGER products_revision_delete AFTER DELETE ON products
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
CREATE TRIGGER products_revision_update AFTER UPDATE ON products
WHEN OLD.id IS NOT NEW.id OR OLD.name IS NOT NEW.name OR OLD.description IS NOT NEW.description
  OR OLD.price_30_cents IS NOT NEW.price_30_cents OR OLD.price_50_cents IS NOT NEW.price_50_cents
  OR OLD.visible IS NOT NEW.visible OR OLD.sort_order IS NOT NEW.sort_order
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;

CREATE TRIGGER cachaca_revision_insert AFTER INSERT ON cachaca
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
CREATE TRIGGER cachaca_revision_delete AFTER DELETE ON cachaca
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
CREATE TRIGGER cachaca_revision_update AFTER UPDATE ON cachaca
WHEN OLD.id IS NOT NEW.id OR OLD.title IS NOT NEW.title OR OLD.description IS NOT NEW.description
  OR OLD.bottle_ml IS NOT NEW.bottle_ml OR OLD.price_cents IS NOT NEW.price_cents
  OR OLD.visible IS NOT NEW.visible OR OLD.singleton IS NOT NEW.singleton
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;

CREATE TRIGGER catalog_save_command INSTEAD OF UPDATE OF payload ON catalog_save
BEGIN
  -- Bijeção de IDs validada dentro da mesma operação, sem criar/excluir registros.
  SELECT CASE WHEN
    (SELECT COUNT(*) FROM products) <> json_array_length(NEW.payload, '$.chopes')
    OR (SELECT COUNT(*) FROM cachaca) <> json_array_length(NEW.payload, '$.cachacas')
    OR (SELECT COUNT(DISTINCT json_extract(value, '$.id')) FROM json_each(NEW.payload, '$.chopes')) <> json_array_length(NEW.payload, '$.chopes')
    OR (SELECT COUNT(DISTINCT json_extract(value, '$.id')) FROM json_each(NEW.payload, '$.cachacas')) <> json_array_length(NEW.payload, '$.cachacas')
    OR EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.chopes') j LEFT JOIN products p ON p.id = json_extract(j.value, '$.id') WHERE p.id IS NULL)
    OR EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.cachacas') j LEFT JOIN cachaca c ON c.id = json_extract(j.value, '$.id') WHERE c.id IS NULL)
    THEN RAISE(ABORT, 'CATALOG_IDS_INVALID') END;

  -- Materializa o plano antes de ordenar: a decisão não muda a cada linha escrita.
  -- Ordem idêntica preserva posições empatadas/esparsas criadas por PATCH individual.
  UPDATE products SET sort_order = planned.position FROM (
    WITH plan AS MATERIALIZED (
      SELECT json_extract(value, '$.id') AS id, CAST(key AS INTEGER) AS position
      FROM json_each(NEW.payload, '$.chopes')
      WHERE (SELECT json_group_array(id) FROM (SELECT id FROM products ORDER BY sort_order, id))
        <> (SELECT json_group_array(id) FROM (SELECT json_extract(value, '$.id') AS id FROM json_each(NEW.payload, '$.chopes') ORDER BY CAST(key AS INTEGER)))
    ) SELECT * FROM plan
  ) AS planned WHERE products.id = planned.id AND products.sort_order IS NOT planned.position;

  UPDATE products SET
    name = json_extract(incoming.value, '$.name'),
    description = json_extract(incoming.value, '$.description'),
    price_30_cents = json_extract(incoming.value, '$.prices."30"'),
    price_50_cents = json_extract(incoming.value, '$.prices."50"'),
    visible = json_extract(incoming.value, '$.visible')
  FROM json_each(NEW.payload, '$.chopes') AS incoming
  WHERE products.id = json_extract(incoming.value, '$.id') AND (
    products.name IS NOT json_extract(incoming.value, '$.name')
    OR products.description IS NOT json_extract(incoming.value, '$.description')
    OR products.price_30_cents IS NOT json_extract(incoming.value, '$.prices."30"')
    OR products.price_50_cents IS NOT json_extract(incoming.value, '$.prices."50"')
    OR products.visible IS NOT json_extract(incoming.value, '$.visible'));

  UPDATE cachaca SET
    title = json_extract(incoming.value, '$.name'),
    description = json_extract(incoming.value, '$.description'),
    price_cents = json_extract(incoming.value, '$.prices.bottle'),
    visible = json_extract(incoming.value, '$.visible')
  FROM json_each(NEW.payload, '$.cachacas') AS incoming
  WHERE cachaca.id = json_extract(incoming.value, '$.id') AND (
    cachaca.title IS NOT json_extract(incoming.value, '$.name')
    OR cachaca.description IS NOT json_extract(incoming.value, '$.description')
    OR cachaca.price_cents IS NOT json_extract(incoming.value, '$.prices.bottle')
    OR cachaca.visible IS NOT json_extract(incoming.value, '$.visible'));

  -- Um trigger que ignore ou modifique silenciosamente uma escrita não vira sucesso parcial.
  SELECT CASE WHEN
    (SELECT COUNT(*) FROM products) <> json_array_length(NEW.payload, '$.chopes')
    OR (SELECT COUNT(*) FROM cachaca) <> json_array_length(NEW.payload, '$.cachacas')
    OR EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.chopes') j LEFT JOIN products p ON p.id = json_extract(j.value, '$.id') WHERE p.id IS NULL
      OR p.name IS NOT json_extract(j.value, '$.name') OR p.description IS NOT json_extract(j.value, '$.description')
      OR p.price_30_cents IS NOT json_extract(j.value, '$.prices."30"') OR p.price_50_cents IS NOT json_extract(j.value, '$.prices."50"')
      OR p.visible IS NOT json_extract(j.value, '$.visible'))
    OR EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.cachacas') j LEFT JOIN cachaca c ON c.id = json_extract(j.value, '$.id') WHERE c.id IS NULL
      OR c.title IS NOT json_extract(j.value, '$.name') OR c.description IS NOT json_extract(j.value, '$.description')
      OR c.price_cents IS NOT json_extract(j.value, '$.prices.bottle') OR c.visible IS NOT json_extract(j.value, '$.visible'))
    OR (SELECT json_group_array(id) FROM (SELECT id FROM products ORDER BY sort_order, id))
      <> (SELECT json_group_array(id) FROM (SELECT json_extract(value, '$.id') AS id FROM json_each(NEW.payload, '$.chopes') ORDER BY CAST(key AS INTEGER)))
    THEN RAISE(ABORT, 'CATALOG_SAVE_INCOMPLETE') END;
END;
