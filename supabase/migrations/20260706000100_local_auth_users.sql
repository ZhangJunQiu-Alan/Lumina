CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_idx
  ON app_users (LOWER(email));

REVOKE ALL ON app_users FROM anon;
REVOKE ALL ON app_users FROM authenticated;
REVOKE ALL ON app_users FROM service_role;
