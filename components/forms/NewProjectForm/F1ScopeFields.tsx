import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { newSupabase } from '../../../services/newSupabaseClient';

export type F1ScopeValue = {
  emergency_room_id: string;
  grant_segment: string;
  /** National project the room requests funds from (a working group, e.g. Direct Fund) */
  working_group_id: string;
  working_group_label: string;
  state_name: string;
  locality: string;
  room_label: string;
  /** Canvas org that will own the F1 (Prod organization_id) */
  organization_id: string;
  organization_label: string;
};

type FundProject = { id: string; name_en: string; name_ar: string | null };

type GrantSegment = {
  id: string;
  code: string;
  label_en: string;
  label_ar: string | null;
};

type RoomRow = {
  id: string;
  name: string | null;
  name_ar: string | null;
  err_code: string | null;
  states?: {
    state_name?: string | null;
    state_name_ar?: string | null;
    locality?: string | null;
    locality_ar?: string | null;
  } | null;
};

type OrgOption = {
  id: string;
  slug: string;
  name: string;
  org_type: string;
  is_default_owner?: boolean;
};

type F1ScopeFieldsProps = {
  value: F1ScopeValue;
  onChange: (next: F1ScopeValue) => void;
  locale?: string;
  /** Tighter labels + 2-column rows on upload screens */
  compact?: boolean;
  /** Show + require canvas org (OCR upload — includes LCC coordinator) */
  showOrganization?: boolean;
};

const selectClass = 'app-input !py-2 text-sm';
const labelClass = 'font-semibold block text-xs text-[#a8b6cc] mb-1';

