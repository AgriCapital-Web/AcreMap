-- Secure two-way CRM integration credentials for AcreMap.
CREATE TABLE IF NOT EXISTS public.crm_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT 'AgriCapital CRM',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS crm_api_keys_active_idx ON public.crm_api_keys (key_hash) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.crm_integration_secrets (
  id text PRIMARY KEY CHECK (id = 'webhook_hmac'),
  secret text NOT NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_integration_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  webhook_url text NOT NULL DEFAULT 'https://rfzfsmpsuempafhkqhra.supabase.co/functions/v1/acremap-webhook',
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.crm_integration_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.crm_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_integration_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_integration_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_api_keys, public.crm_integration_secrets, public.crm_integration_config FROM PUBLIC, anon, authenticated;
