-- 0010: reusable occupied slots, without deleting historical records or changing 0001-0009.
-- Rejected media may own orphan objects: retain their reservation until explicit cleanup reaches deleted.
-- Install the replacement first. A partial installation may reject writes, never bypass the quota.
CREATE TRIGGER cms_media_job_start_reusable AFTER INSERT ON cms_media_jobs
BEGIN
  SELECT CASE WHEN NEW.status <> 'running' THEN RAISE(ABORT,'MEDIA_CONFLICT') END;
  SELECT CASE WHEN NEW.action='upload' AND (SELECT count(*) FROM cms_media WHERE state<>'deleted')>=100
    THEN RAISE(ABORT,'MEDIA_QUOTA') END;
  INSERT INTO cms_media(media_id,state,created_at,revision,lease_token,lease_expires_at)
    SELECT NEW.media_id,'quarantined',NEW.created_at,NEW.operation_id,NEW.operation_id,NEW.expires_at WHERE NEW.action='upload';
  SELECT CASE WHEN NEW.action='delete' AND NOT EXISTS(SELECT 1 FROM cms_media
    WHERE media_id=NEW.media_id AND revision=NEW.expected_revision AND state IN ('ready','rejected'))
    THEN RAISE(ABORT,'MEDIA_PRECONDITION') END;
  UPDATE cms_media SET state='deleting',revision=NEW.operation_id,lease_token=NEW.operation_id,lease_expires_at=NEW.expires_at
    WHERE media_id=NEW.media_id AND NEW.action='delete';
END;
DROP TRIGGER cms_media_job_start;
-- LAST: API readiness marker and single authoritative capacity projection for the new policy.
CREATE VIEW cms_media_capacity AS
SELECT 100 AS capacity_limit, count(*) AS consumed, 0 AS includes_tombstones
FROM cms_media WHERE state<>'deleted';
