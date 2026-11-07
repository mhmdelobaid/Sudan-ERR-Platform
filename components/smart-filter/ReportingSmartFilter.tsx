import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Eraser, Filter, X } from 'lucide-react';
import type {
  ActiveFilter,
  FilterFieldConfig,
  FilterSelectOption,
  FilterValue,
} from './types';

/** Labels starting with 'x.' are translation keys (namespace 'app'); others (state and room names) are shown as they are. */
export const tl = (t: (k: string, o?: any) => string, s?: string | null) => (s && s.startsWith('x.') ? t(s) : s || '');

export const REPORT_STATUS_OPTIONS: FilterSelectOption[] = [
  { value: 'waiting', label: 'x.waiting' },
  { value: 'partial', label: 'x.partial' },
  { value: 'in review', label: 'x.underReview' },
  { value: 'completed', label: 'x.completed' },
];

export const PROJECT_STATUS_OPTIONS: FilterSelectOption[] = [
  { value: 'active', label: 'x.active' },
  { value: 'pending', label: 'x.pending' },
  { value: 'feedback', label: 'x.changesRequested' },
  { value: 'approved', label: 'x.approved' },
  { value: 'rejected', label: 'x.rejected' },
  { value: 'closed', label: 'x.closed' },
  { value: 'completed', label: 'x.completed' },
];

const CHIP_COLORS: Record<string, string> = {
  state: 'border-sky-400/40 bg-sky-500/10',
  locality: 'border-lime-400/40 bg-lime-500/10',
  room: 'border-cyan-400/40 bg-cyan-500/10',
  project_status: 'border-brand-orange/40 bg-brand-orange/10',
  f4_status: 'border-amber-400/40 bg-amber-500/10',
  f5_status: 'border-emerald-400/40 bg-emerald-500/10',
  date_range: 'border-violet-400/40 bg-violet-500/10',
  transfer_date_range: 'border-fuchsia-400/40 bg-fuchsia-500/10',
};

type Props = {
  fields: FilterFieldConfig[];
  filters: ActiveFilter[];
  onFiltersChange: (filters: ActiveFilter[]) => void;
  /** Cascading options e.g. localities for selected states */
  chipOptionsByFieldId?: Partial<Record<string, FilterSelectOption[]>>;
  title?: string;
  count?: number;
};

function newFilterId() {
  return `f_${Math.random().toString(36).slice(2, 9)}`;
}

function emptyValue(type: FilterFieldConfig['type']): FilterValue {
  if (type === 'multi_select') return [];
  if (type === 'date_range') return ['', ''];
  return '';
}

function MultiSelectPanel({
  options,
  selected,
  onChange,
}: {
  options: FilterSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { t: tx } = useTranslation('app');
  const allSelected =
    options.length > 0 && options.every((o) => selected.includes(o.value));

  return (
    <div className="absolute z-30 mt-1 min-w-[11rem] max-h-56 overflow-y-auto rounded-lg border border-white/15 bg-[#1c2d48] p-2 shadow-lift">
      <button
        type="button"
        className="mb-1 w-full rounded-md px-2 py-1 text-start text-[11px] font-semibold text-[#a8b6cc] hover:bg-white/5"
        onClick={() => onChange(allSelected ? [] : options.map((o) => o.value))}
      >
        {allSelected ? tx('x.clearAll') : tx('x.selectAll')}
      </button>
      {options.map((opt) => {
        const checked = selected.includes(opt.value);
        return (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-white hover:bg-white/5"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() =>
                onChange(
                  checked
                    ? selected.filter((v) => v !== opt.value)
                    : [...selected, opt.value]
                )
              }
              className="rounded border-white/30"
            />
            {tl(tx, opt.label)}
          </label>
        );
      })}
      {options.length === 0 && (
        <p className="px-2 py-1 text-[11px] text-[#8a97ab]">{tx('x.noOptions')}</p>
      )}
    </div>
  );
}