export default function F1ScopeFields({
  value,
  onChange,
  locale = 'en',
  compact = false,
  showOrganization = false,
}: F1ScopeFieldsProps) {
  const { t: tx } = useTranslation('app');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsRoomPicker, setNeedsRoomPicker] = useState(false);
  const [segments, setSegments] = useState<GrantSegment[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [organizations, setOrganizations] = useState<OrgOption[]>([]);
  // The database clears grant_segment on F1s sent by anyone below admin
  // (guard_err_projects); the portal or an admin assigns it later. So only
  // admins see the picker, and only when segments exist.
  const [canSetSegment, setCanSetSegment] = useState(false);
  // National projects open in the chosen room's state
  const [projects, setProjects] = useState<FundProject[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const {
          data: { session },
        } = await newSupabase.auth.getSession();
        if (!session) throw new Error(tx('x.notSignedIn'));

        const headers = { Authorization: `Bearer ${session.access_token}` };
        const [scopeRes, orgRes] = await Promise.all([
          fetch('/api/f1/scope-options', { headers }),
          showOrganization
            ? fetch('/api/f1/org-options', { headers })
            : Promise.resolve(null),
        ]);

        const data = await scopeRes.json();
        if (!scopeRes.ok || !data.success) {
          throw new Error(data.message || tx('x.failedToLoadOptions'));
        }
        if (cancelled) return;

        setNeedsRoomPicker(!!data.needsRoomPicker);
        setSegments(data.grant_segments || []);
        setCanSetSegment(
          (data.grant_segments || []).length > 0 &&
            ['admin', 'superadmin'].includes(data.role)
        );
        setStates(data.states || []);
        setRooms(data.rooms || []);

        if (orgRes) {
          const orgData = await orgRes.json();
          if (!orgRes.ok || !orgData.success) {
            throw new Error(orgData.message || tx('x.failedToLoadOrganizations'));
          }
          if (!cancelled) setOrganizations(orgData.organizations || []);
        }

        if (!data.needsRoomPicker && data.err_id) {
          const room = (data.rooms || []).find((r: RoomRow) => r.id === data.err_id);
          if (room) {
            const place = placeLabels(room, locale);
            onChange({
              ...value,
              emergency_room_id: room.id,
              grant_segment: value.grant_segment || '',
              state_name: place.state_name,
              locality: place.locality,
              room_label: roomLabel(room, locale),
              organization_id: value.organization_id || '',
              organization_label: value.organization_label || '',
            });
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || tx('x.failedToLoadScope'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOrganization]);

  const isAr = !!locale?.startsWith('ar');
  const projectLabel = (g: FundProject) => (isAr && g.name_ar ? g.name_ar : g.name_en);

  useEffect(() => {
    const roomId = value.emergency_room_id;
    if (!roomId) {
      setProjects(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setProjectsError(null);
      try {
        const {
          data: { session },
        } = await newSupabase.auth.getSession();
        if (!session) throw new Error(tx('x.notSignedIn'));
        const res = await fetch(`/api/fund-projects?room=${encodeURIComponent(roomId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(tx('x.failedToLoadOptions'));
        if (cancelled) return;
        const list: FundProject[] = data.projects || [];
        setProjects(list);
        const current = list.find((g) => g.id === value.working_group_id);
        // One open project (stage 1: Direct Fund) is chosen for the room; a choice no longer open is cleared
        const pick = current || (list.length === 1 ? list[0] : null);
        if ((pick?.id || '') !== value.working_group_id || (pick && projectLabel(pick) !== value.working_group_label)) {
          onChange({ ...value, working_group_id: pick?.id || '', working_group_label: pick ? projectLabel(pick) : '' });
        }
      } catch (e: any) {
        if (!cancelled) {
          setProjects([]);
          setProjectsError(e.message || tx('x.failedToLoadOptions'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.emergency_room_id, isAr]);

  const roomsInState = useMemo(() => {
    if (!value.state_name) return rooms;
    return rooms.filter((r) => {
      const place = placeLabels(r, locale);
      // Match either locale label or canonical English key
      return (
        place.state_name === value.state_name ||
        r.states?.state_name === value.state_name ||
        r.states?.state_name_ar === value.state_name
      );
    });
  }, [rooms, value.state_name, locale]);

  const stateOptions = useMemo(() => {
    const map = new Map<string, string>(); // value key (EN) -> display
    for (const r of rooms) {
      const en = r.states?.state_name;
      if (!en) continue;
      const display = isAr
        ? r.states?.state_name_ar || en
        : en || r.states?.state_name_ar || '';
      if (!map.has(en)) map.set(en, display);
    }
    // Also include API states list as EN keys
    for (const s of states) {
      if (!map.has(s)) map.set(s, s);
    }
    return Array.from(map.entries())
      .map(([valueKey, label]) => ({ valueKey, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rooms, states, isAr]);

  const segmentLabel = (s: GrantSegment) =>
    isAr && s.label_ar ? s.label_ar : s.label_en;

  if (loading) {
    return <p className="text-sm text-[#a8b6cc]">{tx('x.loadingOptions')}</p>;
  }

  if (error) {
    return (
      <div className="rounded-xl bg-red-500/10 border border-red-400/30 text-red-300 px-3 py-2 text-sm">
        {error}
      </div>
    );
  }

  const gap = compact ? 'gap-2.5' : 'gap-3';
  const stack = compact ? `grid ${gap}` : `space-y-3`;

  const orgLabel = (o: OrgOption) => o.name;

  return (
    <div className={stack}>
      {needsRoomPicker ? (
        <div className={`grid grid-cols-2 ${gap}`}>
          <div className="min-w-0">
            <label className={labelClass}>{tx('x.state')}</label>
            <select
              className={selectClass}
              value={
                stateOptions.find(
                  (s) =>
                    s.valueKey === value.state_name || s.label === value.state_name
                )?.valueKey || value.state_name
              }
              onChange={(e) => {
                const state_name = e.target.value;
                const opt = stateOptions.find((s) => s.valueKey === state_name);
                onChange({
                  ...value,
                  state_name: opt?.label || state_name,
                  emergency_room_id: '',
                  locality: '',
                  room_label: '',
                });
              }}
            >
              <option value="">{tx('x.select2')}</option>
              {stateOptions.map((s) => (
                <option key={s.valueKey} value={s.valueKey}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className={labelClass}>{tx('x.errRoom')}</label>
            <select
              className={selectClass}
              value={value.emergency_room_id}
              disabled={!value.state_name}
              onChange={(e) => {
                const id = e.target.value;
                const room = rooms.find((r) => r.id === id);
                const place = room ? placeLabels(room, locale) : { state_name: '', locality: '' };
                onChange({
                  ...value,
                  emergency_room_id: id,
                  locality: place.locality,
                  state_name: place.state_name || value.state_name,
                  room_label: room ? roomLabel(room, locale) : '',
                });
              }}
            >
              <option value="">{tx('x.select2')}</option>
              {roomsInState.map((r) => (
                <option key={r.id} value={r.id}>
                  {roomLabel(r, locale)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div>
          <label className={labelClass}>{tx('x.errRoom')}</label>
          <div className={`${selectClass} bg-[#1c2d48] text-[#a8b6cc] truncate`}>
            {value.room_label || tx('x.yourRoom')}
          </div>
        </div>
      )}

      {value.emergency_room_id && (
        <div>
          <label className={labelClass}>{tx('x.fundProject')}</label>
          {projects === null ? (
            <p className="text-sm text-[#a8b6cc]">{tx('x.loadingOptions')}</p>
          ) : projectsError ? (
            <div className="rounded-xl bg-red-500/10 border border-red-400/30 text-red-300 px-3 py-2 text-sm">
              {projectsError}
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 text-amber-200 px-3 py-2 text-sm">
              {tx('x.noProjectOpen')}
            </div>
          ) : (
            <>
              <select
                className={selectClass}
                value={value.working_group_id}
                onChange={(e) => {
                  const g = projects.find((x) => x.id === e.target.value);
                  onChange({ ...value, working_group_id: g?.id || '', working_group_label: g ? projectLabel(g) : '' });
                }}
              >
                {projects.length > 1 && <option value="">{tx('x.select2')}</option>}
                {projects.map((g) => (
                  <option key={g.id} value={g.id}>
                    {projectLabel(g)}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[#8a97ab] mt-1 mb-0">{tx('x.fundProjectHint')}</p>
            </>
          )}
        </div>
      )}

      {showOrganization ? (
        <div className={`grid grid-cols-2 ${gap}`}>
          {canSetSegment && (
          <div className="min-w-0">
            <label className={labelClass}>{tx('x.grantSegmentOptional')}</label>
            <select
              className={selectClass}
              value={value.grant_segment}
              onChange={(e) => onChange({ ...value, grant_segment: e.target.value })}
            >
              <option value="">{tx('x.select2')}</option>
              {segments.map((s) => (
                <option key={s.id} value={s.code}>
                  {segmentLabel(s)}
                </option>
              ))}
            </select>
          </div>
          )}
          <div className="min-w-0">
            <label className={labelClass}>{tx('x.organization')}</label>
            <select
              className={selectClass}
              value={value.organization_id}
              onChange={(e) => {
                const id = e.target.value;
                const org = organizations.find((o) => o.id === id);
                onChange({
                  ...value,
                  organization_id: id,
                  organization_label: org ? org.name : '',
                });
              }}
            >
              <option value="">{tx('x.select2')}</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {orgLabel(o)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : canSetSegment ? (
        <div>
          <label className={labelClass}>{tx('x.grantSegmentOptional')}</label>
          <select
            className={selectClass}
            value={value.grant_segment}
            onChange={(e) => onChange({ ...value, grant_segment: e.target.value })}
          >
            <option value="">{tx('x.select2')}</option>
            {segments.map((s) => (
              <option key={s.id} value={s.code}>
                {segmentLabel(s)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

function placeLabels(room: RoomRow, locale: string) {
  const st = room.states;
  if (!st) return { state_name: '', locality: '' };
  const ar = !!locale?.startsWith('ar');
  return {
    state_name: ar
      ? st.state_name_ar || st.state_name || ''
      : st.state_name || st.state_name_ar || '',
    locality: ar
      ? st.locality_ar || st.locality || ''
      : st.locality || st.locality_ar || '',
  };
}

function roomLabel(room: RoomRow, locale: string) {
  const name =
    locale?.startsWith('ar') ? room.name_ar || room.name : room.name || room.name_ar;
  return [room.err_code, name].filter(Boolean).join(' · ') || room.id;
}

export function scopeIsReady(
  scope: F1ScopeValue,
  opts?: { requireOrganization?: boolean }
) {
  // Grant segment is optional: the portal or an admin assigns it after screening
  if (!scope.emergency_room_id) return false;
  // The national project the F1 requests funds from (required by the database when it is sent)
  if (!scope.working_group_id) return false;
  if (opts?.requireOrganization && !scope.organization_id) return false;
  return true;
}

export function emptyF1Scope(): F1ScopeValue {
  return {
    emergency_room_id: '',
    grant_segment: '',
    working_group_id: '',
    working_group_label: '',
    state_name: '',
    locality: '',
    room_label: '',
    organization_id: '',
    organization_label: '',
  };
}
