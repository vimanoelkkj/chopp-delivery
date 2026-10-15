-- Corte coordenado LOCAL: parar escritores e obter backup antes da aplicação.
-- Arquivos legados são congelados. Nunca consultar como fallback após o corte.
CREATE TABLE _catalog_assert (ok INTEGER NOT NULL CHECK (ok = 1)) STRICT;
INSERT INTO _catalog_assert SELECT CASE WHEN COUNT(*) = 1 AND MIN(revision) >= 0 THEN 1 ELSE 0 END FROM catalog_meta;
CREATE TABLE _catalog_revision_before AS SELECT revision FROM catalog_meta;

CREATE TABLE catalog_categories (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 2147483647)
) STRICT;
CREATE TABLE catalog_items (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
  category_id TEXT NOT NULL REFERENCES catalog_categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK (length(description) <= 2000),
  visible INTEGER NOT NULL CHECK (visible IN (0, 1)),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 2147483647),
  creation_ref TEXT UNIQUE
) STRICT;
CREATE TABLE catalog_variants (
  item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 128),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  volume_ml INTEGER CHECK (volume_ml BETWEEN 1 AND 9007199254740991),
  price_cents INTEGER CHECK (price_cents BETWEEN 1 AND 9999999),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN 0 AND 2147483647),
  creation_ref TEXT,
  PRIMARY KEY (item_id, code),
  UNIQUE (creation_ref)
) STRICT;
CREATE INDEX catalog_items_order ON catalog_items(category_id, sort_order, id);
CREATE INDEX catalog_variants_order ON catalog_variants(item_id, sort_order, code);
-- checkpoint: ddl
INSERT INTO catalog_categories VALUES ('chopes', 'Chopes', 0), ('cachacas', 'Cachaças', 1);
CREATE VIEW _catalog_source_items AS
  SELECT id, 'chopes' AS category_id, name, description, visible, sort_order FROM products
  UNION ALL SELECT id, 'cachacas', title, description, visible, 0 FROM cachaca;
CREATE VIEW _catalog_source_variants AS
  SELECT id AS item_id, '30' AS code, 'Barril de 30 L' AS label, 30000 AS volume_ml, price_30_cents AS price_cents, 0 AS sort_order FROM products
  UNION ALL SELECT id, '50', 'Barril de 50 L', 50000, price_50_cents, 1 FROM products
  UNION ALL SELECT id, 'bottle', 'Garrafa', bottle_ml, price_cents, 0 FROM cachaca;
INSERT INTO catalog_items (id, category_id, name, description, visible, sort_order) SELECT * FROM _catalog_source_items;
INSERT INTO catalog_variants (item_id, code, label, volume_ml, price_cents, sort_order) SELECT * FROM _catalog_source_variants;
-- checkpoint: backfill
INSERT INTO _catalog_assert VALUES (CASE WHEN
  NOT EXISTS (SELECT * FROM _catalog_source_items EXCEPT SELECT id, category_id, name, description, visible, sort_order FROM catalog_items)
  AND NOT EXISTS (SELECT id, category_id, name, description, visible, sort_order FROM catalog_items EXCEPT SELECT * FROM _catalog_source_items)
  AND NOT EXISTS (SELECT * FROM _catalog_source_variants EXCEPT SELECT item_id, code, label, volume_ml, price_cents, sort_order FROM catalog_variants)
  AND NOT EXISTS (SELECT item_id, code, label, volume_ml, price_cents, sort_order FROM catalog_variants EXCEPT SELECT * FROM _catalog_source_variants)
  AND NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check)
  AND NOT EXISTS (SELECT 1 FROM catalog_items i WHERE i.visible = 1 AND NOT EXISTS (SELECT 1 FROM catalog_variants v WHERE v.item_id = i.id AND v.price_cents IS NOT NULL))
  THEN 1 ELSE 0 END);
