-- Additive CMS v2 structure only. Publication and public consumption remain disabled.
-- Stage 1: tables and indexes. No v2 state row is seeded.
CREATE TABLE cms_v2_versions (
 version_id TEXT PRIMARY KEY NOT NULL CHECK(length(version_id)=44 AND substr(version_id,1,8)='version_'),
 kind TEXT NOT NULL CHECK(kind IN ('draft','published')),
 operation_id TEXT NOT NULL UNIQUE CHECK(length(operation_id)=36),
 expected_revision TEXT NOT NULL CHECK(length(expected_revision)=39 AND substr(expected_revision,1,3) IN ('c1_','c2_')),
 resulting_revision TEXT NOT NULL UNIQUE CHECK(length(resulting_revision)=39 AND substr(resulting_revision,1,3)='c2_' AND resulting_revision<>expected_revision),
 document_json TEXT NOT NULL CHECK(json_valid(document_json) AND json_type(document_json)='object' AND json_extract(document_json,'$.schemaVersion') IS 2 AND json_type(document_json,'$.schemaVersion')='integer' AND length(CAST(document_json AS BLOB))<=65536),
 command_hash TEXT NOT NULL CHECK(length(command_hash)=64 AND command_hash NOT GLOB '*[^0-9a-f]*'),
 actor_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE RESTRICT,
 created_at INTEGER NOT NULL CHECK(created_at>0),
 origin_kind TEXT NOT NULL CHECK(origin_kind IN ('save','convert','start')),
 source_version_id TEXT REFERENCES cms_versions(version_id) ON DELETE RESTRICT,
 CHECK((origin_kind='convert')=(source_version_id IS NOT NULL))
) STRICT;

CREATE INDEX cms_v2_versions_created ON cms_v2_versions(created_at,version_id);

CREATE TABLE cms_v2_state (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 draft_version_id TEXT NOT NULL REFERENCES cms_v2_versions(version_id) ON DELETE RESTRICT,
 draft_revision TEXT NOT NULL CHECK(length(draft_revision)=39 AND substr(draft_revision,1,3)='c2_'),
 published_version_id TEXT REFERENCES cms_v2_versions(version_id) ON DELETE RESTRICT,
 published_revision TEXT,
 CHECK((published_version_id IS NULL)=(published_revision IS NULL))
) STRICT;

CREATE TABLE cms_v2_media_refs (
 version_id TEXT NOT NULL REFERENCES cms_v2_versions(version_id) ON DELETE RESTRICT,
 media_id TEXT NOT NULL REFERENCES cms_media(media_id) ON DELETE RESTRICT,
 PRIMARY KEY(version_id,media_id)
) STRICT;

CREATE INDEX cms_v2_refs_reverse ON cms_v2_media_refs(media_id,version_id);

-- Ephemeral command fence: rows exist only inside the authorized write statement.
CREATE TABLE cms_v2_write_guard (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),version_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,session_hash TEXT NOT NULL,origin TEXT NOT NULL
) STRICT;

-- Stage 2: local guards. Their dependencies already exist; readiness is checked only on writes.

CREATE TRIGGER cms_v2_guard_authorize BEFORE INSERT ON cms_v2_write_guard
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_ready_v2) THEN RAISE(ABORT,'CMS_SCHEMA_UNAVAILABLE') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=NEW.session_hash AND u.id=NEW.actor_id AND u.active=1 AND s.auth_version=u.auth_version AND s.origin=NEW.origin AND s.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)) THEN RAISE(ABORT,'CMS_UNAUTHORIZED') END;
END;

CREATE TRIGGER cms_v2_versions_immutable_update BEFORE UPDATE ON cms_v2_versions
BEGIN
  SELECT RAISE(ABORT,'CMS_VERSION_IMMUTABLE');
END;

CREATE TRIGGER cms_v2_versions_immutable_delete BEFORE DELETE ON cms_v2_versions
BEGIN
  SELECT RAISE(ABORT,'CMS_VERSION_IMMUTABLE');
END;

CREATE TRIGGER cms_v2_media_refs_immutable_update BEFORE UPDATE ON cms_v2_media_refs
BEGIN
  SELECT RAISE(ABORT,'CMS_REFS_IMMUTABLE');
