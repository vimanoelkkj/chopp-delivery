-- F4A.6.4C: imagem principal por produto. Aditiva: não altera tabelas, views nem gatilhos existentes,
-- exceto por um gatilho NOVO em cms_media que protege a mídia associada.
--
-- Uma linha por produto que já teve imagem. Remover a imagem NÃO apaga a linha: media_id e alt ficam
-- nulos e a revisão continua crescendo, então um token antigo nunca volta a valer (sem ABA).
CREATE TABLE catalog_item_media (
  item_id TEXT PRIMARY KEY NOT NULL REFERENCES catalog_items(id) ON DELETE RESTRICT,
  media_id TEXT REFERENCES cms_media(media_id) ON DELETE RESTRICT,
  alt TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK ((media_id IS NULL) = (alt IS NULL)),
  CHECK (alt IS NULL OR length(trim(alt)) BETWEEN 1 AND 200)
) STRICT;
CREATE INDEX catalog_item_media_reverse ON catalog_item_media(media_id) WHERE media_id IS NOT NULL;

-- Comando único de escrita: o WHERE do UPDATE carrega o item e a revisão esperada; o D1 reavalia a
-- sessão do administrador dentro do gatilho. Item sem associação tem revisão 0.
CREATE VIEW catalog_media_write AS
SELECT i.id AS item_id, COALESCE(m.revision, 0) AS revision, NULL AS media_id, NULL AS alt,
  NULL AS session_hash, NULL AS user_id, NULL AS origin
FROM catalog_items i LEFT JOIN catalog_item_media m ON m.item_id = i.id;

CREATE TRIGGER catalog_item_media_no_delete BEFORE DELETE ON catalog_item_media
BEGIN SELECT RAISE(ABORT, 'CATALOG_MEDIA_IMMUTABLE'); END;

CREATE TRIGGER catalog_item_media_revision_guard BEFORE UPDATE ON catalog_item_media
WHEN NEW.item_id IS NOT OLD.item_id OR NEW.revision IS NOT OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'CATALOG_MEDIA_REVISION'); END;

CREATE TRIGGER catalog_item_media_ready_insert BEFORE INSERT ON catalog_item_media
WHEN NEW.media_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM cms_media WHERE media_id = NEW.media_id AND state = 'ready' AND derivatives_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'CATALOG_MEDIA_NOT_READY'); END;

CREATE TRIGGER catalog_item_media_ready_update BEFORE UPDATE ON catalog_item_media
WHEN NEW.media_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM cms_media WHERE media_id = NEW.media_id AND state = 'ready' AND derivatives_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'CATALOG_MEDIA_NOT_READY'); END;

-- Mesma proteção das referências editoriais: mídia associada a um produto não muda de identidade, não
-- é excluída e, estando pronta, não muda de estado nem de derivados. Soltar a associação libera.
CREATE TRIGGER cms_media_catalog_referenced_guard BEFORE UPDATE ON cms_media
WHEN EXISTS (SELECT 1 FROM catalog_item_media WHERE media_id = OLD.media_id)
BEGIN
  SELECT CASE WHEN NEW.media_id IS NOT OLD.media_id OR NEW.state IN ('deleting', 'deleted')
    OR (OLD.state = 'ready' AND (NEW.state IS NOT OLD.state OR NEW.derivatives_json IS NOT OLD.derivatives_json))
    THEN RAISE(ABORT, 'CMS_MEDIA_REFERENCED') END;
END;

CREATE TRIGGER catalog_media_write_command INSTEAD OF UPDATE ON catalog_media_write
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id WHERE
    s.token_hash = NEW.session_hash AND u.id = NEW.user_id AND u.active = 1 AND s.auth_version = u.auth_version AND
    s.origin = NEW.origin AND s.expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER))
    THEN RAISE(ABORT, 'CATALOG_UNAUTHORIZED') END;
  UPDATE catalog_item_media SET media_id = NEW.media_id, alt = NEW.alt, revision = OLD.revision + 1,
    updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE item_id = OLD.item_id;
  INSERT INTO catalog_item_media (item_id, media_id, alt, revision, updated_at)
    SELECT OLD.item_id, NEW.media_id, NEW.alt, OLD.revision + 1, CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE NOT EXISTS (SELECT 1 FROM catalog_item_media WHERE item_id = OLD.item_id);
END;
