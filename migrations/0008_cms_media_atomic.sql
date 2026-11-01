-- Additive local media fencing. 0006 and 0007 remain unchanged.
-- R2 is not part of this transaction; observations are evidence at a point in time only.
CREATE TABLE cms_media_write_guard (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), operation_id TEXT NOT NULL,
  media_id TEXT, transition TEXT NOT NULL
) STRICT;
CREATE TABLE cms_media_checks (
  check_id TEXT PRIMARY KEY NOT NULL,
  media_id TEXT NOT NULL REFERENCES cms_media(media_id),
  manifest_json TEXT NOT NULL,
  valid INTEGER NOT NULL CHECK(valid IN (0,1)),
  checked_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
) STRICT;
CREATE TABLE cms_media_receipts (
  operation_id TEXT PRIMARY KEY REFERENCES cms_media_jobs(operation_id),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER))
) STRICT;
CREATE TRIGGER cms_media_checks_immutable_update BEFORE UPDATE ON cms_media_checks BEGIN SELECT RAISE(ABORT,'MEDIA_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER cms_media_checks_immutable_delete BEFORE DELETE ON cms_media_checks BEGIN SELECT RAISE(ABORT,'MEDIA_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER cms_media_receipts_immutable_update BEFORE UPDATE ON cms_media_receipts BEGIN SELECT RAISE(ABORT,'MEDIA_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER cms_media_receipts_immutable_delete BEFORE DELETE ON cms_media_receipts BEGIN SELECT RAISE(ABORT,'MEDIA_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER cms_media_controlled_update BEFORE UPDATE ON cms_media
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_media_write_guard WHERE media_id=OLD.media_id)
    THEN RAISE(ABORT,'MEDIA_WRITE_REQUIRED') END;
  SELECT CASE WHEN OLD.state='ready' AND NEW.state='ready' AND
    (NEW.derivatives_json IS NOT OLD.derivatives_json OR NEW.revision IS NOT OLD.revision)
    THEN RAISE(ABORT,'MEDIA_MANIFEST_IMMUTABLE') END;
END;
CREATE TRIGGER cms_media_job_guard BEFORE UPDATE ON cms_media_jobs
BEGIN
  SELECT CASE WHEN OLD.status<>'running' THEN RAISE(ABORT,'MEDIA_JOB_TERMINAL') END;
  SELECT CASE WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.action IS NOT OLD.action
    OR NEW.media_id IS NOT OLD.media_id OR NEW.actor_id IS NOT OLD.actor_id
    OR NEW.expected_revision IS NOT OLD.expected_revision OR NEW.created_at IS NOT OLD.created_at
    OR NEW.expires_at>OLD.expires_at THEN RAISE(ABORT,'MEDIA_JOB_IDENTITY') END;
  SELECT CASE WHEN (NEW.status IS NOT OLD.status OR NEW.request_hash IS NOT OLD.request_hash)
    AND NOT EXISTS(SELECT 1 FROM cms_media_write_guard WHERE operation_id=OLD.operation_id)
    THEN RAISE(ABORT,'MEDIA_WRITE_REQUIRED') END;
END;
CREATE TRIGGER cms_media_job_no_delete BEFORE DELETE ON cms_media_jobs BEGIN SELECT RAISE(ABORT,'MEDIA_JOB_IMMUTABLE'); END;

CREATE VIEW cms_media_start AS SELECT singleton,NULL AS operation_id,NULL AS action,NULL AS media_id,
  NULL AS actor_id,NULL AS session_hash,NULL AS origin,NULL AS expected_revision FROM cms_state;
CREATE TRIGGER cms_media_start_command INSTEAD OF UPDATE ON cms_media_start
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
    WHERE s.token_hash=NEW.session_hash AND u.id=NEW.actor_id AND u.active=1 AND s.auth_version=u.auth_version
    AND s.origin=NEW.origin AND s.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)) THEN RAISE(ABORT,'MEDIA_UNAUTHORIZED') END;
  INSERT INTO cms_media_write_guard VALUES(1,NEW.operation_id,NEW.media_id,'start');
  INSERT INTO cms_media_jobs(operation_id,action,media_id,actor_id,request_hash,expected_revision,status,expires_at,created_at)
    VALUES(NEW.operation_id,NEW.action,NEW.media_id,NEW.actor_id,'',NEW.expected_revision,'running',
      CAST(unixepoch('subsec')*1000 AS INTEGER)+60000,CAST(unixepoch('subsec')*1000 AS INTEGER));
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_media_jobs WHERE operation_id=NEW.operation_id AND status='running')
    THEN RAISE(ABORT,'MEDIA_WRITE_INCOMPLETE') END;
  DELETE FROM cms_media_write_guard;
