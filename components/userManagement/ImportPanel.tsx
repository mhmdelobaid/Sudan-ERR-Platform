// Import a list of people (name, email, position, room) as pending accounts. Superadmin only.
// 1. paste from Sheets/Excel or choose a CSV  2. check every row and fix what's wrong  3. import in small batches.
// No email goes out here: each person gets their password link when an admin activates them.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import {
    IMPORT_ROLES, IMPORT_ROOM_FOR, ImportRole, ImportRoom, guessRole, matchRoom, parseList, roomLabel, templateCsv,
} from '../../services/accountImport';

interface Draft {
    key: number;
    row: number;
    name: string;
    email: string;
    position: string;
    roomText: string;
    role: ImportRole | '';
    err_id: string;
    roomInput: string;
    candidates: number;
    problems: string[];
    result?: 'created' | 'failed';
    resultCode?: string;
}

interface Props {
    rooms: ImportRoom[];
    isAr: boolean;
    t: TFunction;
    getHeaders: () => Promise<Record<string, string> | null>;
    onClose: () => void;
    onImported: () => void;
}

const BATCH = 20;
const input = 'w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-blue';

function newId(): string {
    try { return crypto.randomUUID(); } catch { return ''; }
}

const ImportPanel: React.FC<Props> = ({ rooms, isAr, t, getHeaders, onClose, onImported }) => {
    const [text, setText] = useState('');
    const [rows, setRows] = useState<Draft[]>([]);
    const [phase, setPhase] = useState<'input' | 'review' | 'importing' | 'done'>('input');
    const [checking, setChecking] = useState(false);
    const [onlyProblems, setOnlyProblems] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [error, setError] = useState('');
    const [version, setVersion] = useState(0);        // bumped when a row is edited, to check again
    const fileRef = useRef<HTMLInputElement>(null);

    const roomById = useMemo(() => new Map(rooms.map(r => [r.id, r])), [rooms]);
    const roomsByType = useMemo(() => {
        const out: Record<string, ImportRoom[]> = { base: [], locality: [], state: [], any: rooms };
        rooms.forEach(r => { if (r.type && out[r.type]) out[r.type].push(r); });
        return out;
    }, [rooms]);
    const labelOf = (r: ImportRoom) => roomLabel(r, isAr);

    // ---------- reading the list ----------
    const readFile = (file: File) => {
        setError('');
        if (/\.(xlsx|xls|ods)$/i.test(file.name)) { setError(t('import.saveAsCsv')); return; }
        const reader = new FileReader();
        reader.onload = () => setText(String(reader.result || ''));
        reader.onerror = () => setError(t('import.fileError'));
        reader.readAsText(file, 'utf-8');
    };

    const downloadTemplate = () => {
        const blob = new Blob([templateCsv(isAr)], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = isAr ? 'قائمة-الحسابات.csv' : 'accounts-list.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    const startReview = () => {
        setError('');
        const { rows: parsed } = parseList(text);
        if (parsed.length === 0) { setError(t('import.nothingToRead')); return; }
        if (parsed.length > 2000) { setError(t('import.tooMany')); return; }
        setRows(parsed.map((p, i) => {
            const role = guessRole(p.position) || '';
            const m = matchRoom(rooms, p.roomText, role || null);
            return {
                key: i, ...p, role, err_id: m.room?.id || '', roomInput: m.room ? labelOf(m.room) : p.roomText,
                candidates: m.candidates, problems: [],
            };
        }));
        setPhase('review');
        setVersion(v => v + 1);
    };

    // ---------- checking (the database decides) ----------
    const latest = useRef(rows);
    latest.current = rows;
    useEffect(() => {
        if (phase !== 'review' || version === 0) return;
        const timer = setTimeout(async () => {
            const current = latest.current;
            if (current.length === 0) return;
            setChecking(true);
            try {
                const headers = await getHeaders();
                if (!headers) throw new Error('unauthorized');
                const res = await fetch('/api/user-import', {
                    method: 'POST', headers,
                    body: JSON.stringify({ action: 'check', rows: current.map(r => ({ row: r.row, name: r.name, email: r.email, role: r.role, err_id: r.err_id || null })) }),
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.code);
                setRows(prev => prev.map((r, i) => {
                    const server: string[] = data.results?.[i]?.problems || [];
                    // Say what the admin can act on: an unknown position or a room name we couldn't match.
                    const problems = server.map(p => {
                        if (p === 'invalid_role' && !r.role) return r.position ? 'position_unknown' : 'position_missing';
                        if (p === 'room_required' && r.roomText && !r.err_id) return r.candidates > 1 ? 'room_ambiguous' : 'room_not_matched';
                        return p;
                    });
                    return { ...r, problems };
                }));
            } catch (e: any) {
                setError(t(`errors.${e?.message || 'server_error'}`, { defaultValue: t('errors.server_error') }));
            } finally {
                setChecking(false);
            }
        }, 450);
        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version, phase]);

    const edit = (key: number, patch: Partial<Draft>) => {
        setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));
        setVersion(v => v + 1);
    };
    const changeRole = (r: Draft, role: ImportRole | '') => {
        const need = role ? IMPORT_ROOM_FOR[role] : 'any';
        const cur = r.err_id ? roomById.get(r.err_id) : undefined;
        if (need === null) { edit(r.key, { role, err_id: '', roomInput: '' }); return; }
        if (cur && (need === 'any' || cur.type === need)) { edit(r.key, { role }); return; }
        const m = matchRoom(rooms, r.roomText, role || null);
        edit(r.key, { role, err_id: m.room?.id || '', roomInput: m.room ? labelOf(m.room) : r.roomText, candidates: m.candidates });
    };
    const changeRoom = (r: Draft, value: string) => {
        const need = r.role ? IMPORT_ROOM_FOR[r.role] : 'any';
        const pool = roomsByType[need === null ? 'any' : need] || rooms;
        const found = pool.find(x => labelOf(x) === value);
        edit(r.key, { roomInput: value, err_id: found?.id || '', roomText: found ? r.roomText : value, candidates: found ? 1 : 0 });
    };
    const removeRow = (key: number) => { setRows(prev => prev.filter(r => r.key !== key)); setVersion(v => v + 1); };

    const ready = rows.filter(r => r.problems.length === 0);
    const needFix = rows.filter(r => r.problems.length > 0);
    const exists = rows.filter(r => r.problems.includes('email_exists'));
    const shown = onlyProblems ? needFix : rows;

    // ---------- importing ----------
    const runImport = async () => {
        setConfirming(false); setError('');
        const todo = latest.current.filter(r => r.problems.length === 0);
        if (todo.length === 0) return;
        setPhase('importing');
        setProgress({ done: 0, total: todo.length });
        const batchId = newId();
        let stopped = '';
        for (let i = 0; i < todo.length && !stopped; i += BATCH) {
            const part = todo.slice(i, i + BATCH);
            try {
                const headers = await getHeaders();
                if (!headers) throw new Error('unauthorized');
                const res = await fetch('/api/user-import', {
                    method: 'POST', headers,
                    body: JSON.stringify({ action: 'import', batch_id: batchId || undefined,
                        rows: part.map(r => ({ row: r.row, name: r.name, email: r.email, role: r.role, err_id: r.err_id || null, position: r.position })) }),
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.code);
                const byRow = new Map<number, any>((data.results || []).map((x: any) => [x.row, x]));
                setRows(prev => prev.map(r => {
                    if (!part.some(p => p.key === r.key)) return r;
                    const x = byRow.get(r.row);
                    return x?.ok ? { ...r, result: 'created' } : { ...r, result: 'failed', resultCode: x?.code || 'server_error' };
                }));
            } catch (e: any) {
                stopped = e?.message || 'server_error';
                setRows(prev => prev.map(r => (part.some(p => p.key === r.key) ? { ...r, result: 'failed', resultCode: stopped } : r)));
            }
            setProgress({ done: Math.min(i + BATCH, todo.length), total: todo.length });
        }
        if (stopped) setError(t(`errors.${stopped}`, { defaultValue: t('errors.server_error') }));
        setPhase('done');
        onImported();
    };

    const created = rows.filter(r => r.result === 'created');
    const failed = rows.filter(r => r.result === 'failed');
    const problemText = (p: string) => t(`import.problem.${p}`, { defaultValue: t(`errors.${p}`, { defaultValue: p }) });

    // ---------- view ----------
    return (
        <section className="bg-white rounded-2xl shadow-md p-4 space-y-4" aria-label={t('import.title')}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h2 className="text-lg font-bold text-gray-900 mb-0">{t('import.title')}</h2>
                    <p className="text-sm text-gray-600 mb-0">{t('import.subtitle')}</p>
                </div>
                <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700">
                    {phase === 'done' ? t('import.close') : t('cancel')}
                </button>
            </div>

            {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>}

            {phase === 'input' && (
                <div className="space-y-3">
                    <ol className="list-decimal ps-5 text-sm text-gray-700 space-y-1">
                        <li>{t('import.step1')} <button type="button" onClick={downloadTemplate} className="text-brand-blue font-semibold underline">{t('import.template')}</button></li>
                        <li>{t('import.step2')}</li>
                        <li>{t('import.step3')}</li>
                    </ol>
                    <textarea className={`${input} min-h-[160px] font-mono`} dir="auto" value={text} onChange={e => setText(e.target.value)}
                        placeholder={t('import.pastePlaceholder')} aria-label={t('import.pastePlaceholder')} />
                    <div className="flex flex-wrap items-center gap-2">
                        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
                        <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800">
                            {t('import.chooseFile')}
                        </button>
                        <button type="button" disabled={!text.trim()} onClick={startReview} className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                            {t('import.check')}
                        </button>
                    </div>
                </div>
            )}

            {phase !== 'input' && (
                <>
                    {/* Summary */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div className="rounded-xl border border-gray-200 p-2"><span className="block text-xs text-gray-500">{t('import.inList')}</span><span className="text-xl font-bold"><bdi>{rows.length}</bdi></span></div>
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2"><span className="block text-xs text-emerald-800">{phase === 'review' ? t('import.ready') : t('import.created')}</span><span className="text-xl font-bold text-emerald-900"><bdi>{phase === 'review' ? ready.length : created.length}</bdi></span></div>
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-2"><span className="block text-xs text-amber-900">{phase === 'review' ? t('import.needFix') : t('import.notCreated')}</span><span className="text-xl font-bold text-amber-900"><bdi>{phase === 'review' ? needFix.length : failed.length + needFix.filter(r => !r.result).length}</bdi></span></div>
                        <div className="rounded-xl border border-gray-200 p-2"><span className="block text-xs text-gray-500">{t('import.alreadyHave')}</span><span className="text-xl font-bold"><bdi>{exists.length}</bdi></span></div>
                    </div>

                    {phase === 'importing' && (
                        <div className="space-y-1" aria-live="polite">
                            <div className="h-3 rounded-full bg-gray-200 overflow-hidden">
                                <div className="h-full bg-brand-blue transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                            </div>
                            <p className="text-sm text-gray-700 mb-0">{t('import.importing', { done: progress.done, total: progress.total })}</p>
                        </div>
                    )}

                    {phase === 'done' && (
                        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">
                            {t('import.doneText', { count: created.length })}
                        </div>
                    )}

                    {phase === 'review' && (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} />
                                {t('import.onlyProblems')}
                            </label>
                            <span className="text-xs text-gray-500" aria-live="polite">{checking ? t('import.checking') : t('import.checked')}</span>
                        </div>
                    )}

                    {/* Room pick lists, one per room type */}
                    {(['base', 'locality', 'state', 'any'] as const).map(type => (
                        <datalist key={type} id={`um-rooms-${type}`}>
                            {(roomsByType[type] || []).map(r => <option key={r.id} value={labelOf(r)} />)}
                        </datalist>
                    ))}

                    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                        {shown.length === 0 && <li className="p-3 text-sm text-gray-600">{t('import.noProblems')}</li>}
                        {shown.map(r => {
                            const need = r.role ? IMPORT_ROOM_FOR[r.role] : 'any';
                            const locked = phase !== 'review';
                            const tone = r.result === 'created' ? 'bg-emerald-50/60' : r.result === 'failed' || (phase === 'review' && r.problems.length) ? 'bg-amber-50/60' : '';
                            return (
                                <li key={r.key} className={`p-3 grid grid-cols-1 md:grid-cols-[3rem_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto] gap-2 items-start text-sm ${tone}`}>
                                    <span className="text-xs text-gray-500 md:pt-2">{t('import.row', { n: r.row })}</span>
                                    <div className="min-w-0">
                                        {locked ? <span className="block font-semibold">{r.name || '—'}</span> : (
                                            <input className={input} value={r.name} onChange={e => edit(r.key, { name: e.target.value })} aria-label={t('field.name')} placeholder={t('field.name')} />
                                        )}
                                        {locked ? <span className="block text-xs text-gray-500 break-all" dir="ltr">{r.email}</span> : (
                                            <input className={`${input} mt-1`} dir="ltr" value={r.email} onChange={e => edit(r.key, { email: e.target.value.trim() })} aria-label={t('import.email')} placeholder={t('import.email')} />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        {r.position && <span className="block text-xs text-gray-500 truncate" title={r.position}>{t('import.listSays', { text: r.position })}</span>}
                                        <select className={input} disabled={locked} value={r.role} onChange={e => changeRole(r, e.target.value as ImportRole | '')} aria-label={t('field.role')}>
                                            <option value="">{t('import.chooseRole')}</option>
                                            {IMPORT_ROLES.map(x => <option key={x} value={x}>{t(`role.${x}`)}</option>)}
                                        </select>
                                    </div>
                                    <div className="min-w-0">
                                        {need === null ? (
                                            <span className="block text-xs text-gray-500 md:pt-2">{t('import.noRoomNeeded')}</span>
                                        ) : locked ? (
                                            <span className="block text-sm text-gray-700">{r.err_id ? labelOf(roomById.get(r.err_id) as ImportRoom) : r.roomInput || '—'}</span>
                                        ) : (
                                            <input className={input} list={`um-rooms-${need}`} value={r.roomInput} onChange={e => changeRoom(r, e.target.value)}
                                                placeholder={t('import.pickRoom')} aria-label={t('import.pickRoom')} />
                                        )}
                                        {(phase === 'review' || (phase === 'done' && !r.result)) && r.problems.length > 0 && (
                                            <ul className="mt-1 space-y-0.5">
                                                {r.problems.map(p => <li key={p} className="text-xs font-semibold text-amber-900">• {problemText(p)}</li>)}
                                            </ul>
                                        )}
                                        {r.result === 'failed' && <p className="mt-1 mb-0 text-xs font-semibold text-red-800">{problemText(r.resultCode || 'server_error')}</p>}
                                    </div>
                                    <div className="md:pt-1">
                                        {phase === 'review' && (
                                            <button type="button" onClick={() => removeRow(r.key)} className="text-xs font-semibold text-gray-600 underline">{t('import.skipRow')}</button>
                                        )}
                                        {r.result === 'created' && <span className="text-xs font-semibold text-emerald-800">{t('import.rowCreated')}</span>}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    {phase === 'review' && (
                        <div className="space-y-2">
                            {needFix.length > 0 && ready.length > 0 && <p className="text-xs text-gray-600 mb-0">{t('import.partialNote', { count: needFix.length })}</p>}
                            {!confirming ? (
                                <div className="flex flex-wrap gap-2 justify-end">
                                    <button type="button" onClick={() => { setPhase('input'); setRows([]); }} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700">{t('import.back')}</button>
                                    <button type="button" disabled={checking || ready.length === 0} onClick={() => setConfirming(true)}
                                        className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                                        {t('import.importN', { count: ready.length })}
                                    </button>
                                </div>
                            ) : (
                                <div className="rounded-xl border border-brand-blue/40 bg-blue-50 p-3 space-y-2 text-sm">
                                    <p className="mb-0">{t('import.confirm', { count: ready.length })}</p>
                                    <div className="flex flex-wrap gap-2 justify-end">
                                        <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold text-gray-700">{t('cancel')}</button>
                                        <button type="button" onClick={runImport} className="rounded-lg bg-brand-blue px-4 py-2 font-semibold text-white">{t('import.yesImport')}</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </section>
    );
};

export default ImportPanel;
