// components/forms/OfflineForm.tsx
// The F4 financial report, filled in with no internet. The person picks one of their projects (saved on the phone
// while they were last online and signed in), adds expenses with a receipt photo each, and saves. The report stays
// on the phone (services/offlineReports.ts) and is sent to the same tables as the online F4 once the phone is
// online and someone is signed in (services/offlineSync.ts).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../ui/Icon';
import CameraButton from '../ui/CameraButton';
import {
    OfflineExpense, OfflineReport, addReport, deletePhoto, getCachedCategories, getCachedProjects,
    newId, savePhoto, toNumber,
} from '../../services/offlineReports';
import { sendQueuedReports } from '../../services/offlineSync';

interface OfflineFormProps {
    onClose: () => void;
    onSaved: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);
const emptyExpense = (): OfflineExpense => ({
    activity: '', description: '', payment_date: '', seller: '', payment_method: 'cash', receipt_no: '', amount: '',
});

const input = 'w-full p-2 border border-gray-300 rounded-lg text-sm bg-white';
const label = 'block text-sm font-semibold text-gray-800 mb-1';
const btnGreen = 'bg-primaryGreen text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-all inline-flex items-center justify-center gap-1.5 disabled:opacity-50';
const btnLine = 'bg-white border border-gray-300 text-gray-800 py-2 px-4 rounded-lg hover:bg-gray-50 inline-flex items-center justify-center gap-1.5';

