-- 0014: recompila o gatilho INSTEAD OF de catalog_write no Cloudflare D1.
--
-- Defeito: no D1 remoto, "EXPLAIN UPDATE catalog_write" falhava com SQLITE_ERROR 7500 ("VIEWs and/or
-- subqueries nested too deep"), porque a soma de complexidade do programa do gatilho da 0005 passava do
-- limite do D1. Os culpados são os três "UPDATE ... SET sort_order = d.target FROM (WITH desired AS
-- MATERIALIZED (...))", que o SQLite reescreve em subconsultas aninhadas dentro do programa do gatilho.
-- Bisseção em D1 real: o prefixo de 14 statements compila; com o 15º (reordenação de categorias) falha;
-- repetido 8x isolado também falha.
--
-- Correção: os três statements de reordenação viram UPDATE simples com subconsulta escalar, com a MESMA
-- semântica (a posição só é regravada quando a ordem relativa mudou e o valor difere). A comparação de
-- ordem é avaliada na primeira passada do UPDATE (há gatilhos AFTER UPDATE, então o SQLite não usa passada
-- única). Os índices de ordenação não são UNIQUE, logo regravar posições em sequência é seguro.
-- Todos os demais statements, regras (CATALOG_IDENTITY, CATALOG_INCOMPLETE, CATALOG_RULE,
-- CATALOG_UNAUTHORIZED, CATALOG_META_UNAVAILABLE), ordem e nomes de objetos permanecem idênticos aos da 0005
-- (catalog_ready e o preflight conferem o nome catalog_write_command). Aditiva: não toca em dados nem tabelas.
DROP TRIGGER catalog_write_command;
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
  UPDATE catalog_categories SET sort_order = (SELECT json_extract(j.value, '$.position') FROM
    json_each(NEW.payload, '$.categories') j WHERE json_extract(j.value, '$.id') = catalog_categories.id)
    WHERE EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.categories') j WHERE json_extract(j.value, '$.id') =
    catalog_categories.id AND catalog_categories.sort_order IS NOT json_extract(j.value, '$.position'))
    AND (SELECT json_group_array(k) FROM (SELECT t.id AS k FROM catalog_categories t ORDER BY
    t.sort_order, t.id)) IS NOT (SELECT json_group_array(k) FROM (SELECT json_extract(value, '$.id') AS k
    FROM json_each(NEW.payload, '$.categories') ORDER BY json_extract(value, '$.position')));
  SELECT CASE WHEN EXISTS (SELECT 1 FROM catalog_categories c WHERE (SELECT json_group_array(k) FROM (SELECT
    t.id AS k FROM catalog_categories t WHERE 1=1 ORDER BY t.sort_order,t.id)) IS NOT (SELECT
    json_group_array(k) FROM (SELECT json_extract(value,'$.id') AS k FROM json_each(NEW.payload,'$.categories')
    WHERE 1=1 ORDER BY json_extract(value,'$.position')))) THEN RAISE(ABORT, 'CATALOG_INCOMPLETE') END;
  UPDATE catalog_items SET sort_order = (SELECT json_extract(j.value, '$.position') FROM
    json_each(NEW.payload, '$.items') j WHERE json_extract(j.value, '$.id') = catalog_items.id AND
    json_extract(j.value, '$.categoryId') = catalog_items.category_id)
    WHERE EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.items') j WHERE json_extract(j.value, '$.id') =
    catalog_items.id AND json_extract(j.value, '$.categoryId') = catalog_items.category_id AND
    catalog_items.sort_order IS NOT json_extract(j.value, '$.position'))
    AND (SELECT json_group_array(k) FROM (SELECT t.id AS k FROM catalog_items t WHERE
    t.category_id = catalog_items.category_id ORDER BY t.sort_order, t.id)) IS NOT (SELECT
    json_group_array(k) FROM (SELECT json_extract(value, '$.id') AS k FROM json_each(NEW.payload, '$.items')
    WHERE json_extract(value, '$.categoryId') = catalog_items.category_id ORDER BY
    json_extract(value, '$.position')));
  SELECT CASE WHEN EXISTS (SELECT 1 FROM catalog_items c WHERE (SELECT json_group_array(k) FROM (SELECT t.id AS
    k FROM catalog_items t WHERE t.category_id=c.category_id ORDER BY t.sort_order,t.id)) IS NOT (SELECT
    json_group_array(k) FROM (SELECT json_extract(value,'$.id') AS k FROM json_each(NEW.payload,'$.items') WHERE
    json_extract(value,'$.categoryId')=c.category_id ORDER BY json_extract(value,'$.position')))) THEN
    RAISE(ABORT, 'CATALOG_INCOMPLETE') END;
  UPDATE catalog_variants SET sort_order = (SELECT json_extract(j.value, '$.position') FROM
    json_each(NEW.payload, '$.variants') j WHERE json_extract(j.value, '$.itemId') = catalog_variants.item_id
    AND json_extract(j.value, '$.code') = catalog_variants.code)
    WHERE EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.variants') j WHERE json_extract(j.value, '$.itemId') =
    catalog_variants.item_id AND json_extract(j.value, '$.code') = catalog_variants.code AND
    catalog_variants.sort_order IS NOT json_extract(j.value, '$.position'))
    AND (SELECT json_group_array(k) FROM (SELECT t.code AS k FROM catalog_variants t WHERE
    t.item_id = catalog_variants.item_id ORDER BY t.sort_order, t.code)) IS NOT (SELECT json_group_array(k)
    FROM (SELECT json_extract(value, '$.code') AS k FROM json_each(NEW.payload, '$.variants') WHERE
    json_extract(value, '$.itemId') = catalog_variants.item_id ORDER BY json_extract(value, '$.position')));
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
