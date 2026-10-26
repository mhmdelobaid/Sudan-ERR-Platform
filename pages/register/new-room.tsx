import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import Image from 'next/image';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import Link from 'next/link';
import { newSupabase } from '../../services/newSupabaseClient';

const LogoImage = '/brand/err-logo.png';

interface State {
    id: string;
    state_name: string;
    state_name_ar: string;
    locality?: string;
    locality_ar?: string;
}

const NewRoom = () => {
    const [roomName, setRoomName] = useState('');
    const [roomType, setRoomType] = useState<'state' | 'locality'>('locality');
    const [states, setStates] = useState<State[]>([]);
    const [selectedState, setSelectedState] = useState('');
    const [selectedLocality, setSelectedLocality] = useState('');
    const [localities, setLocalities] = useState<{id: string, locality: string, locality_ar: string}[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const router = useRouter();
    const { t, i18n } = useTranslation('register');

    // Filled in from the sign-up page (type, state and locality already chosen there)
    const [prefillLocality, setPrefillLocality] = useState('');
    useEffect(() => {
        if (!router.isReady) return;
        const { type, state, locality } = router.query;
        if (type === 'state' || type === 'locality') setRoomType(type);
        if (typeof state === 'string') setSelectedState(state);
        if (typeof locality === 'string') setPrefillLocality(locality);
    }, [router.isReady, router.query]);

    // Fetch unique states on component mount
    useEffect(() => {
        const fetchStates = async () => {
            const { data, error } = await newSupabase
                .from('states')
                .select('id, state_name, state_name_ar')
                .order('state_name');

            if (error) {
                console.error('Error fetching states:', error);
                return;
            }

            // Remove duplicates based on state_name
            const uniqueStates = data?.filter((state, index, self) =>
                index === self.findIndex((s) => s.state_name === state.state_name)
            );

            setStates(uniqueStates || []);
        };

        fetchStates();
    }, []);

    // Fetch localities when state is selected
    useEffect(() => {
        const fetchLocalities = async () => {
            if (selectedState) {
                const { data, error } = await newSupabase
                    .from('states')
                    .select('id, locality, locality_ar')
                    .eq('state_name', states.find(s => s.id === selectedState)?.state_name)
                    .order('locality');

                if (error) {
                    console.error('Error fetching localities:', error);
                    return;
                }

                setLocalities(data || []);
                // Keep the locality chosen on the sign-up page, otherwise start empty
                setSelectedLocality(prefillLocality && (data || []).some(l => l.id === prefillLocality) ? prefillLocality : '');
            }
        };

        fetchLocalities();
    }, [selectedState, states, prefillLocality]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            // Checked step: state or locality rooms only, no duplicates, limited per hour (audit H4).
            // The room waits as inactive until an admin approves it.
            const { error: roomError } = await newSupabase.rpc('public_propose_room', {
                p_name: roomName,
                p_type: roomType,
                p_locality_id: selectedLocality,
            });

            if (roomError) {
                const code = ['room_exists', 'too_many_proposals', 'invalid_room_name', 'invalid_room_type', 'locality_not_found']
                    .find(c => (roomError.message || '').includes(c));
                setError(t(code ? `proposeErrors.${code}` : 'roomCreationError'));
                return;
            }

            setSuccess(true);
            setTimeout(() => {
                router.push('/register');
            }, 3000);

        } catch (err) {
            console.error('Room creation error:', err);
            setError(t('roomCreationError'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-gray-50">
            {/* Language Switcher - Add this block near the top */}
            <div className="flex justify-center mb-4">
                <button onClick={() => i18n.changeLanguage('en')} className="mx-2 text-blue-500 hover:underline">
                    English
                </button>
                <button onClick={() => i18n.changeLanguage('ar')} className="mx-2 text-blue-500 hover:underline">
                    العربية
                </button>
            </div>

            <div className="flex flex-col items-center mb-6">
                <Image
                    src={LogoImage}
                    alt={t('logoAlt')}
                    width={100}
                    height={100}
                    className="mb-2"
                    priority
                />
                <h1 className="text-xl font-bold text-center">{t('newRoomTitle')}</h1>
            </div>

            {success ? (
                <div className="text-center">
                    <p className="text-green-600 mb-4">{t('roomCreationSuccess')}</p>
                    <p className="text-gray-600">{t('roomPendingApproval')}</p>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="flex flex-col space-y-4 w-full max-w-xs">
                    <Input
                        type="text"
                        placeholder={t('roomNamePlaceholder')}
                        value={roomName}
                        onChange={(e) => setRoomName(e.target.value)}
                        required
                    />

                    <select
                        className="w-full p-2 border rounded"
                        value={roomType}
                        onChange={(e) => setRoomType(e.target.value as 'state' | 'locality')}
                        required
                    >
                        <option value="locality">{t('localityErr')}</option>
                        <option value="state">{t('stateErr')}</option>
                    </select>
                    <p className="text-xs text-gray-500 -mt-2 mb-0">{t('baseMembersNote')}</p>

                    <select
                        className="w-full p-2 border rounded"
                        value={selectedState}
                        onChange={(e) => setSelectedState(e.target.value)}
                        required
                    >
                        <option value="">{t('selectState')}</option>
                        {states.map((state) => (
                            <option key={state.id} value={state.id}>
                                {i18n.language === 'ar' ? state.state_name_ar : state.state_name}
                            </option>
                        ))}
                    </select>

                    {selectedState && (
                        <select
                            className="w-full p-2 border rounded"
                            value={selectedLocality}
                            onChange={(e) => setSelectedLocality(e.target.value)}
                            required
                        >
                            <option value="">{t('selectLocality')}</option>
                            {localities.map((loc) => (
                                <option key={loc.id} value={loc.id}>
                                    {i18n.language === 'ar' ? loc.locality_ar : loc.locality}
                                </option>
                            ))}
                        </select>
                    )}

                    {error && <p className="text-red-500 text-sm">{error}</p>}

                    <div className="flex flex-col space-y-2">
                        <Button
                            text={isLoading ? t('creating') : t('createRoom')}
                            type="submit"
                            disabled={isLoading}
                        />
                        <Link 
                            href="/register"
                            className="text-blue-500 hover:text-blue-700 text-center mt-4"
                        >
                            {t('backToRegister')}
                        </Link>
                    </div>
                </form>
            )}
        </div>
    );
};

export default NewRoom; 