END;
CREATE VIEW cms_media_command AS SELECT operation_id,media_id,NULL AS transition,NULL AS manifest_json,
  NULL AS check_id,NULL AS request_hash,NULL AS actor_id,NULL AS session_hash,NULL AS origin FROM cms_media_jobs;
CREATE TRIGGER cms_media_command_apply INSTEAD OF UPDATE ON cms_media_command
BEGIN
  SELECT CASE WHEN NEW.transition NOT IN ('process','finish','fail','expire','recover') THEN RAISE(ABORT,'MEDIA_INVALID_COMMAND') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
    WHERE s.token_hash=NEW.session_hash AND u.id=NEW.actor_id AND u.active=1 AND s.auth_version=u.auth_version
    AND s.origin=NEW.origin AND s.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)) THEN RAISE(ABORT,'MEDIA_UNAUTHORIZED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_media_jobs WHERE operation_id=NEW.operation_id AND actor_id=NEW.actor_id
    AND status='running' AND ((NEW.transition='expire' AND expires_at<=CAST(unixepoch('subsec')*1000 AS INTEGER))
      OR (NEW.transition<>'expire' AND expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)))) THEN RAISE(ABORT,'MEDIA_LEASE') END;
  SELECT CASE WHEN NEW.transition<>'recover' AND NEW.media_id IS NOT OLD.media_id THEN RAISE(ABORT,'MEDIA_IDENTITY') END;
  SELECT CASE WHEN OLD.media_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cms_media WHERE media_id=OLD.media_id
    AND lease_token=NEW.operation_id AND state IN ('quarantined','processing','deleting')
    AND (NEW.transition='expire' OR lease_expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER))) THEN RAISE(ABORT,'MEDIA_DIVERGENCE_OR_LEASE') END;
  SELECT CASE WHEN NEW.transition='process' AND NOT EXISTS(SELECT 1 FROM cms_media_jobs j JOIN cms_media m USING(media_id)
    WHERE j.operation_id=NEW.operation_id AND j.action='upload' AND m.state='quarantined'
    AND length(NEW.request_hash)=64 AND NEW.request_hash NOT GLOB '*[^0-9a-f]*') THEN RAISE(ABORT,'MEDIA_PRECONDITION') END;
  SELECT CASE WHEN NEW.transition='finish' AND EXISTS(SELECT 1 FROM cms_media_jobs WHERE operation_id=NEW.operation_id AND action='upload')
    AND NOT EXISTS(SELECT 1 FROM cms_media m JOIN cms_media_checks c USING(media_id) WHERE m.media_id=OLD.media_id
      AND m.state='processing' AND c.check_id=NEW.check_id AND c.valid=1 AND c.manifest_json=NEW.manifest_json)
    THEN RAISE(ABORT,'MEDIA_OBJECT_INTEGRITY') END;
  SELECT CASE WHEN NEW.transition='recover' AND NOT EXISTS(SELECT 1 FROM cms_media_jobs j,cms_media m
    WHERE j.operation_id=NEW.operation_id AND j.action='reconcile' AND m.media_id=NEW.media_id AND m.state='deleting'
    AND NOT EXISTS(SELECT 1 FROM cms_media_jobs a WHERE a.media_id=m.media_id AND a.status='running')) THEN RAISE(ABORT,'MEDIA_PRECONDITION') END;
  INSERT INTO cms_media_write_guard VALUES(1,NEW.operation_id,NEW.media_id,NEW.transition);
  UPDATE cms_media_jobs SET request_hash=NEW.request_hash WHERE operation_id=NEW.operation_id AND NEW.transition='process';
  UPDATE cms_media SET state='processing' WHERE media_id=OLD.media_id AND NEW.transition='process';
  UPDATE cms_media SET state=CASE WHEN state='deleting' THEN 'deleted' ELSE 'ready' END,
    derivatives_json=NEW.manifest_json,revision=NEW.operation_id,lease_token=NULL,lease_expires_at=NULL
    WHERE media_id=OLD.media_id AND NEW.transition='finish';
  UPDATE cms_media SET state=CASE WHEN state='deleting' THEN 'deleting' ELSE 'rejected' END,
    lease_token=NULL,lease_expires_at=NULL WHERE media_id=OLD.media_id AND NEW.transition IN ('fail','expire');
  UPDATE cms_media SET state='deleted',revision=NEW.operation_id,lease_token=NULL,lease_expires_at=NULL
    WHERE media_id=NEW.media_id AND NEW.transition='recover';
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cms_media_jobs WHERE operation_id=NEW.operation_id
    AND (NEW.transition='expire' OR expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER))) THEN RAISE(ABORT,'MEDIA_LEASE') END;
  UPDATE cms_media_jobs SET status=CASE WHEN NEW.transition='finish' THEN 'done' ELSE 'failed' END
    WHERE operation_id=NEW.operation_id AND NEW.transition IN ('finish','fail','expire');
  SELECT CASE WHEN NEW.transition IN ('finish','fail','expire') AND NOT EXISTS(SELECT 1 FROM cms_media_jobs
    WHERE operation_id=NEW.operation_id AND status=CASE WHEN NEW.transition='finish' THEN 'done' ELSE 'failed' END)
    THEN RAISE(ABORT,'MEDIA_WRITE_INCOMPLETE') END;
  SELECT CASE WHEN NEW.transition='finish' AND OLD.media_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cms_media m,cms_media_jobs j
    WHERE j.operation_id=NEW.operation_id AND m.media_id=j.media_id AND m.revision=NEW.operation_id
      AND m.lease_token IS NULL AND m.derivatives_json IS NEW.manifest_json
      AND ((j.action='upload' AND m.state='ready') OR (j.action='delete' AND m.state='deleted')))
    THEN RAISE(ABORT,'MEDIA_WRITE_INCOMPLETE') END;
  SELECT CASE WHEN NEW.transition='process' AND NOT EXISTS(SELECT 1 FROM cms_media WHERE media_id=OLD.media_id AND state='processing')
    THEN RAISE(ABORT,'MEDIA_WRITE_INCOMPLETE') END;
  SELECT CASE WHEN NEW.transition IN ('fail','expire') AND OLD.media_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cms_media
    WHERE media_id=OLD.media_id AND state IN ('rejected','deleting') AND lease_token IS NULL AND lease_expires_at IS NULL)
    THEN RAISE(ABORT,'MEDIA_WRITE_INCOMPLETE') END;
  SELECT CASE WHEN NEW.transition='recover' AND NOT EXISTS(SELECT 1 FROM cms_media WHERE media_id=NEW.media_id
    AND state='deleted' AND lease_token IS NULL) THEN RAISE(ABORT,'MEDIA_WRITE_INCOMPLETE') END;
  INSERT INTO cms_media_receipts(operation_id,result_json)
    SELECT j.operation_id,CASE WHEN j.action='reconcile' THEN json_object('operation',json_object('id',j.operation_id,'status',j.status))
      ELSE json_object('media',json_object('id',m.media_id,'state',m.state,'revision',m.revision,
        'profiles',json(CASE WHEN m.state='ready' THEN '["hero","section"]' ELSE '[]' END)),
        'operation',json_object('id',j.operation_id,'status',j.status)) END
    FROM cms_media_jobs j LEFT JOIN cms_media m USING(media_id) WHERE j.operation_id=NEW.operation_id AND NEW.transition IN ('finish','fail','expire');
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
    WHERE s.token_hash=NEW.session_hash AND u.id=NEW.actor_id AND u.active=1 AND s.auth_version=u.auth_version
    AND s.origin=NEW.origin AND s.expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)) THEN RAISE(ABORT,'MEDIA_UNAUTHORIZED') END;
  DELETE FROM cms_media_write_guard;
END;
