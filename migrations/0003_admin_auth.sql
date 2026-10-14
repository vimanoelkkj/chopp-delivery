-- Uma única conta proprietária. A F2 não oferece gestão de contas.
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  singleton INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (singleton = 1)
) STRICT;

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
  user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL,
  origin TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
) STRICT;
CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE admin_login_limits (
  key TEXT PRIMARY KEY NOT NULL CHECK (length(key) = 64),
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX admin_login_limits_expiry ON admin_login_limits(expires_at);

-- Revoga até sessões criadas por um login concorrente; reativar não restaura tokens.
CREATE TRIGGER admin_credentials_changed
AFTER UPDATE OF active, password_hash, username ON admin_users
WHEN OLD.active <> NEW.active OR OLD.password_hash <> NEW.password_hash OR OLD.username <> NEW.username
BEGIN
  UPDATE admin_users SET auth_version = auth_version + 1 WHERE id = NEW.id;
  DELETE FROM admin_sessions WHERE user_id = NEW.id;
END;