END;

CREATE TRIGGER cms_v2_media_refs_immutable_delete BEFORE DELETE ON cms_v2_media_refs
BEGIN
  SELECT RAISE(ABORT,'CMS_REFS_IMMUTABLE');
END;

CREATE TRIGGER cms_v2_state_no_delete BEFORE DELETE ON cms_v2_state
BEGIN
  SELECT RAISE(ABORT,'CMS_STATE_REQUIRED');
END;

CREATE TRIGGER cms_v2_versions_insert_guard BEFORE INSERT ON cms_v2_versions
BEGIN
  SELECT CASE WHEN NEW.kind<>'draft' THEN RAISE(ABORT,'CMS_PUBLICATION_DISABLED') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM cms_versions WHERE operation_id=NEW.operation_id) THEN RAISE(ABORT,'CMS_OPERATION_CONFLICT') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_v2_write_guard g WHERE g.version_id=NEW.version_id AND g.operation_id=NEW.operation_id AND g.actor_id=NEW.actor_id) THEN RAISE(ABORT,'CMS_WRITE_REQUIRED') END;
  SELECT CASE WHEN json_type(NEW.document_json,'$.modules') IS NOT 'array' OR json_array_length(NEW.document_json,'$.modules') NOT BETWEEN 3 AND 11 OR (SELECT count(*) FROM json_each(NEW.document_json))<>3 OR EXISTS(SELECT 1 FROM json_each(NEW.document_json) WHERE key NOT IN ('schemaVersion','commercial','modules')) OR json_type(NEW.document_json,'$.commercial') IS NOT 'object' OR (SELECT count(*) FROM json_each(NEW.document_json,'$.commercial'))<>2 OR json_extract(NEW.document_json,'$.commercial.fulfillmentMode') IS NOT 'delivery' OR EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.commercial') WHERE key NOT IN ('fulfillmentMode','whatsappNumber')) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN json_extract(NEW.document_json,'$.modules[0].template') IS NOT 'hero' OR json_extract(NEW.document_json,'$.modules[#-1].template') IS NOT 'contact' OR EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') GROUP BY json_extract(value,'$.id') HAVING count(*)>1) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN (SELECT count(*) FROM json_each(NEW.document_json,'$.modules') WHERE json_extract(value,'$.template')='hero')<>1 THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN (SELECT count(*) FROM json_each(NEW.document_json,'$.modules') WHERE json_extract(value,'$.template')='catalog')<>1 THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN (SELECT count(*) FROM json_each(NEW.document_json,'$.modules') WHERE json_extract(value,'$.template')='contact')<>1 THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') GROUP BY json_extract(value,'$.template') HAVING count(*)>CASE json_extract(value,'$.template') WHEN 'highlight' THEN 3 ELSE 1 END) OR (SELECT count(*) FROM json_each(NEW.document_json,'$.modules') WHERE json_extract(value,'$.template') IN ('how','about','highlight','faq'))>6 THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') a,json_each(NEW.document_json,'$.modules') b WHERE a.key<b.key AND CASE json_extract(a.value,'$.template') WHEN 'hero' THEN 0 WHEN 'carousel' THEN 1 WHEN 'ticker' THEN 2 WHEN 'catalog' THEN 3 WHEN 'how' THEN 4 WHEN 'about' THEN 4 WHEN 'highlight' THEN 4 WHEN 'faq' THEN 4 WHEN 'contact' THEN 5 ELSE -1 END>CASE json_extract(b.value,'$.template') WHEN 'hero' THEN 0 WHEN 'carousel' THEN 1 WHEN 'ticker' THEN 2 WHEN 'catalog' THEN 3 WHEN 'how' THEN 4 WHEN 'about' THEN 4 WHEN 'highlight' THEN 4 WHEN 'faq' THEN 4 WHEN 'contact' THEN 5 ELSE -1 END) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE m.type<>'object' OR (SELECT count(*) FROM json_each(m.value))<>5 OR EXISTS(SELECT 1 FROM json_each(m.value) WHERE key NOT IN ('id','template','visible','navigation','content')) OR json_extract(m.value,'$.template') NOT IN ('hero','carousel','ticker','catalog','how','about','highlight','faq','contact') OR json_type(m.value,'$.visible') NOT IN ('true','false') OR json_type(m.value,'$.id') IS NOT 'text' OR json_type(m.value,'$.content') IS NOT 'object' OR (json_extract(m.value,'$.template') IN ('hero','catalog','contact') AND (json_extract(m.value,'$.id') IS NOT json_extract(m.value,'$.template') OR json_extract(m.value,'$.visible')<>1))) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.template')='hero' AND ((SELECT count(*) FROM json_each(m.value,'$.content'))<>3 OR EXISTS(SELECT 1 FROM json_each(m.value,'$.content') WHERE key NOT IN ('heading','summary','media')))) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.template')='carousel' AND ((SELECT count(*) FROM json_each(m.value,'$.content'))<>4 OR EXISTS(SELECT 1 FROM json_each(m.value,'$.content') WHERE key NOT IN ('heading','lead','media','entries')))) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.template')='catalog' AND ((SELECT count(*) FROM json_each(m.value,'$.content'))<>2 OR EXISTS(SELECT 1 FROM json_each(m.value,'$.content') WHERE key NOT IN ('heading','intro')))) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.template')='contact' AND ((SELECT count(*) FROM json_each(m.value,'$.content'))<>2 OR EXISTS(SELECT 1 FROM json_each(m.value,'$.content') WHERE key NOT IN ('heading','body')))) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.template')='about' AND ((SELECT count(*) FROM json_each(m.value,'$.content'))<>3 OR EXISTS(SELECT 1 FROM json_each(m.value,'$.content') WHERE key NOT IN ('heading','body','media')))) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.template')='highlight' AND ((SELECT count(*) FROM json_each(m.value,'$.content'))<>3 OR EXISTS(SELECT 1 FROM json_each(m.value,'$.content') WHERE key NOT IN ('heading','body','media')))) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.template')='ticker' AND ((SELECT count(*) FROM json_each(m.value,'$.content'))<>1 OR EXISTS(SELECT 1 FROM json_each(m.value,'$.content') WHERE key NOT IN ('items')))) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.template')='how' AND ((SELECT count(*) FROM json_each(m.value,'$.content'))<>2 OR EXISTS(SELECT 1 FROM json_each(m.value,'$.content') WHERE key NOT IN ('heading','steps')))) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.template')='faq' AND ((SELECT count(*) FROM json_each(m.value,'$.content'))<>2 OR EXISTS(SELECT 1 FROM json_each(m.value,'$.content') WHERE key NOT IN ('heading','items')))) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.template')='carousel' AND (json_type(m.value,'$.content.entries') IS NOT 'array' OR json_array_length(m.value,'$.content.entries')>12 OR EXISTS(SELECT 1 FROM json_each(m.value,'$.content.entries') GROUP BY json_extract(value,'$.itemId') HAVING count(*)>1))) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m,json_each(m.value,'$.content.entries') e WHERE e.type<>'object' OR (SELECT count(*) FROM json_each(e.value))<>2 OR EXISTS(SELECT 1 FROM json_each(e.value) WHERE key NOT IN ('itemId','media')) OR json_type(e.value,'$.itemId') IS NOT 'text' OR length(json_extract(e.value,'$.itemId')) NOT BETWEEN 1 AND 128 OR json_extract(e.value,'$.itemId') NOT GLOB '[A-Za-z0-9]*' OR json_extract(e.value,'$.itemId') GLOB '*[^A-Za-z0-9_-]*') THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m,json_each(m.value,'$.content.entries') e WHERE NOT EXISTS(SELECT 1 FROM catalog_items i WHERE i.id=json_extract(e.value,'$.itemId') AND i.category_id='chopes')) THEN RAISE(ABORT,'CMS_INVALID_ITEM') END;
  SELECT CASE WHEN EXISTS(SELECT t.atom FROM json_tree(NEW.document_json) t JOIN json_tree(NEW.document_json) p ON p.id=t.parent WHERE p.key='media' AND t.key='id' AND t.type='text' EXCEPT SELECT media_id FROM (SELECT json_extract(m.value,'$.content.media.id') AS media_id FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.content.media.id') IS NOT NULL UNION SELECT json_extract(e.value,'$.media.id') FROM json_each(NEW.document_json,'$.modules') m,json_each(m.value,'$.content.entries') e WHERE json_extract(e.value,'$.media.id') IS NOT NULL)) OR EXISTS(SELECT media_id FROM (SELECT json_extract(m.value,'$.content.media.id') AS media_id FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.content.media.id') IS NOT NULL UNION SELECT json_extract(e.value,'$.media.id') FROM json_each(NEW.document_json,'$.modules') m,json_each(m.value,'$.content.entries') e WHERE json_extract(e.value,'$.media.id') IS NOT NULL) EXCEPT SELECT t.atom FROM json_tree(NEW.document_json) t JOIN json_tree(NEW.document_json) p ON p.id=t.parent WHERE p.key='media' AND t.key='id' AND t.type='text') THEN RAISE(ABORT,'CMS_WRITE_INCOMPLETE') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT t.atom AS media_id FROM json_tree(NEW.document_json) t JOIN json_tree(NEW.document_json) p ON p.id=t.parent WHERE p.key='media' AND t.key='id' AND t.type='text') r WHERE NOT EXISTS(SELECT 1 FROM cms_media m WHERE m.media_id=r.media_id AND m.state NOT IN ('deleting','deleted'))) THEN RAISE(ABORT,'CMS_MEDIA_UNAVAILABLE') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.template') NOT IN ('hero','catalog','contact') AND (substr(json_extract(m.value,'$.id'),1,7) IS NOT 'module_' OR length(substr(json_extract(m.value,'$.id'),8)) IS NOT 36 OR substr(substr(json_extract(m.value,'$.id'),8),9,1) IS NOT '-' OR substr(substr(json_extract(m.value,'$.id'),8),15,1) IS NOT '4' OR substr(substr(json_extract(m.value,'$.id'),8),20,1) NOT IN ('8','9','a','b') OR substr(substr(json_extract(m.value,'$.id'),8),15,1) IS NOT '4' OR substr(substr(json_extract(m.value,'$.id'),8),14,1) IS NOT '-' OR substr(substr(json_extract(m.value,'$.id'),8),19,1) IS NOT '-' OR substr(substr(json_extract(m.value,'$.id'),8),24,1) IS NOT '-' OR length(replace(substr(json_extract(m.value,'$.id'),8),'-',''))<>32 OR replace(substr(json_extract(m.value,'$.id'),8),'-','') GLOB '*[^0-9a-f]*')) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') m WHERE json_type(m.value,'$.navigation') IS NOT 'text' OR json_extract(m.value,'$.navigation') NOT IN ('none',CASE json_extract(m.value,'$.template') WHEN 'carousel' THEN 'primary' WHEN 'catalog' THEN 'primary' WHEN 'how' THEN 'primary' WHEN 'faq' THEN 'primary' WHEN 'contact' THEN 'cta' ELSE 'none' END) OR (json_extract(m.value,'$.template') IN ('hero','catalog','contact') AND json_extract(m.value,'$.navigation') IS NOT CASE json_extract(m.value,'$.template') WHEN 'catalog' THEN 'primary' WHEN 'contact' THEN 'cta' ELSE 'none' END)) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM json_tree(NEW.document_json) t WHERE t.key='media' AND t.type<>'null' AND (t.type<>'object' OR (SELECT count(*) FROM json_each(t.value))<>2 OR EXISTS(SELECT 1 FROM json_each(t.value) WHERE key NOT IN ('id','alt')) OR json_type(t.value,'$.id') IS NOT 'text' OR substr(json_extract(t.value,'$.id'),1,6) IS NOT 'media_' OR length(substr(json_extract(t.value,'$.id'),7)) IS NOT 36 OR substr(substr(json_extract(t.value,'$.id'),7),9,1) IS NOT '-' OR substr(substr(json_extract(t.value,'$.id'),7),15,1) IS NOT '4' OR substr(substr(json_extract(t.value,'$.id'),7),20,1) NOT IN ('8','9','a','b') OR substr(substr(json_extract(t.value,'$.id'),7),15,1) IS NOT '4' OR substr(substr(json_extract(t.value,'$.id'),7),14,1) IS NOT '-' OR substr(substr(json_extract(t.value,'$.id'),7),19,1) IS NOT '-' OR substr(substr(json_extract(t.value,'$.id'),7),24,1) IS NOT '-' OR length(replace(substr(json_extract(t.value,'$.id'),7),'-',''))<>32 OR replace(substr(json_extract(t.value,'$.id'),7),'-','') GLOB '*[^0-9a-f]*' OR json_type(t.value,'$.alt') IS NOT 'text' OR length(json_extract(t.value,'$.alt'))>200)) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;

