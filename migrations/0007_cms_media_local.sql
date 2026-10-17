-- Additive upgrade of 0006. Local lifecycle only; does not enable publication.
ALTER TABLE cms_media ADD COLUMN revision TEXT NOT NULL DEFAULT 'm0';
CREATE TABLE cms_media_intake (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE cms_media_jobs (
  operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id)=36),
  action TEXT NOT NULL CHECK(action IN ('upload','delete','reconcile')),
  media_id TEXT REFERENCES cms_media(media_id) DEFERRABLE INITIALLY DEFERRED,
  actor_id TEXT NOT NULL REFERENCES admin_users(id),
  request_hash TEXT NOT NULL,
  expected_revision TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','done','failed')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK((action='reconcile') = (media_id IS NULL))
) STRICT;
-- One expensive operation per disposable library; a lease needs explicit reconciliation.
CREATE UNIQUE INDEX cms_media_one_running ON cms_media_jobs((1)) WHERE status='running';
CREATE INDEX cms_media_jobs_media ON cms_media_jobs(media_id);
CREATE TRIGGER cms_media_job_start AFTER INSERT ON cms_media_jobs
BEGIN
  SELECT CASE WHEN NEW.status <> 'running' THEN RAISE(ABORT,'MEDIA_CONFLICT') END;
  SELECT CASE WHEN NEW.action='upload' AND (SELECT count(*) FROM cms_media)>=100
    THEN RAISE(ABORT,'MEDIA_QUOTA') END;
  INSERT INTO cms_media(media_id,state,created_at,revision,lease_token,lease_expires_at)
    SELECT NEW.media_id,'quarantined',NEW.created_at,NEW.operation_id,NEW.operation_id,NEW.expires_at WHERE NEW.action='upload';
  SELECT CASE WHEN NEW.action='delete' AND NOT EXISTS(SELECT 1 FROM cms_media
    WHERE media_id=NEW.media_id AND revision=NEW.expected_revision AND state IN ('ready','rejected'))
    THEN RAISE(ABORT,'MEDIA_PRECONDITION') END;
  UPDATE cms_media SET state='deleting',revision=NEW.operation_id,lease_token=NEW.operation_id,lease_expires_at=NEW.expires_at
    WHERE media_id=NEW.media_id AND NEW.action='delete';
END;
CREATE TRIGGER cms_media_local_no_delete BEFORE DELETE ON cms_media
BEGIN SELECT RAISE(ABORT,'MEDIA_TOMBSTONE_REQUIRED'); END;
CREATE TRIGGER cms_media_local_identity BEFORE UPDATE ON cms_media
WHEN NEW.media_id IS NOT OLD.media_id OR NEW.quarantine_key IS NOT NULL
BEGIN SELECT RAISE(ABORT,'MEDIA_IDENTITY'); END;
CREATE TRIGGER cms_media_local_terminal BEFORE UPDATE ON cms_media
WHEN OLD.state='deleted' AND NEW.state<>'deleted'
BEGIN SELECT RAISE(ABORT,'MEDIA_TERMINAL'); END;