export default function ReportingSmartFilter({
  fields,
  filters,
  onFiltersChange,
  chipOptionsByFieldId,
  title,
  count,
}: Props) {
  const { t: tx } = useTranslation('app');
  const [addOpen, setAddOpen] = useState(false);
  const [openMultiId, setOpenMultiId] = useState<string | null>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!addRef.current?.contains(target)) setAddOpen(false);
      if (!chipsRef.current?.contains(target)) setOpenMultiId(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const activeFieldIds = useMemo(
    () => new Set(filters.map((f) => f.fieldId)),
    [filters]
  );

  const toggleField = (field: FilterFieldConfig, enabled: boolean) => {
    if (enabled) {
      if (activeFieldIds.has(field.id)) return;
      onFiltersChange([
        ...filters,
        { id: newFilterId(), fieldId: field.id, value: emptyValue(field.type) },
      ]);
    } else {
      onFiltersChange(filters.filter((f) => f.fieldId !== field.id));
    }
  };

  const updateFilter = (id: string, value: FilterValue) => {
    onFiltersChange(filters.map((f) => (f.id === id ? { ...f, value } : f)));
  };

  const removeFilter = (id: string) => {
    onFiltersChange(filters.filter((f) => f.id !== id));
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {title && (
            <p className="text-sm font-semibold text-white mb-0 truncate">
              {title}
              {typeof count === 'number' ? (
                <span className="text-[#8a97ab] font-medium"> ({count})</span>
              ) : null}
            </p>
          )}
        </div>
        <div className="relative" ref={addRef}>
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 bg-[#1c2d48] px-2.5 text-xs font-semibold text-[#a8b6cc] hover:text-white"
          >
            <Filter className="h-3.5 w-3.5" />
            {tx('x.addFilter')}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {addOpen && (
            <div className="absolute end-0 z-30 mt-1 w-56 max-h-72 overflow-y-auto rounded-lg border border-white/15 bg-[#1c2d48] p-2 shadow-lift">
              {fields.map((field) => {
                const checked = activeFieldIds.has(field.id);
                return (
                  <label
                    key={field.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-white hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleField(field, e.target.checked)}
                      className="rounded border-white/30"
                    />
                    {tl(tx, field.label)}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {filters.length > 0 && (
        <div ref={chipsRef} className="flex flex-wrap items-center gap-2">
          {filters.map((filter) => {
            const field = fields.find((f) => f.id === filter.fieldId);
            if (!field) return null;
            const options =
              chipOptionsByFieldId?.[field.id] ?? field.options ?? [];
            const color =
              CHIP_COLORS[field.id] ?? 'border-white/15 bg-[#1c2d48]';
            const localityDisabled =
              field.id === 'locality' &&
              !filters.some(
                (f) =>
                  f.fieldId === 'state' &&
                  Array.isArray(f.value) &&
                  f.value.length > 0
              );

            return (
              <div
                key={filter.id}
                className={`relative inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-full border px-2.5 py-1 ${color}`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#a8b6cc]">
                  {tl(tx, field.label)}
                </span>

                {field.type === 'select' && (
                  <select
                    value={typeof filter.value === 'string' ? filter.value : ''}
                    onChange={(e) => updateFilter(filter.id, e.target.value)}
                    className="max-w-[9rem] rounded-md border-0 bg-transparent py-0.5 text-xs font-semibold text-white outline-none"
                  >
                    <option value="" className="bg-[#1c2d48]">
                      {tl(tx, field.placeholder) || tx('x.any')}
                    </option>
                    {options.map((o) => (
                      <option key={o.value} value={o.value} className="bg-[#1c2d48]">
                        {tl(tx, o.label)}
                      </option>
                    ))}
                  </select>
                )}

                {field.type === 'multi_select' && (
                  <div className="relative">
                    <button
                      type="button"
                      disabled={localityDisabled}
                      onClick={() =>
                        setOpenMultiId((id) =>
                          id === filter.id ? null : filter.id
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-md text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {Array.isArray(filter.value) && filter.value.length > 0
                        ? filter.value.length === 1
                          ? tl(tx, options.find((o) => o.value === filter.value[0])
                              ?.label) || String(filter.value[0])
                          : tx('x.nSelected', { count: filter.value.length })
                        : tl(tx, field.placeholder) || tx('x.all')}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {openMultiId === filter.id && !localityDisabled && (
                      <MultiSelectPanel
                        options={options}
                        selected={
                          Array.isArray(filter.value)
                            ? filter.value.map(String)
                            : []
                        }
                        onChange={(next) => {
                          updateFilter(filter.id, next);
                        }}
                      />
                    )}
                  </div>
                )}

                {field.type === 'date_range' && (
                  <span className="inline-flex items-center gap-1 text-xs text-white">
                    <input
                      type="date"
                      value={
                        Array.isArray(filter.value) ? String(filter.value[0] || '') : ''
                      }
                      onChange={(e) => {
                        const to =
                          Array.isArray(filter.value) ? String(filter.value[1] || '') : '';
                        updateFilter(filter.id, [e.target.value, to]);
                      }}
                      className="rounded-md border border-white/10 bg-[#122038] px-1 py-0.5 text-[11px] text-white outline-none"
                    />
                    <span className="text-[#8a97ab]">–</span>
                    <input
                      type="date"
                      value={
                        Array.isArray(filter.value) ? String(filter.value[1] || '') : ''
                      }
                      onChange={(e) => {
                        const from =
                          Array.isArray(filter.value) ? String(filter.value[0] || '') : '';
                        updateFilter(filter.id, [from, e.target.value]);
                      }}
                      className="rounded-md border border-white/10 bg-[#122038] px-1 py-0.5 text-[11px] text-white outline-none"
                    />
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => removeFilter(filter.id)}
                  className="rounded-full p-0.5 text-[#8a97ab] hover:text-white"
                  aria-label={tx('x.remove', { v0: tl(tx, field.label) })}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => onFiltersChange([])}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#8a97ab] hover:text-brand-orange"
          >
            <Eraser className="h-3.5 w-3.5" />
            {tx('x.clearAll')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Build field configs for F4 or F5 project pickers */
export function getReportingFilterFields(opts: {
  reportKind: 'f4' | 'f5';
  stateOptions: FilterSelectOption[];
  localityOptions: FilterSelectOption[];
  roomOptions?: FilterSelectOption[];
}): FilterFieldConfig[] {
  const reportStatusField: FilterFieldConfig =
    opts.reportKind === 'f4'
      ? {
          id: 'f4_status',
          label: 'x.f4Status',
          type: 'select',
          options: REPORT_STATUS_OPTIONS,
          placeholder: 'x.any',
        }
      : {
          id: 'f5_status',
          label: 'x.f5Status',
          type: 'select',
          options: REPORT_STATUS_OPTIONS,
          placeholder: 'x.any',
        };

  const fields: FilterFieldConfig[] = [
    {
      id: 'state',
      label: 'x.state',
      type: 'multi_select',
      options: opts.stateOptions,
      placeholder: 'x.allStates',
    },
    {
      id: 'locality',
      label: 'x.locality',
      type: 'multi_select',
      options: opts.localityOptions,
      placeholder: 'x.allLocalities',
    },
  ];

  if ((opts.roomOptions?.length || 0) > 0) {
    fields.push({
      id: 'room',
      label: 'x.room',
      type: 'select',
      options: opts.roomOptions || [],
      placeholder: 'x.allRooms',
    });
  }

  fields.push(
    {
      id: 'project_status',
      label: 'x.projectStatus',
      type: 'multi_select',
      options: PROJECT_STATUS_OPTIONS,
      placeholder: 'x.allStatuses',
    },
    reportStatusField,
    {
      id: 'date_range',
      label: 'x.dateRange',
      type: 'date_range',
    },
    {
      id: 'transfer_date_range',
      label: 'x.dateTransferRange',
      type: 'date_range',
    }
  );

  return fields;
}

/** Serialize active filters into API query params */
export function filtersToQueryParams(filters: ActiveFilter[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of filters) {
    if (f.fieldId === 'state' && Array.isArray(f.value) && f.value.length) {
      out.state = f.value.map(String).join('|');
    }
    if (f.fieldId === 'locality' && Array.isArray(f.value) && f.value.length) {
      out.locality = f.value.map(String).join('|');
    }
    if (f.fieldId === 'room' && typeof f.value === 'string' && f.value) {
      out.room_id = f.value;
    }
    if (f.fieldId === 'project_status' && Array.isArray(f.value) && f.value.length) {
      out.status = f.value.map(String).join('|');
    }
    if (f.fieldId === 'f4_status' && typeof f.value === 'string' && f.value) {
      out.f4_status = f.value;
    }
    if (f.fieldId === 'f5_status' && typeof f.value === 'string' && f.value) {
      out.f5_status = f.value;
    }
    if (f.fieldId === 'date_range' && Array.isArray(f.value)) {
      const [from, to] = f.value.map(String);
      if (from) out.date_from = from;
      if (to) out.date_to = to;
    }
    if (f.fieldId === 'transfer_date_range' && Array.isArray(f.value)) {
      const [from, to] = f.value.map(String);
      if (from) out.transfer_from = from;
      if (to) out.transfer_to = to;
    }
  }
  return out;
}
