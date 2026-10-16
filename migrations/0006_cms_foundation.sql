-- Additive CMS foundation. No published content, media objects or catalog writes.
CREATE TABLE cms_versions (
  version_id TEXT PRIMARY KEY NOT NULL CHECK (length(version_id) = 44 AND substr(version_id,1,8) = 'version_'),
  kind TEXT NOT NULL CHECK (kind IN ('draft','published')),
  operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) = 36),
  expected_revision TEXT NOT NULL CHECK (length(expected_revision) = 39 AND substr(expected_revision,1,3) = 'c1_'),
  resulting_revision TEXT NOT NULL UNIQUE CHECK (length(resulting_revision) = 39 AND substr(resulting_revision,1,3) = 'c1_' AND resulting_revision <> expected_revision),
  document_json TEXT NOT NULL CHECK (json_valid(document_json) AND json_type(document_json) = 'object'
    AND json_extract(document_json,'$.schemaVersion') IS 1 AND length(CAST(document_json AS BLOB)) <= 65536),
  command_hash TEXT NOT NULL CHECK (length(command_hash) = 64 AND command_hash NOT GLOB '*[^0-9a-f]*'),
  actor_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK (created_at > 0)
) STRICT;
CREATE INDEX cms_versions_created ON cms_versions(created_at,version_id);

CREATE TABLE cms_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  draft_version_id TEXT REFERENCES cms_versions(version_id) ON DELETE RESTRICT,
  draft_revision TEXT NOT NULL CHECK (length(draft_revision) = 39 AND substr(draft_revision,1,3) = 'c1_'),
  published_version_id TEXT REFERENCES cms_versions(version_id) ON DELETE RESTRICT,
  published_revision TEXT,
  CHECK ((published_version_id IS NULL) = (published_revision IS NULL))
) STRICT;
-- Metadata only: an empty CMS has a concurrency token, but NO document/commercial seed.
INSERT INTO cms_state VALUES (1,NULL,
  'c1_' || lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))),NULL,NULL);

CREATE TABLE cms_media (
  media_id TEXT PRIMARY KEY NOT NULL CHECK (length(media_id) = 42 AND substr(media_id,1,6) = 'media_'),
  state TEXT NOT NULL CHECK (state IN ('quarantined','processing','ready','rejected','deleting','deleted')),
  quarantine_key TEXT UNIQUE,
  derivatives_json TEXT CHECK (derivatives_json IS NULL OR (json_valid(derivatives_json) AND json_type(derivatives_json) = 'object')),
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  lease_token TEXT,
  lease_expires_at INTEGER,
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK (state <> 'ready' OR derivatives_json IS NOT NULL)
) STRICT;
CREATE INDEX cms_media_recovery ON cms_media(state,lease_expires_at,created_at);
CREATE TABLE cms_media_refs (
  version_id TEXT NOT NULL REFERENCES cms_versions(version_id) ON DELETE RESTRICT,
  media_id TEXT NOT NULL REFERENCES cms_media(media_id) ON DELETE RESTRICT,
  PRIMARY KEY (version_id,media_id)
) STRICT;
CREATE INDEX cms_media_refs_reverse ON cms_media_refs(media_id,version_id);

CREATE VIEW cms_draft_write AS SELECT singleton, NULL AS version_id, NULL AS operation_id,
  NULL AS expected_revision, NULL AS resulting_revision, NULL AS document_json,
  NULL AS command_hash, NULL AS actor_id, NULL AS session_hash, NULL AS origin FROM cms_state;
CREATE VIEW cms_ready AS SELECT 1 WHERE
  EXISTS (SELECT 1 FROM d1_migrations WHERE name = '0006_cms_foundation.sql')
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name IN ('cms_state','cms_versions','cms_media','cms_media_refs')) = 4
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND name IN (
    'cms_draft_write_command','cms_versions_immutable_update','cms_versions_immutable_delete',
    'cms_versions_draft_only','cms_state_guard','cms_state_no_delete',
    'cms_refs_immutable_update','cms_refs_immutable_delete','cms_media_referenced_guard')) = 9;

CREATE TRIGGER cms_versions_immutable_update BEFORE UPDATE ON cms_versions
BEGIN SELECT RAISE(ABORT,'CMS_VERSION_IMMUTABLE'); END;
CREATE TRIGGER cms_versions_immutable_delete BEFORE DELETE ON cms_versions
BEGIN SELECT RAISE(ABORT,'CMS_VERSION_IMMUTABLE'); END;
CREATE TRIGGER cms_versions_draft_only BEFORE INSERT ON cms_versions
BEGIN SELECT CASE WHEN NEW.kind <> 'draft' THEN RAISE(ABORT,'CMS_PUBLICATION_DISABLED') END; END;
CREATE TRIGGER cms_state_guard BEFORE UPDATE ON cms_state
BEGIN
  SELECT CASE WHEN NEW.singleton <> OLD.singleton OR NEW.published_version_id IS NOT NULL OR NEW.published_revision IS NOT NULL
    THEN RAISE(ABORT,'CMS_PUBLICATION_DISABLED') END;
  SELECT CASE WHEN NEW.draft_version_id IS NULL OR NOT EXISTS (SELECT 1 FROM cms_versions v
    WHERE v.version_id = NEW.draft_version_id AND v.kind = 'draft' AND v.resulting_revision = NEW.draft_revision
    AND v.expected_revision = OLD.draft_revision) THEN RAISE(ABORT,'CMS_STATE_INVALID') END;