END;

CREATE TRIGGER cms_v2_state_insert_guard BEFORE INSERT ON cms_v2_state
BEGIN
  SELECT CASE WHEN NEW.published_version_id IS NOT NULL OR NEW.published_revision IS NOT NULL THEN RAISE(ABORT,'CMS_PUBLICATION_DISABLED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_v2_write_guard g,cms_v2_versions v WHERE g.version_id=NEW.draft_version_id AND v.version_id=g.version_id AND v.resulting_revision=NEW.draft_revision AND v.kind='draft') THEN RAISE(ABORT,'CMS_STATE_INVALID') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_v2_versions v,cms_state s WHERE v.version_id=NEW.draft_version_id AND v.expected_revision=s.draft_revision AND ((v.origin_kind='convert' AND s.draft_version_id=v.source_version_id) OR (v.origin_kind='start' AND s.draft_version_id IS NULL))) THEN RAISE(ABORT,'CMS_STATE_INVALID') END;
END;

CREATE TRIGGER cms_v2_state_update_guard BEFORE UPDATE ON cms_v2_state
BEGIN
  SELECT CASE WHEN NEW.published_version_id IS NOT NULL OR NEW.published_revision IS NOT NULL THEN RAISE(ABORT,'CMS_PUBLICATION_DISABLED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_v2_write_guard g,cms_v2_versions v WHERE g.version_id=NEW.draft_version_id AND v.version_id=g.version_id AND v.resulting_revision=NEW.draft_revision AND v.kind='draft') THEN RAISE(ABORT,'CMS_STATE_INVALID') END;
  SELECT CASE WHEN NEW.singleton<>OLD.singleton OR NOT EXISTS(SELECT 1 FROM cms_v2_versions v WHERE v.version_id=NEW.draft_version_id AND v.origin_kind='save' AND v.expected_revision=OLD.draft_revision AND v.version_id<>OLD.draft_version_id) THEN RAISE(ABORT,'CMS_STATE_INVALID') END;
END;

CREATE TRIGGER cms_v2_refs_insert_guard BEFORE INSERT ON cms_v2_media_refs
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_v2_write_guard WHERE version_id=NEW.version_id) THEN RAISE(ABORT,'CMS_WRITE_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_media WHERE media_id=NEW.media_id AND state NOT IN ('deleting','deleted')) THEN RAISE(ABORT,'CMS_MEDIA_UNAVAILABLE') END;
END;

-- Stage 3: guards on legacy tables. All referenced v2 tables now exist.

CREATE TRIGGER cms_versions_v2_namespace_supersession BEFORE INSERT ON cms_versions
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM cms_v2_versions WHERE operation_id=NEW.operation_id) THEN RAISE(ABORT,'CMS_OPERATION_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM cms_v2_state) THEN RAISE(ABORT,'CMS_SCHEMA_SUPERSEDED') END;
END;

CREATE TRIGGER cms_state_v2_supersession BEFORE UPDATE ON cms_state
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM cms_v2_state) THEN RAISE(ABORT,'CMS_SCHEMA_SUPERSEDED') END;
END;

CREATE TRIGGER cms_media_v2_referenced_guard BEFORE UPDATE ON cms_media WHEN EXISTS(SELECT 1 FROM cms_v2_media_refs WHERE media_id=OLD.media_id)
BEGIN
  SELECT CASE WHEN NEW.media_id IS NOT OLD.media_id OR NEW.state IN ('deleting','deleted') OR (OLD.state='ready' AND (NEW.state IS NOT OLD.state OR NEW.derivatives_json IS NOT OLD.derivatives_json)) THEN RAISE(ABORT,'CMS_MEDIA_REFERENCED') END;
END;

-- Stage 4: the single atomic write command. No effects before readiness.
CREATE VIEW cms_v2_write AS SELECT singleton,NULL AS version_id,NULL AS operation_id,NULL AS expected_revision,
 NULL AS resulting_revision,NULL AS document_json,NULL AS command_hash,NULL AS actor_id,NULL AS session_hash,
 NULL AS origin,NULL AS origin_kind,NULL AS source_version_id FROM cms_state;

CREATE TRIGGER cms_v2_write_command INSTEAD OF UPDATE ON cms_v2_write
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_ready_v2) THEN RAISE(ABORT,'CMS_SCHEMA_UNAVAILABLE') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=NEW.session_hash AND u.id=NEW.actor_id AND u.active=1 AND s.auth_version=u.auth_version AND s.origin=NEW.origin AND s.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)) THEN RAISE(ABORT,'CMS_UNAUTHORIZED') END;
  SELECT CASE WHEN NEW.origin_kind NOT IN ('save','convert','start') OR NEW.origin_kind IS NULL THEN RAISE(ABORT,'CMS_INVALID_COMMAND') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM cms_versions WHERE operation_id=NEW.operation_id) THEN RAISE(ABORT,'CMS_OPERATION_CONFLICT') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM cms_v2_versions v WHERE v.operation_id=NEW.operation_id AND (v.actor_id IS NOT NEW.actor_id OR v.command_hash IS NOT NEW.command_hash OR v.expected_revision IS NOT NEW.expected_revision OR v.document_json IS NOT NEW.document_json OR v.origin_kind IS NOT NEW.origin_kind OR v.source_version_id IS NOT NEW.source_version_id)) THEN RAISE(ABORT,'CMS_OPERATION_CONFLICT') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_v2_versions WHERE operation_id=NEW.operation_id) AND NEW.origin_kind IN ('start','convert') AND EXISTS(SELECT 1 FROM cms_v2_state) THEN RAISE(ABORT,'CMS_ALREADY_V2') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_v2_versions WHERE operation_id=NEW.operation_id) AND ((NEW.origin_kind='save' AND NOT EXISTS(SELECT 1 FROM cms_v2_state WHERE draft_revision=NEW.expected_revision)) OR (NEW.origin_kind IN ('start','convert') AND NOT EXISTS(SELECT 1 FROM cms_state WHERE draft_revision=NEW.expected_revision AND ((NEW.origin_kind='start' AND draft_version_id IS NULL) OR (NEW.origin_kind='convert' AND draft_version_id=NEW.source_version_id))))) THEN RAISE(ABORT,'CMS_REVISION_CONFLICT') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_v2_versions WHERE operation_id=NEW.operation_id) AND NEW.origin_kind='start' AND NOT EXISTS(SELECT 1 FROM json_each(NEW.document_json,'$.modules') WHERE json_extract(value,'$.template')='carousel' AND json_extract(value,'$.visible')=1) THEN RAISE(ABORT,'CMS_DOCUMENT_INVALID') END;
  INSERT INTO cms_v2_write_guard SELECT 1,NEW.version_id,NEW.operation_id,NEW.actor_id,NEW.session_hash,NEW.origin WHERE NOT EXISTS(SELECT 1 FROM cms_v2_versions WHERE operation_id=NEW.operation_id);
  INSERT INTO cms_v2_versions SELECT NEW.version_id,'draft',NEW.operation_id,NEW.expected_revision,NEW.resulting_revision,NEW.document_json,NEW.command_hash,NEW.actor_id,CAST(unixepoch('subsec')*1000 AS INTEGER),NEW.origin_kind,NEW.source_version_id WHERE EXISTS(SELECT 1 FROM cms_v2_write_guard WHERE version_id=NEW.version_id);
  INSERT INTO cms_v2_media_refs SELECT DISTINCT NEW.version_id,t.atom FROM cms_v2_write_guard g,json_tree(NEW.document_json) t JOIN json_tree(NEW.document_json) p ON p.id=t.parent WHERE p.key='media' AND t.key='id' AND t.type='text';
  INSERT INTO cms_v2_state SELECT 1,NEW.version_id,NEW.resulting_revision,NULL,NULL WHERE NEW.origin_kind IN ('start','convert') AND EXISTS(SELECT 1 FROM cms_v2_write_guard);
  UPDATE cms_v2_state SET draft_version_id=NEW.version_id,draft_revision=NEW.resulting_revision WHERE NEW.origin_kind='save' AND EXISTS(SELECT 1 FROM cms_v2_write_guard);
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_v2_versions WHERE operation_id=NEW.operation_id AND actor_id=NEW.actor_id AND command_hash=NEW.command_hash) THEN RAISE(ABORT,'CMS_WRITE_INCOMPLETE') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM cms_v2_write_guard) AND (NOT EXISTS(SELECT 1 FROM cms_v2_state WHERE draft_version_id=NEW.version_id AND draft_revision=NEW.resulting_revision AND published_version_id IS NULL AND published_revision IS NULL) OR NOT EXISTS(SELECT 1 FROM cms_v2_versions WHERE version_id=NEW.version_id AND operation_id=NEW.operation_id AND document_json=NEW.document_json AND resulting_revision=NEW.resulting_revision AND expected_revision=NEW.expected_revision) OR EXISTS(SELECT media_id FROM (SELECT json_extract(m.value,'$.content.media.id') AS media_id FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.content.media.id') IS NOT NULL UNION SELECT json_extract(e.value,'$.media.id') FROM json_each(NEW.document_json,'$.modules') m,json_each(m.value,'$.content.entries') e WHERE json_extract(e.value,'$.media.id') IS NOT NULL) EXCEPT SELECT media_id FROM cms_v2_media_refs WHERE version_id=NEW.version_id) OR EXISTS(SELECT media_id FROM cms_v2_media_refs WHERE version_id=NEW.version_id EXCEPT SELECT media_id FROM (SELECT json_extract(m.value,'$.content.media.id') AS media_id FROM json_each(NEW.document_json,'$.modules') m WHERE json_extract(m.value,'$.content.media.id') IS NOT NULL UNION SELECT json_extract(e.value,'$.media.id') FROM json_each(NEW.document_json,'$.modules') m,json_each(m.value,'$.content.entries') e WHERE json_extract(e.value,'$.media.id') IS NOT NULL))) THEN RAISE(ABORT,'CMS_WRITE_INCOMPLETE') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=NEW.session_hash AND u.id=NEW.actor_id AND u.active=1 AND s.auth_version=u.auth_version AND s.origin=NEW.origin AND s.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)) THEN RAISE(ABORT,'CMS_UNAUTHORIZED') END;
  DELETE FROM cms_v2_write_guard;
END;

-- Stage 5: LAST statement; no ready result exists until every dependency is installed.
CREATE VIEW cms_ready_v2 AS SELECT 1 WHERE EXISTS(SELECT 1 FROM cms_ready)
 AND (SELECT count(*) FROM d1_migrations WHERE name IN ('0006_cms_foundation.sql','0007_cms_media_local.sql','0008_cms_media_atomic.sql','0009_cms_v2.sql'))=4
 AND (SELECT count(*) FROM sqlite_schema WHERE type='table' AND name IN ('cms_v2_versions','cms_v2_state','cms_v2_media_refs','cms_v2_write_guard','catalog_items','catalog_categories'))=6
 AND EXISTS(SELECT 1 FROM sqlite_schema WHERE type='view' AND name='cms_v2_write')
 AND (SELECT count(*) FROM sqlite_schema WHERE type='trigger' AND name IN ('cms_v2_guard_authorize','cms_v2_versions_immutable_update','cms_v2_versions_immutable_delete','cms_v2_media_refs_immutable_update','cms_v2_media_refs_immutable_delete','cms_v2_state_no_delete','cms_v2_versions_insert_guard','cms_v2_state_insert_guard','cms_v2_state_update_guard','cms_v2_refs_insert_guard','cms_versions_v2_namespace_supersession','cms_state_v2_supersession','cms_media_v2_referenced_guard','cms_v2_write_command'))=14;
