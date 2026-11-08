-- AcreMap — Neon PostgreSQL foundation
-- Additive, idempotent schema for the development branch.
-- Authentication identities are owned by Neon Managed Better Auth (neon_auth).
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
DO $$ BEGIN CREATE TYPE public.app_role AS ENUM ('admin','agent','viewer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.measurement_status AS ENUM ('draft','submitted','validated','archived'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.acremap_schema_migrations (
  version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT 'deployment'
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '', username text UNIQUE, phone text,
  must_change_password boolean NOT NULL DEFAULT false, disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  role public.app_role NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

CREATE TABLE IF NOT EXISTS public.sps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL,
  district text NOT NULL DEFAULT '', region text NOT NULL DEFAULT '', departement text NOT NULL DEFAULT '',
  notes text, archived_at timestamptz, created_by uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.domaines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL,
  sp_id uuid NOT NULL REFERENCES public.sps(id) ON DELETE CASCADE, description text, notes text,
  archived_at timestamptz, created_by uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.parcelles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text,
  owner_name text NOT NULL DEFAULT '', owner_phone text,
  domaine_id uuid NOT NULL REFERENCES public.domaines(id) ON DELETE CASCADE,
  convention_date timestamptz, declared_area numeric, convention_status text NOT NULL DEFAULT 'EN_COURS',
  owner_photo text, group_photo text, parcelle_photo text, notes text, archived_at timestamptz,
  created_by uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcelle_id uuid REFERENCES public.parcelles(id) ON DELETE CASCADE,
  status public.measurement_status NOT NULL DEFAULT 'draft',
  area_m2 numeric NOT NULL DEFAULT 0, perimeter_m numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'ha', points jsonb NOT NULL DEFAULT '[]'::jsonb,
  trace jsonb NOT NULL DEFAULT '[]'::jsonb, device_profile jsonb, qa jsonb,
  offline_created boolean NOT NULL DEFAULT false,
  sync_state text NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('pending','synced','error')),
  synced_at timestamptz, measured_at timestamptz, notes text,
  validated_by uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL, validated_at timestamptz,
  created_by uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.morcellement_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcelle_id uuid NOT NULL REFERENCES public.parcelles(id) ON DELETE CASCADE,
  measurement_id uuid REFERENCES public.measurements(id) ON DELETE SET NULL,
  reference text, config jsonb NOT NULL DEFAULT '{}'::jsonb, score jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_m2 numeric NOT NULL DEFAULT 0, total_m2 numeric NOT NULL DEFAULT 0,
  conforme boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','archived')),
  notes text, created_by uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.crm_landowners (
  id text PRIMARY KEY, full_name text NOT NULL, phone text, account_code text,
  active boolean NOT NULL DEFAULT true, source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcelle_id uuid NOT NULL REFERENCES public.parcelles(id) ON DELETE CASCADE,
  measurement_id uuid REFERENCES public.measurements(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES public.morcellement_plans(id) ON DELETE SET NULL,
  code text NOT NULL, polygon jsonb NOT NULL DEFAULT '[]'::jsonb, bornes jsonb NOT NULL DEFAULT '[]'::jsonb,
  area_m2 numeric NOT NULL DEFAULT 0, is_reserve boolean NOT NULL DEFAULT false,
  assignee_name text, assignee_owner_id text REFERENCES public.crm_landowners(id) ON DELETE SET NULL,
  assignee_contact text, assignee_account text, assigned_at timestamptz,
  part text NOT NULL DEFAULT 'proprietaire' CHECK (part IN ('ac','proprietaire')),
  kind text NOT NULL DEFAULT 'lot' CHECK (kind IN ('lot','reserve','collecte')),
  label text, target_area_m2 numeric,
  created_by uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(parcelle_id, code)
);
CREATE TABLE IF NOT EXISTS public.voies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id uuid NOT NULL REFERENCES public.measurements(id) ON DELETE CASCADE,
  axis text NOT NULL, width_m numeric NOT NULL, polygon jsonb NOT NULL, area_m2 numeric NOT NULL,
  created_by uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.partages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id uuid NOT NULL REFERENCES public.measurements(id) ON DELETE CASCADE,
  axis text NOT NULL, pct_ac numeric NOT NULL CHECK (pct_ac >= 0 AND pct_ac <= 100),
  part_ac jsonb NOT NULL, part_proprio jsonb NOT NULL, area_ac_m2 numeric NOT NULL, area_proprio_m2 numeric NOT NULL,
  created_by uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parcelle_id uuid REFERENCES public.parcelles(id) ON DELETE CASCADE,
  file_name text NOT NULL, file_type text NOT NULL, storage_path text, size_bytes bigint,
  status text NOT NULL DEFAULT 'pending', error text, parsed jsonb,
  created_by uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.parcelle_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcelle_id uuid NOT NULL REFERENCES public.parcelles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  role_label text NOT NULL DEFAULT 'Collaborateur',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(parcelle_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.parcelle_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcelle_id uuid NOT NULL REFERENCES public.parcelles(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'parcelle', storage_path text NOT NULL, caption text,
  created_by uuid REFERENCES neon_auth."user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_user_roles_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ BEGIN
  IF auth.uid() IS NULL OR private.has_role(auth.uid(), 'admin') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Seul un administrateur peut modifier les rôles';
END $$;
CREATE OR REPLACE FUNCTION public.protect_profile_lifecycle_flags()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ BEGIN
  IF auth.uid() IS NULL OR private.has_role(auth.uid(), 'admin') THEN RETURN NEW; END IF;
  NEW.disabled := OLD.disabled; NEW.must_change_password := OLD.must_change_password; NEW.id := OLD.id;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_measurement_validation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private
AS $$ BEGIN
  IF NEW.status = 'validated' AND OLD.status IS DISTINCT FROM 'validated' THEN
    IF auth.uid() IS NOT NULL AND NOT private.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'Seul un administrateur peut valider une mesure';
    END IF;
    NEW.validated_by := auth.uid(); NEW.validated_at := now();
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','sps','domaines','parcelles','measurements','morcellement_plans','lots','imports','parcelle_assignments','parcelle_photos'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t, t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_user_roles_guard ON public.user_roles;
CREATE TRIGGER trg_user_roles_guard BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.guard_user_roles_changes();
DROP TRIGGER IF EXISTS trg_profiles_lifecycle_guard ON public.profiles;
CREATE TRIGGER trg_profiles_lifecycle_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_lifecycle_flags();
DROP TRIGGER IF EXISTS trg_measurement_validation ON public.measurements;
CREATE TRIGGER trg_measurement_validation BEFORE UPDATE ON public.measurements FOR EACH ROW EXECUTE FUNCTION public.guard_measurement_validation();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','user_roles','sps','domaines','parcelles','measurements','morcellement_plans','lots','voies','partages','imports','crm_landowners','parcelle_assignments','parcelle_photos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
CREATE POLICY profiles_select_own_or_admin ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR private.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS profiles_insert_own_or_admin ON public.profiles;
CREATE POLICY profiles_insert_own_or_admin ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR private.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS profiles_update_own_or_admin ON public.profiles;
CREATE POLICY profiles_update_own_or_admin ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR private.has_role(auth.uid(), 'admin'))
  WITH CHECK (id = auth.uid() OR private.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS profiles_delete_admin ON public.profiles;
CREATE POLICY profiles_delete_admin ON public.profiles FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS user_roles_select_own_or_admin ON public.user_roles;
CREATE POLICY user_roles_select_own_or_admin ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS user_roles_admin_all ON public.user_roles;
CREATE POLICY user_roles_admin_all ON public.user_roles FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sps','domaines','parcelles','measurements','morcellement_plans','lots','voies','partages','imports','parcelle_assignments','parcelle_photos'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_select_roles ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_select_roles ON public.%I FOR SELECT TO authenticated USING (private.has_role(auth.uid(), ''admin'') OR private.has_role(auth.uid(), ''agent'') OR private.has_role(auth.uid(), ''viewer''))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_insert_staff ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_insert_staff ON public.%I FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), ''admin'') OR private.has_role(auth.uid(), ''agent''))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_update_staff ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_update_staff ON public.%I FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), ''admin'') OR private.has_role(auth.uid(), ''agent'')) WITH CHECK (private.has_role(auth.uid(), ''admin'') OR private.has_role(auth.uid(), ''agent''))', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_delete_admin ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_delete_admin ON public.%I FOR DELETE TO authenticated USING (private.has_role(auth.uid(), ''admin''))', t, t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS crm_landowners_read_roles ON public.crm_landowners;
CREATE POLICY crm_landowners_read_roles ON public.crm_landowners FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'agent') OR private.has_role(auth.uid(), 'viewer'));

CREATE INDEX IF NOT EXISTS idx_domaines_sp ON public.domaines(sp_id);
CREATE INDEX IF NOT EXISTS idx_parcelles_domaine ON public.parcelles(domaine_id);
CREATE INDEX IF NOT EXISTS idx_measurements_parcelle ON public.measurements(parcelle_id);
CREATE INDEX IF NOT EXISTS idx_measurements_status ON public.measurements(status);
CREATE INDEX IF NOT EXISTS idx_measurements_sync_state ON public.measurements(sync_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lots_parcelle ON public.lots(parcelle_id);
CREATE INDEX IF NOT EXISTS idx_lots_measurement ON public.lots(measurement_id);
CREATE INDEX IF NOT EXISTS idx_lots_plan ON public.lots(plan_id);
CREATE INDEX IF NOT EXISTS idx_lots_assignee_owner ON public.lots(assignee_owner_id);
CREATE INDEX IF NOT EXISTS idx_plans_parcelle ON public.morcellement_plans(parcelle_id);
CREATE INDEX IF NOT EXISTS idx_imports_parcelle ON public.imports(parcelle_id);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON public.parcelle_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_parcelle ON public.parcelle_photos(parcelle_id);
CREATE INDEX IF NOT EXISTS idx_crm_landowners_active_name ON public.crm_landowners(active, full_name);

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.user_roles, public.sps, public.domaines,
  public.parcelles, public.measurements, public.morcellement_plans, public.lots, public.voies,
  public.partages, public.imports, public.parcelle_assignments, public.parcelle_photos TO authenticated;
GRANT SELECT ON public.crm_landowners TO authenticated;

INSERT INTO public.acremap_schema_migrations(version, applied_by)
VALUES ('20261108_neon_backend_foundation', 'github_migration')
ON CONFLICT (version) DO NOTHING;

COMMIT;
