-- Locality level: allow the new role on users and the new room type (run in the Supabase SQL editor).
-- Both checks are dropped and re-added with one value more; nothing else changes.

-- users.role: same list as 20261003200000_lcc_working_groups.sql plus 'locality_err'
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role = ANY (ARRAY[
  'support','admin','superadmin','state_err','locality_err','base_err','partner','state_rep','lcc_wg'
]));

-- emergency_rooms.type: 'state', 'base' plus 'locality' (a locality ERR's own room)
ALTER TABLE public.emergency_rooms DROP CONSTRAINT IF EXISTS emergency_rooms_type_check;
ALTER TABLE public.emergency_rooms ADD CONSTRAINT emergency_rooms_type_check CHECK (type = ANY (ARRAY[
  'state','locality','base'
]));
