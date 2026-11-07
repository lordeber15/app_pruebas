import { sql, type Kysely } from 'kysely';

/**
 * Tablas de Better Auth (ADR-006). Están separadas de `usuario` (dominio) y comparten su id:
 * auth_user.id = usuario.id. Las columnas se mapean a snake_case en apps/api/src/auth/auth.ts.
 *
 * - El login es por documento: username = "<tipo>.<número>" en minúsculas (p. ej. "dni.12345678").
 * - Better Auth exige un correo único; se usa uno sintético "<id>@usuarios.invalid", que no es
 *   un dato personal (el dominio .invalid está reservado y nunca recibe correo).
 * - La contraseña (Argon2id) vive en auth_account.password con provider_id = 'credential'.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE app.auth_user (
      id uuid PRIMARY KEY REFERENCES app.usuario ON DELETE RESTRICT,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      email_verified boolean NOT NULL DEFAULT false,
      image text,
      username text NOT NULL UNIQUE CHECK (username ~ '^[a-z]{2,10}\\.[0-9a-z]{4,20}$'),
      display_username text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE app.auth_session (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES app.auth_user ON DELETE RESTRICT,
      token text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      ip_address text,
      user_agent text,
      -- Sesión de celular: queda vinculada al dispositivo al activarlo o renovarla con su firma
      -- (SEG-05). Las sesiones web no tienen dispositivo.
      dispositivo_id uuid REFERENCES app.dispositivo ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX auth_session_user_idx ON app.auth_session (user_id);

    CREATE TABLE app.auth_account (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES app.auth_user ON DELETE RESTRICT,
      account_id text NOT NULL,
      provider_id text NOT NULL,
      access_token text,
      refresh_token text,
      id_token text,
      access_token_expires_at timestamptz,
      refresh_token_expires_at timestamptz,
      scope text,
      password text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (provider_id, account_id)
    );
    CREATE INDEX auth_account_user_idx ON app.auth_account (user_id);

    CREATE TABLE app.auth_verification (
      id uuid PRIMARY KEY,
      identifier text NOT NULL,
      value text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX auth_verification_identifier_idx ON app.auth_verification (identifier);

    -- Desafíos de renovación firmados por el dispositivo (SEG-05): se guarda el nonce usado para
    -- impedir que una firma capturada se reutilice.
    CREATE TABLE app.dispositivo_nonce (
      dispositivo_id uuid NOT NULL REFERENCES app.dispositivo ON DELETE RESTRICT,
      nonce text NOT NULL CHECK (length(nonce) BETWEEN 16 AND 128),
      usado_en timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (dispositivo_id, nonce)
    );

    -- Las sesiones y verificaciones vencidas o cerradas se borran: no son datos de campo.
    GRANT DELETE ON app.auth_session, app.auth_verification TO app_rw, worker_rw;
    GRANT DELETE ON app.dispositivo_nonce TO worker_rw;
    REVOKE DELETE, TRUNCATE ON app.auth_user, app.auth_account, app.dispositivo_nonce FROM app_rw;
    REVOKE DELETE, TRUNCATE ON app.auth_user, app.auth_account FROM worker_rw;
  `.execute(db);
}