DROP VIEW _catalog_source_items;
DROP VIEW _catalog_source_variants;
DROP TRIGGER catalog_save_command;
DROP VIEW catalog_save;
DROP TRIGGER products_revision_insert;
DROP TRIGGER products_revision_update;
DROP TRIGGER products_revision_delete;
DROP TRIGGER cachaca_revision_insert;
DROP TRIGGER cachaca_revision_update;
DROP TRIGGER cachaca_revision_delete;
-- checkpoint: retire
UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
-- checkpoint: revision
INSERT INTO _catalog_assert VALUES (CASE WHEN (SELECT revision FROM catalog_meta) = (SELECT revision + 1 FROM _catalog_revision_before) THEN 1 ELSE 0 END);
DROP TABLE _catalog_revision_before;
DROP TABLE _catalog_assert;
CREATE VIEW catalog_state AS SELECT json_array(
  (SELECT json_group_array(json_array(id,name,sort_order)) FROM
    (SELECT * FROM catalog_categories ORDER BY id)),
  (SELECT json_group_array(json_array(id,category_id,name,description,visible,sort_order,creation_ref)) FROM
    (SELECT * FROM catalog_items ORDER BY id)),
  (SELECT json_group_array(json_array(item_id,code,label,volume_ml,price_cents,sort_order,creation_ref)) FROM
    (SELECT * FROM catalog_variants ORDER BY item_id,code))
) AS payload;
CREATE VIEW catalog_write AS SELECT singleton, revision, NULL AS payload,
  (SELECT payload FROM catalog_state) AS baseline,
  NULL AS session_hash, NULL AS user_id, NULL AS origin FROM catalog_meta;
CREATE VIEW catalog_ready AS SELECT 1 AS ready WHERE
  (SELECT COUNT(*) FROM catalog_meta WHERE singleton = 1 AND revision >= 0) = 1
  AND EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0005_catalog_expansion.sql')
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN (
    'catalog_meta','catalog_categories','catalog_items','catalog_variants')) = 4
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'view' AND name IN (
    'catalog_state','catalog_write')) = 2
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'index' AND name IN (
    'catalog_items_order','catalog_variants_order')) = 2
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name IN (
    'products_frozen_insert','products_frozen_update','products_frozen_delete',
    'cachaca_frozen_insert','cachaca_frozen_update','cachaca_frozen_delete',
    'catalog_categories_revision_insert','catalog_categories_revision_update','catalog_categories_revision_delete',
    'catalog_items_revision_insert','catalog_items_revision_update','catalog_items_revision_delete',
    'catalog_variants_revision_insert','catalog_variants_revision_update','catalog_variants_revision_delete',
    'catalog_write_command')) = 16
  AND NOT EXISTS (SELECT 1 FROM sqlite_schema WHERE name IN ('catalog_save','catalog_save_command'));