const OfflineForm: React.FC<OfflineFormProps> = ({ onClose, onSaved }) => {
    const { t, i18n } = useTranslation('offlineMode');
    const { t: tf } = useTranslation('fillForm');
    const isAr = (i18n.language || 'ar').startsWith('ar');

    const { projects } = useMemo(() => getCachedProjects(), []);
    const categories = useMemo(() => getCachedCategories(), []);

    const [projectId, setProjectId] = useState(projects.length === 1 ? projects[0].id : '');
    const [reportDate, setReportDate] = useState(today());
    const [totalGrant, setTotalGrant] = useState('');
    const [otherSources, setOtherSources] = useState('');
    const [excess, setExcess] = useState('');
    const [surplus, setSurplus] = useState('');
    const [training, setTraining] = useState('');
    const [lessons, setLessons] = useState('');
    const [expenses, setExpenses] = useState<OfflineExpense[]>([emptyExpense()]);
    const [errors, setErrors] = useState<string[]>([]);
    const [photoBusy, setPhotoBusy] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);

    // Photos are stored as soon as they're taken; if the form is closed without saving, they're removed again.
    const savedRef = useRef(false);
    const photosRef = useRef<string[]>([]);
    useEffect(() => () => {
        if (!savedRef.current) photosRef.current.forEach(id => { deletePhoto(id); });
    }, []);

    const total = expenses.reduce((s, e) => s + (toNumber(e.amount) || 0), 0);
    const roomLabel = (p: { room_name?: string; room_name_ar?: string }) =>
        (isAr ? p.room_name_ar || p.room_name : p.room_name || p.room_name_ar) || '';

    const setExpense = (i: number, patch: Partial<OfflineExpense>) =>
        setExpenses(list => list.map((e, k) => (k === i ? { ...e, ...patch } : e)));

    const removeExpense = (i: number) => {
        const id = expenses[i]?.photo_id;
        if (id) deletePhoto(id);
        setExpenses(list => (list.length === 1 ? [emptyExpense()] : list.filter((_, k) => k !== i)));
    };

    const onPhoto = async (i: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        setPhotoBusy(i);
        try {
            const old = expenses[i]?.photo_id;
            const saved = await savePhoto(file);
            photosRef.current.push(saved.id);
            if (old) deletePhoto(old);
            setExpense(i, { photo_id: saved.id, photo_name: saved.name });
        } catch {
            setErrors([t('errors.photo_not_saved')]);
        } finally {
            setPhotoBusy(null);
        }
    };

    const validate = (): string[] => {
        const problems: string[] = [];
        if (!projectId) problems.push(t('errors.project'));
        if (!reportDate) problems.push(t('errors.date'));
        const used = expenses.filter(e => e.amount.trim() || e.description.trim() || e.activity);
        if (used.length === 0) problems.push(t('errors.no_expense'));
        used.forEach(e => {
            const n = toNumber(e.amount);
            if (n === null || n <= 0) problems.push(t('errors.amount', { n: expenses.indexOf(e) + 1 }));
        });
        return problems;
    };

    const save = async () => {
        const problems = validate();
        setErrors(problems);
        if (problems.length) return;
        const project = projects.find(p => p.id === projectId)!;
        const report: OfflineReport = {
            id: newId(), version: 2, saved_at: new Date().toISOString(),
            project_id: project.id, project_name: project.name, err_id: project.err_id,
            report_date: reportDate, total_grant: totalGrant, total_other_sources: otherSources,
            excess_expenses: excess, surplus_use: surplus, training, lessons,
            expenses: expenses.filter(e => e.amount.trim() || e.description.trim() || e.activity),
            status: 'waiting', tries: 0,
        };
        setSaving(true);
        try {
            await addReport(report); // sealed on the phone when it has the key (services/offlineCrypto.ts)
            savedRef.current = true;
            // Online already? Send it straight away (it stays on the phone if that fails).
            if (navigator.onLine) sendQueuedReports().catch(() => { /* shown on the list */ });
            onSaved();
        } catch {
            setErrors([t('errors.not_saved')]);
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-40 bg-gray-700/70 flex justify-center items-start overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="offline-form-title">
            <div dir={isAr ? 'rtl' : 'ltr'} className="text-start bg-white m-3 p-4 rounded-2xl shadow-xl w-full max-w-lg">
                <div className="flex items-start justify-between gap-2 mb-1">
                    <h2 id="offline-form-title" className="text-xl font-bold text-gray-900">{t('form.title')}</h2>
                    <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800 p-1" aria-label={t('form.cancel')}>
                        <Icon name="close" size={22} />
                    </button>
                </div>
                <p className="text-sm text-gray-600 mb-4">{t('form.intro')}</p>

                {projects.length === 0 ? (
                    <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 mb-4">
                        {t('form.no_projects')}
                    </div>
                ) : (
                    <div className="mb-3">
                        <label className={label} htmlFor="off-project">{t('form.project')}</label>
                        <select id="off-project" className={input} value={projectId} onChange={e => setProjectId(e.target.value)}>
                            <option value="">{t('form.choose_project')}</option>
                            {projects.map(p => (
                                <option key={p.id} value={p.id}>
                                    {p.name}{roomLabel(p) ? ` · ${roomLabel(p)}` : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                <div className="mb-4">
                    <label className={label} htmlFor="off-date">{t('form.report_date')}</label>
                    <input id="off-date" type="date" className={input} value={reportDate} onChange={e => setReportDate(e.target.value)} />
                </div>

                <h3 className="text-base font-bold text-gray-900 mb-2">{t('form.expenses')}</h3>
                {expenses.map((e, i) => (
                    <div key={i} className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-gray-800">{t('form.expense_n', { n: i + 1 })}</span>
                            <button type="button" onClick={() => removeExpense(i)} className="text-sm text-red-700 inline-flex items-center gap-1">
                                <Icon name="delete" size={18} />{t('form.remove_expense')}
                            </button>
                        </div>
                        <div>
                            <label className={label} htmlFor={`off-act-${i}`}>{t('fields.activity')}</label>
                            {categories.length > 0 ? (
                                <select id={`off-act-${i}`} className={input} value={e.activity} onChange={ev => setExpense(i, { activity: ev.target.value })}>
                                    <option value="">{t('form.choose')}</option>
                                    {categories.map(c => (
                                        <option key={c} value={c}>{tf(`categories.${c}`, { defaultValue: c })}</option>
                                    ))}
                                </select>
                            ) : (
                                <input id={`off-act-${i}`} className={input} value={e.activity} onChange={ev => setExpense(i, { activity: ev.target.value })} />
                            )}
                        </div>
                        <div>
                            <label className={label} htmlFor={`off-desc-${i}`}>{t('fields.description')}</label>
                            <input id={`off-desc-${i}`} className={input} value={e.description} onChange={ev => setExpense(i, { description: ev.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className={label} htmlFor={`off-amt-${i}`}>{t('fields.amount')}</label>
                                <input id={`off-amt-${i}`} type="number" inputMode="decimal" min="0" className={input} value={e.amount} onChange={ev => setExpense(i, { amount: ev.target.value })} />
                            </div>
                            <div>
                                <label className={label} htmlFor={`off-pd-${i}`}>{t('fields.payment_date')}</label>
                                <input id={`off-pd-${i}`} type="date" className={input} value={e.payment_date} onChange={ev => setExpense(i, { payment_date: ev.target.value })} />
                            </div>
                            <div>
                                <label className={label} htmlFor={`off-seller-${i}`}>{t('fields.seller')}</label>
                                <input id={`off-seller-${i}`} className={input} value={e.seller} onChange={ev => setExpense(i, { seller: ev.target.value })} />
                            </div>
                            <div>
                                <label className={label} htmlFor={`off-rn-${i}`}>{t('fields.receipt_no')}</label>
                                <input id={`off-rn-${i}`} className={input} value={e.receipt_no} onChange={ev => setExpense(i, { receipt_no: ev.target.value })} />
                            </div>
                        </div>
                        <div>
                            <label className={label} htmlFor={`off-pm-${i}`}>{t('fields.payment_method')}</label>
                            <select id={`off-pm-${i}`} className={input} value={e.payment_method} onChange={ev => setExpense(i, { payment_method: ev.target.value })}>
                                <option value="cash">{t('payment_methods.cash')}</option>
                                <option value="bank_transfer">{t('payment_methods.bank_app')}</option>
                            </select>
                        </div>
                        <div>
                            <span className={label}>{t('form.receipt_photo')}</span>
                            <div className="flex flex-wrap items-center gap-2">
                                <CameraButton onChange={ev => onPhoto(i, ev)} disabled={photoBusy !== null} className={btnGreen} />
                                <label className={`${btnLine} cursor-pointer ${photoBusy !== null ? 'opacity-50 pointer-events-none' : ''}`}>
                                    <Icon name="photo_library" size={20} />{t('choose_file')}
                                    <input type="file" accept="image/*,application/pdf" className="hidden" onChange={ev => onPhoto(i, ev)} />
                                </label>
                            </div>
                            <p className="text-xs text-gray-600 mt-1 mb-0" aria-live="polite">
                                {photoBusy === i ? t('form.photo_saving')
                                    : e.photo_id ? <span className="inline-flex items-center gap-1 text-emerald-800"><Icon name="check_circle" size={16} />{t('form.photo_saved')}</span>
                                    : t('no_file_chosen')}
                            </p>
                        </div>
                    </div>
                ))}
                <button type="button" onClick={() => setExpenses(list => [...list, emptyExpense()])} className={`${btnLine} mb-4`}>
                    <Icon name="add" size={20} />{t('add_expense')}
                </button>

                <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 mb-4 text-sm flex justify-between">
                    <span className="font-semibold text-gray-800">{t('form.total_expenses')}</span>
                    <span className="font-bold tabular-nums">{total.toLocaleString('en-US')}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                        <label className={label} htmlFor="off-grant">{t('fields.total_grant')}</label>
                        <input id="off-grant" type="number" inputMode="decimal" min="0" className={input} value={totalGrant} onChange={e => setTotalGrant(e.target.value)} />
                    </div>
                    <div>
                        <label className={label} htmlFor="off-other">{t('fields.total_other_sources')}</label>
                        <input id="off-other" type="number" inputMode="decimal" min="0" className={input} value={otherSources} onChange={e => setOtherSources(e.target.value)} />
                    </div>
                </div>
                {([
                    ['off-excess', 'additional_excess_expenses', excess, setExcess],
                    ['off-surplus', 'additional_surplus_use', surplus, setSurplus],
                    ['off-training', 'additional_training_needs', training, setTraining],
                    ['off-lessons', 'lessons', lessons, setLessons],
                ] as const).map(([id, key, value, set]) => (
                    <div key={id} className="mb-3">
                        <label className={label} htmlFor={id}>{t(`fields.${key}`)}</label>
                        <textarea id={id} rows={2} className={input} value={value} onChange={e => set(e.target.value)} />
                    </div>
                ))}

                {errors.length > 0 && (
                    <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 mb-3">
                        <ul className="list-disc ps-5 mb-0">{errors.map((m, k) => <li key={k}>{m}</li>)}</ul>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row-reverse gap-2">
                    <button type="button" onClick={save} disabled={saving || projects.length === 0 || photoBusy !== null} className={btnGreen}>
                        <Icon name="save" size={20} />{t('form.save')}
                    </button>
                    <button type="button" onClick={onClose} className={btnLine}>
                        <Icon name="close" size={20} />{t('form.cancel')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OfflineForm;