END;
CREATE TRIGGER cms_state_no_delete BEFORE DELETE ON cms_state
BEGIN SELECT RAISE(ABORT,'CMS_STATE_REQUIRED'); END;
CREATE TRIGGER cms_refs_immutable_update BEFORE UPDATE ON cms_media_refs
BEGIN SELECT RAISE(ABORT,'CMS_REFS_IMMUTABLE'); END;
CREATE TRIGGER cms_refs_immutable_delete BEFORE DELETE ON cms_media_refs
BEGIN SELECT RAISE(ABORT,'CMS_REFS_IMMUTABLE'); END;
CREATE TRIGGER cms_media_referenced_guard BEFORE UPDATE ON cms_media
WHEN EXISTS (SELECT 1 FROM cms_media_refs WHERE media_id = OLD.media_id)
BEGIN
  SELECT CASE WHEN NEW.media_id IS NOT OLD.media_id OR NEW.state IN ('deleting','deleted')
    OR (OLD.state = 'ready' AND (NEW.state IS NOT OLD.state OR NEW.derivatives_json IS NOT OLD.derivatives_json))
    THEN RAISE(ABORT,'CMS_MEDIA_REFERENCED') END;
END;

CREATE TRIGGER cms_draft_write_command INSTEAD OF UPDATE ON cms_draft_write
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cms_ready) THEN RAISE(ABORT,'CMS_SCHEMA_UNAVAILABLE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = NEW.session_hash AND u.id = NEW.actor_id AND u.active = 1
    AND s.auth_version = u.auth_version AND s.origin = NEW.origin
    AND s.expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)) THEN RAISE(ABORT,'CMS_UNAUTHORIZED') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM cms_versions WHERE operation_id = NEW.operation_id
    AND (actor_id IS NOT NEW.actor_id OR command_hash IS NOT NEW.command_hash)) THEN RAISE(ABORT,'CMS_OPERATION_CONFLICT') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cms_versions WHERE operation_id = NEW.operation_id)
    AND NOT EXISTS (SELECT 1 FROM cms_state WHERE singleton = 1 AND draft_revision = NEW.expected_revision)
    THEN RAISE(ABORT,'CMS_REVISION_CONFLICT') END;
  INSERT INTO cms_versions(version_id,kind,operation_id,expected_revision,resulting_revision,document_json,command_hash,actor_id,created_at)
    SELECT NEW.version_id,'draft',NEW.operation_id,NEW.expected_revision,NEW.resulting_revision,NEW.document_json,NEW.command_hash,NEW.actor_id,
      CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE NOT EXISTS (SELECT 1 FROM cms_versions WHERE operation_id = NEW.operation_id);
  INSERT INTO cms_media_refs(version_id,media_id)
    SELECT DISTINCT v.version_id,json_extract(m.value,'$.content.media.id') FROM cms_versions v,json_each(v.document_json,'$.modules') m
    WHERE v.operation_id = NEW.operation_id AND v.version_id = NEW.version_id
    AND json_extract(m.value,'$.content.media.id') IS NOT NULL;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM cms_media_refs r JOIN cms_media m USING(media_id)
    WHERE r.version_id = NEW.version_id AND m.state IN ('deleting','deleted')) THEN RAISE(ABORT,'CMS_MEDIA_UNAVAILABLE') END;
  UPDATE cms_state SET draft_version_id = NEW.version_id,draft_revision = NEW.resulting_revision
    WHERE singleton = 1 AND draft_revision = NEW.expected_revision
    AND EXISTS (SELECT 1 FROM cms_versions WHERE operation_id = NEW.operation_id AND version_id = NEW.version_id);
  -- Verify actual effects; RAISE(IGNORE) or another trigger must not produce a partial success.
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cms_versions WHERE operation_id = NEW.operation_id
    AND command_hash = NEW.command_hash AND actor_id = NEW.actor_id) THEN RAISE(ABORT,'CMS_WRITE_INCOMPLETE') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM cms_versions WHERE operation_id = NEW.operation_id AND version_id = NEW.version_id)
    AND (NOT EXISTS (SELECT 1 FROM cms_state WHERE singleton = 1 AND draft_version_id = NEW.version_id AND draft_revision = NEW.resulting_revision
      AND published_version_id IS NULL AND published_revision IS NULL)
      OR NOT EXISTS (SELECT 1 FROM cms_versions WHERE version_id = NEW.version_id AND document_json = NEW.document_json
        AND resulting_revision = NEW.resulting_revision AND expected_revision = NEW.expected_revision AND kind = 'draft')
      OR EXISTS (SELECT json_extract(value,'$.content.media.id') FROM json_each(NEW.document_json,'$.modules')
        WHERE json_extract(value,'$.content.media.id') IS NOT NULL EXCEPT SELECT media_id FROM cms_media_refs WHERE version_id = NEW.version_id)
      OR EXISTS (SELECT media_id FROM cms_media_refs WHERE version_id = NEW.version_id EXCEPT SELECT json_extract(value,'$.content.media.id')
        FROM json_each(NEW.document_json,'$.modules') WHERE json_extract(value,'$.content.media.id') IS NOT NULL))
    THEN RAISE(ABORT,'CMS_WRITE_INCOMPLETE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
    WHERE s.token_hash = NEW.session_hash AND u.id = NEW.actor_id AND u.active = 1
    AND s.auth_version = u.auth_version AND s.origin = NEW.origin
    AND s.expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)) THEN RAISE(ABORT,'CMS_UNAUTHORIZED') END;
END;