CREATE TRIGGER products_frozen_insert BEFORE INSERT ON products
BEGIN SELECT RAISE(ABORT, 'CATALOG_LEGACY_READ_ONLY'); END;
CREATE TRIGGER products_frozen_update BEFORE UPDATE ON products
BEGIN SELECT RAISE(ABORT, 'CATALOG_LEGACY_READ_ONLY'); END;
CREATE TRIGGER products_frozen_delete BEFORE DELETE ON products
BEGIN SELECT RAISE(ABORT, 'CATALOG_LEGACY_READ_ONLY'); END;
CREATE TRIGGER cachaca_frozen_insert BEFORE INSERT ON cachaca
BEGIN SELECT RAISE(ABORT, 'CATALOG_LEGACY_READ_ONLY'); END;
CREATE TRIGGER cachaca_frozen_update BEFORE UPDATE ON cachaca
BEGIN SELECT RAISE(ABORT, 'CATALOG_LEGACY_READ_ONLY'); END;
CREATE TRIGGER cachaca_frozen_delete BEFORE DELETE ON cachaca
BEGIN SELECT RAISE(ABORT, 'CATALOG_LEGACY_READ_ONLY'); END;
CREATE TRIGGER catalog_categories_revision_insert AFTER INSERT ON catalog_categories
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN changes() <> 1 OR NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
CREATE TRIGGER catalog_categories_revision_update AFTER UPDATE ON catalog_categories
WHEN OLD.id IS NOT NEW.id OR OLD.name IS NOT NEW.name OR OLD.sort_order IS NOT NEW.sort_order
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN changes() <> 1 OR NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
CREATE TRIGGER catalog_categories_revision_delete AFTER DELETE ON catalog_categories
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN changes() <> 1 OR NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
CREATE TRIGGER catalog_items_revision_insert AFTER INSERT ON catalog_items
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN changes() <> 1 OR NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
CREATE TRIGGER catalog_items_revision_update AFTER UPDATE ON catalog_items
WHEN OLD.id IS NOT NEW.id OR OLD.category_id IS NOT NEW.category_id OR OLD.name IS NOT NEW.name OR OLD.description IS NOT NEW.description OR OLD.visible IS NOT NEW.visible OR OLD.sort_order IS NOT NEW.sort_order OR OLD.creation_ref IS NOT NEW.creation_ref
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN changes() <> 1 OR NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
CREATE TRIGGER catalog_items_revision_delete AFTER DELETE ON catalog_items
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN changes() <> 1 OR NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
CREATE TRIGGER catalog_variants_revision_insert AFTER INSERT ON catalog_variants
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN changes() <> 1 OR NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
CREATE TRIGGER catalog_variants_revision_update AFTER UPDATE ON catalog_variants
WHEN OLD.item_id IS NOT NEW.item_id OR OLD.code IS NOT NEW.code OR OLD.label IS NOT NEW.label OR OLD.volume_ml IS NOT NEW.volume_ml OR OLD.price_cents IS NOT NEW.price_cents OR OLD.sort_order IS NOT NEW.sort_order OR OLD.creation_ref IS NOT NEW.creation_ref
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN changes() <> 1 OR NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
CREATE TRIGGER catalog_variants_revision_delete AFTER DELETE ON catalog_variants
BEGIN
  UPDATE catalog_meta SET revision = revision + 1 WHERE singleton = 1;
  SELECT CASE WHEN changes() <> 1 OR NOT EXISTS (SELECT 1 FROM catalog_meta WHERE singleton = 1) THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;

CREATE TRIGGER catalog_write_command INSTEAD OF UPDATE ON catalog_write
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_ready) THEN RAISE(ABORT, 'CATALOG_SCHEMA_UNAVAILABLE') END;
  SELECT CASE WHEN EXISTS (SELECT id,name FROM catalog_categories EXCEPT SELECT json_extract(j.value,
    '$.id'),json_extract(j.value, '$.name') FROM json_each(NEW.payload, '$.categories') j) OR EXISTS (SELECT
    json_extract(j.value, '$.id'),json_extract(j.value, '$.name') FROM json_each(NEW.payload, '$.categories') j
    EXCEPT SELECT id,name FROM catalog_categories) THEN RAISE(ABORT, 'CATALOG_IDENTITY') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.categories') j GROUP BY json_extract(j.value,
    '$.id') HAVING COUNT(*) > 1) THEN RAISE(ABORT, 'CATALOG_IDENTITY') END;
  SELECT CASE WHEN EXISTS (SELECT id,category_id FROM catalog_items EXCEPT SELECT json_extract(j.value,
    '$.id'),json_extract(j.value, '$.categoryId') FROM json_each(NEW.payload, '$.items') j WHERE
    json_extract(j.value, '$.isNew') = 0) OR EXISTS (SELECT json_extract(j.value, '$.id'),json_extract(j.value,
    '$.categoryId') FROM json_each(NEW.payload, '$.items') j WHERE json_extract(j.value, '$.isNew') = 0 EXCEPT
    SELECT id,category_id FROM catalog_items) THEN RAISE(ABORT, 'CATALOG_IDENTITY') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.items') j GROUP BY json_extract(j.value,
    '$.id') HAVING COUNT(*) > 1) THEN RAISE(ABORT, 'CATALOG_IDENTITY') END;
  SELECT CASE WHEN EXISTS (SELECT item_id,code FROM catalog_variants EXCEPT SELECT json_extract(j.value,
    '$.itemId'),json_extract(j.value, '$.code') FROM json_each(NEW.payload, '$.variants') j WHERE
    json_extract(j.value, '$.isNew') = 0) OR EXISTS (SELECT json_extract(j.value,
    '$.itemId'),json_extract(j.value, '$.code') FROM json_each(NEW.payload, '$.variants') j WHERE
    json_extract(j.value, '$.isNew') = 0 EXCEPT SELECT item_id,code FROM catalog_variants) THEN RAISE(ABORT,
    'CATALOG_IDENTITY') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.variants') j GROUP BY json_extract(j.value,
    '$.itemId'),json_extract(j.value, '$.code') HAVING COUNT(*) > 1) THEN RAISE(ABORT, 'CATALOG_IDENTITY') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.items') j WHERE json_extract(j.value,
    '$.isNew') = 1 AND (EXISTS (SELECT 1 FROM catalog_items WHERE id = json_extract(j.value, '$.id')) OR
    json_extract(j.value, '$.creationRef') IS NULL)) THEN RAISE(ABORT, 'CATALOG_IDENTITY') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.variants') j WHERE json_extract(j.value,
    '$.isNew') = 1 AND (EXISTS (SELECT 1 FROM catalog_variants WHERE item_id = json_extract(j.value, '$.itemId')
    AND code = json_extract(j.value, '$.code')) OR json_extract(j.value, '$.creationRef') IS NULL)) THEN
    RAISE(ABORT, 'CATALOG_IDENTITY') END;
  SELECT CASE WHEN EXISTS (SELECT ref FROM (SELECT json_extract(value,'$.creationRef') AS ref FROM
    json_each(NEW.payload,'$.items') WHERE json_extract(value,'$.isNew')=1 UNION ALL SELECT
    json_extract(value,'$.creationRef') FROM json_each(NEW.payload,'$.variants') WHERE
    json_extract(value,'$.isNew')=1) GROUP BY ref HAVING COUNT(*) > 1) OR EXISTS (SELECT 1 FROM (SELECT
    json_extract(value,'$.creationRef') AS ref FROM json_each(NEW.payload,'$.items') WHERE
    json_extract(value,'$.isNew')=1 UNION ALL SELECT json_extract(value,'$.creationRef') FROM
    json_each(NEW.payload,'$.variants') WHERE json_extract(value,'$.isNew')=1) r WHERE EXISTS (SELECT 1 FROM
    catalog_items WHERE creation_ref = r.ref) OR EXISTS (SELECT 1 FROM catalog_variants WHERE creation_ref =
    r.ref)) THEN RAISE(ABORT, 'CATALOG_IDENTITY') END;
  INSERT INTO catalog_items (id,category_id,name,description,visible,sort_order,creation_ref) SELECT
    json_extract(j.value, '$.id'),json_extract(j.value, '$.categoryId'),json_extract(j.value,
    '$.name'),json_extract(j.value, '$.description'),json_extract(j.value, '$.visible'),json_extract(j.value,
    '$.position'),json_extract(j.value, '$.creationRef') FROM json_each(NEW.payload, '$.items') j WHERE
    json_extract(j.value, '$.isNew') = 1;
  UPDATE catalog_items SET name = (SELECT json_extract(j.value, '$.name') FROM json_each(NEW.payload, '$.items')
    j WHERE catalog_items.id = json_extract(j.value, '$.id')),description = (SELECT json_extract(j.value,
    '$.description') FROM json_each(NEW.payload, '$.items') j WHERE catalog_items.id = json_extract(j.value,
    '$.id')),visible = (SELECT json_extract(j.value, '$.visible') FROM json_each(NEW.payload, '$.items') j WHERE
    catalog_items.id = json_extract(j.value, '$.id')) WHERE EXISTS (SELECT 1 FROM json_each(NEW.payload,
    '$.items') j WHERE catalog_items.id = json_extract(j.value, '$.id') AND (catalog_items.name IS NOT
    json_extract(j.value, '$.name') OR catalog_items.description IS NOT json_extract(j.value, '$.description')
    OR catalog_items.visible IS NOT json_extract(j.value, '$.visible')));
  INSERT INTO catalog_variants (item_id,code,label,volume_ml,price_cents,sort_order,creation_ref) SELECT
    json_extract(j.value, '$.itemId'),json_extract(j.value, '$.code'),json_extract(j.value,
    '$.label'),json_extract(j.value, '$.volumeMl'),json_extract(j.value, '$.priceCents'),json_extract(j.value,
    '$.position'),json_extract(j.value, '$.creationRef') FROM json_each(NEW.payload, '$.variants') j WHERE
    json_extract(j.value, '$.isNew') = 1;
  UPDATE catalog_variants SET label = (SELECT json_extract(j.value, '$.label') FROM json_each(NEW.payload,
    '$.variants') j WHERE catalog_variants.item_id = json_extract(j.value, '$.itemId') AND catalog_variants.code
    = json_extract(j.value, '$.code')),volume_ml = (SELECT json_extract(j.value, '$.volumeMl') FROM
    json_each(NEW.payload, '$.variants') j WHERE catalog_variants.item_id = json_extract(j.value, '$.itemId')
    AND catalog_variants.code = json_extract(j.value, '$.code')),price_cents = (SELECT json_extract(j.value,
    '$.priceCents') FROM json_each(NEW.payload, '$.variants') j WHERE catalog_variants.item_id =
    json_extract(j.value, '$.itemId') AND catalog_variants.code = json_extract(j.value, '$.code')) WHERE EXISTS
    (SELECT 1 FROM json_each(NEW.payload, '$.variants') j WHERE catalog_variants.item_id = json_extract(j.value,
    '$.itemId') AND catalog_variants.code = json_extract(j.value, '$.code') AND (catalog_variants.label IS NOT
    json_extract(j.value, '$.label') OR catalog_variants.volume_ml IS NOT json_extract(j.value, '$.volumeMl') OR
    catalog_variants.price_cents IS NOT json_extract(j.value, '$.priceCents')));
  UPDATE catalog_categories SET sort_order = d.target FROM (WITH desired AS MATERIALIZED (SELECT c.id, CASE WHEN
    (SELECT json_group_array(k) FROM (SELECT t.id AS k FROM catalog_categories t WHERE 1=1 ORDER BY
    t.sort_order,t.id)) = (SELECT json_group_array(k) FROM (SELECT json_extract(value,'$.id') AS k FROM
    json_each(NEW.payload,'$.categories') WHERE 1=1 ORDER BY json_extract(value,'$.position'))) THEN
    c.sort_order ELSE json_extract(j.value, '$.position') END AS target FROM catalog_categories c JOIN
    json_each(NEW.payload, '$.categories') j ON json_extract(j.value, '$.id')=c.id) SELECT * FROM desired) d
    WHERE d.id=catalog_categories.id AND catalog_categories.sort_order IS NOT d.target;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM catalog_categories c WHERE (SELECT json_group_array(k) FROM (SELECT
    t.id AS k FROM catalog_categories t WHERE 1=1 ORDER BY t.sort_order,t.id)) IS NOT (SELECT
    json_group_array(k) FROM (SELECT json_extract(value,'$.id') AS k FROM json_each(NEW.payload,'$.categories')
    WHERE 1=1 ORDER BY json_extract(value,'$.position')))) THEN RAISE(ABORT, 'CATALOG_INCOMPLETE') END;
  UPDATE catalog_items SET sort_order = d.target FROM (WITH desired AS MATERIALIZED (SELECT c.id,c.category_id,
    CASE WHEN (SELECT json_group_array(k) FROM (SELECT t.id AS k FROM catalog_items t WHERE
    t.category_id=c.category_id ORDER BY t.sort_order,t.id)) = (SELECT json_group_array(k) FROM (SELECT
    json_extract(value,'$.id') AS k FROM json_each(NEW.payload,'$.items') WHERE
    json_extract(value,'$.categoryId')=c.category_id ORDER BY json_extract(value,'$.position'))) THEN
    c.sort_order ELSE json_extract(j.value, '$.position') END AS target FROM catalog_items c JOIN
    json_each(NEW.payload, '$.items') j ON json_extract(j.value, '$.id')=c.id AND json_extract(j.value,
    '$.categoryId')=c.category_id) SELECT * FROM desired) d WHERE d.id=catalog_items.id AND
    d.category_id=catalog_items.category_id AND catalog_items.sort_order IS NOT d.target;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM catalog_items c WHERE (SELECT json_group_array(k) FROM (SELECT t.id AS
    k FROM catalog_items t WHERE t.category_id=c.category_id ORDER BY t.sort_order,t.id)) IS NOT (SELECT
    json_group_array(k) FROM (SELECT json_extract(value,'$.id') AS k FROM json_each(NEW.payload,'$.items') WHERE
    json_extract(value,'$.categoryId')=c.category_id ORDER BY json_extract(value,'$.position')))) THEN
    RAISE(ABORT, 'CATALOG_INCOMPLETE') END;
  UPDATE catalog_variants SET sort_order = d.target FROM (WITH desired AS MATERIALIZED (SELECT c.code,c.item_id,
    CASE WHEN (SELECT json_group_array(k) FROM (SELECT t.code AS k FROM catalog_variants t WHERE
    t.item_id=c.item_id ORDER BY t.sort_order,t.code)) = (SELECT json_group_array(k) FROM (SELECT
    json_extract(value,'$.code') AS k FROM json_each(NEW.payload,'$.variants') WHERE
    json_extract(value,'$.itemId')=c.item_id ORDER BY json_extract(value,'$.position'))) THEN c.sort_order ELSE
    json_extract(j.value, '$.position') END AS target FROM catalog_variants c JOIN json_each(NEW.payload,
    '$.variants') j ON json_extract(j.value, '$.code')=c.code AND json_extract(j.value, '$.itemId')=c.item_id)
    SELECT * FROM desired) d WHERE d.code=catalog_variants.code AND d.item_id=catalog_variants.item_id AND
    catalog_variants.sort_order IS NOT d.target;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM catalog_variants c WHERE (SELECT json_group_array(k) FROM (SELECT
    t.code AS k FROM catalog_variants t WHERE t.item_id=c.item_id ORDER BY t.sort_order,t.code)) IS NOT (SELECT
    json_group_array(k) FROM (SELECT json_extract(value,'$.code') AS k FROM json_each(NEW.payload,'$.variants')
    WHERE json_extract(value,'$.itemId')=c.item_id ORDER BY json_extract(value,'$.position')))) THEN
    RAISE(ABORT, 'CATALOG_INCOMPLETE') END;
  SELECT CASE WHEN EXISTS (SELECT id,category_id,name,description,visible FROM catalog_items EXCEPT SELECT
    json_extract(j.value, '$.id'),json_extract(j.value, '$.categoryId'),json_extract(j.value,
    '$.name'),json_extract(j.value, '$.description'),json_extract(j.value, '$.visible') FROM
    json_each(NEW.payload, '$.items') j) OR EXISTS (SELECT json_extract(j.value, '$.id'),json_extract(j.value,
    '$.categoryId'),json_extract(j.value, '$.name'),json_extract(j.value, '$.description'),json_extract(j.value,
    '$.visible') FROM json_each(NEW.payload, '$.items') j EXCEPT SELECT id,category_id,name,description,visible
    FROM catalog_items) THEN RAISE(ABORT, 'CATALOG_INCOMPLETE') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.items') j WHERE json_extract(j.value,
    '$.isNew') = 1 AND NOT EXISTS (SELECT 1 FROM catalog_items WHERE catalog_items.id = json_extract(j.value,
    '$.id') AND creation_ref = json_extract(j.value, '$.creationRef'))) THEN RAISE(ABORT, 'CATALOG_INCOMPLETE')
    END;
  SELECT CASE WHEN EXISTS (SELECT item_id,code,label,volume_ml,price_cents FROM catalog_variants EXCEPT SELECT
    json_extract(j.value, '$.itemId'),json_extract(j.value, '$.code'),json_extract(j.value,
    '$.label'),json_extract(j.value, '$.volumeMl'),json_extract(j.value, '$.priceCents') FROM
    json_each(NEW.payload, '$.variants') j) OR EXISTS (SELECT json_extract(j.value,
    '$.itemId'),json_extract(j.value, '$.code'),json_extract(j.value, '$.label'),json_extract(j.value,
    '$.volumeMl'),json_extract(j.value, '$.priceCents') FROM json_each(NEW.payload, '$.variants') j EXCEPT
    SELECT item_id,code,label,volume_ml,price_cents FROM catalog_variants) THEN RAISE(ABORT,
    'CATALOG_INCOMPLETE') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.variants') j WHERE json_extract(j.value,
    '$.isNew') = 1 AND NOT EXISTS (SELECT 1 FROM catalog_variants WHERE catalog_variants.item_id =
    json_extract(j.value, '$.itemId') AND catalog_variants.code = json_extract(j.value, '$.code') AND
    creation_ref = json_extract(j.value, '$.creationRef'))) THEN RAISE(ABORT, 'CATALOG_INCOMPLETE') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM catalog_items i WHERE NOT EXISTS (SELECT 1 FROM catalog_variants v
    WHERE v.item_id=i.id) OR (i.visible=1 AND NOT EXISTS (SELECT 1 FROM catalog_variants v WHERE v.item_id=i.id
    AND v.price_cents IS NOT NULL))) OR EXISTS (SELECT 1 FROM catalog_variants v JOIN catalog_items i ON
    i.id=v.item_id WHERE (i.category_id IN ('chopes','cachacas') AND v.volume_ml IS NULL) OR
    (i.category_id='cachacas' AND v.price_cents IS NULL) OR (i.category_id='chopes' AND ((v.code='30' AND
    v.volume_ml IS NOT 30000) OR (v.code='50' AND v.volume_ml IS NOT 50000)))) THEN RAISE(ABORT, 'CATALOG_RULE')
    END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE
    s.token_hash=NEW.session_hash AND u.id=NEW.user_id AND u.active=1 AND s.auth_version=u.auth_version AND
    s.origin=NEW.origin AND s.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)) THEN RAISE(ABORT,
    'CATALOG_UNAUTHORIZED') END;
  -- OLD.baseline is captured before any trigger mutates rows.
  -- Skipping a revision trigger must not leave a changed ETag valid.
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM catalog_ready)
    OR (SELECT revision FROM catalog_meta WHERE singleton=1) < OLD.revision
    OR (OLD.baseline IS NOT (SELECT payload FROM catalog_state)
      AND (SELECT revision FROM catalog_meta WHERE singleton=1) <= OLD.revision)
    THEN RAISE(ABORT, 'CATALOG_META_UNAVAILABLE') END;
END;
