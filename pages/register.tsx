import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useTranslation } from 'react-i18next';
import Image from 'next/image';
import Button from '../components/ui/Button';
import { newSupabase } from '../services/newSupabaseClient';
import Link from 'next/link';

const LogoImage = '/brand/err-logo.png';

interface EmergencyRoom {
    id: string;
    name: string;
    name_ar: string | null;
    type: 'state' | 'locality';
}

interface Locality {
    locality_id: string;
    locality: string | null;
    locality_ar: string | null;
    room_id: string | null;   // the locality's active room, if it has one in the app
}

interface State {
    id: string;
    state_name: string;
    state_name_ar: string;
}

const Register = () => {
    const [emergencyRooms, setEmergencyRooms] = useState<EmergencyRoom[]>([]);
    const [selectedType, setSelectedType] = useState<'state' | 'locality' | ''>('');
    const [selectedErr, setSelectedErr] = useState('');
    const [localities, setLocalities] = useState<Locality[]>([]);
    const [selectedLocality, setSelectedLocality] = useState('');
    const [states, setStates] = useState<State[]>([]);
    const [selectedState, setSelectedState] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const router = useRouter();
    const { t, i18n } = useTranslation('register');

    // Fetch states on component mount
    useEffect(() => {
        const fetchStates = async () => {
            try {
                const { data, error } = await newSupabase
                    .from('states')
                    .select('id, state_name, state_name_ar')
                    .order('state_name');

                if (error) throw error;
                
                // Remove duplicates based on state_name
                const uniqueStates = data?.filter((state, index, self) =>
                    index === self.findIndex((s) => s.state_name === state.state_name)
                );
                
                setStates(uniqueStates || []);
            } catch (err) {
                console.error('Error fetching states:', err);
                setError(t('stateFetchError'));
            }
        };

        fetchStates();
    }, [t]);

    // Fetch ERRs when state and type are selected
    useEffect(() => {
        if (selectedState && selectedType) {
            const fetchERRs = async () => {
                try {
                    // Before login only state and locality rooms are listed, with name only (audit H4).
                    // Base ERR members are added from their locality's list.
                    const stateName = states.find(s => s.id === selectedState)?.state_name;
                    if (selectedType === 'locality') {
                        // Pick the locality; its room is found from it
                        const { data, error } = await newSupabase.rpc('public_localities', { p_state_name: stateName });
                        if (error) throw error;
                        setLocalities((data || []) as Locality[]);
                    } else {
                        // One state room per state: chosen automatically
                        const { data, error } = await newSupabase.rpc('public_rooms', { p_state_name: stateName });
                        if (error) throw error;
                        const stateRooms = ((data || []) as EmergencyRoom[]).filter(r => r.type === 'state');
                        setEmergencyRooms(stateRooms);
                        setSelectedErr(stateRooms[0]?.id || '');
                    }
                } catch (err) {
                    console.error('Error fetching ERRs:', err);
                    setError(t('errFetchError'));
                }
            };

            fetchERRs();
        }
    }, [selectedState, selectedType, t, states]);

    // Reset the choices below when the state changes
    useEffect(() => {
        setSelectedErr('');
        setSelectedType('');
        setSelectedLocality('');
        setLocalities([]);
        setEmergencyRooms([]);
    }, [selectedState]);

    // Reset the room when the type changes
    useEffect(() => {
        setSelectedErr('');
        setSelectedLocality('');
    }, [selectedType]);

    const pickedLocality = localities.find(l => l.locality_id === selectedLocality);
    const localityName = (l?: Locality) => (l ? (i18n.language === 'ar' ? l.locality_ar || l.locality : l.locality || l.locality_ar) : '') || '';
    const stateRoom = emergencyRooms[0];
    // The new-room page, filled in with what was chosen here
    const newRoomHref = `/register/new-room?type=${selectedType || 'locality'}${selectedState ? `&state=${selectedState}` : ''}${selectedLocality ? `&locality=${selectedLocality}` : ''}`;

    const handleContinue = () => {
        if (selectedErr) {
            router.push(`/register/user?err=${selectedErr}`);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-gray-50">
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
                <h1 className="text-xl font-bold text-center">{t('selectRoomTitle')}</h1>
            </div>

            <div className="flex flex-col space-y-4 w-full max-w-xs">
                {/* State Selection */}
                <div className="w-full">
                    <select
                        className="w-full p-2 border rounded"
                        value={selectedState}
                        onChange={(e) => setSelectedState(e.target.value)}
                    >
                        <option value="">{t('selectState')}</option>
                        {states.map((state) => (
                            <option key={state.id} value={state.id}>
                                {i18n.language === 'ar' ? state.state_name_ar : state.state_name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* ERR Type Selection - Only shown after state is selected */}
                {selectedState && (
                    <div className="w-full">
                        <select
                            className="w-full p-2 border rounded"
                            value={selectedType}
                            onChange={(e) => setSelectedType(e.target.value as 'state' | 'locality')}
                        >
                            <option value="">{t('selectRoomType')}</option>
                            <option value="state">{t('stateErr')}</option>
                            <option value="locality">{t('localityErr')}</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1 mb-0">{t('baseMembersNote')}</p>
                    </div>
                )}

                {/* Locality: choose the locality, its room comes with it */}
                {selectedState && selectedType === 'locality' && (
                    <div className="w-full space-y-2">
                        <select
                            className="w-full p-2 border rounded"
                            value={selectedLocality}
                            onChange={(e) => {
                                setSelectedLocality(e.target.value);
                                setSelectedErr(localities.find(l => l.locality_id === e.target.value)?.room_id || '');
                            }}
                        >
                            <option value="">{t('selectLocality')}</option>
                            {localities.map((loc) => (
                                <option key={loc.locality_id} value={loc.locality_id}>{localityName(loc)}</option>
                            ))}
                        </select>
                        {pickedLocality && !pickedLocality.room_id && (
                            <p className="text-sm text-amber-800 bg-amber-50 rounded p-2 mb-0">
                                {t('localityHasNoRoom', { locality: localityName(pickedLocality) })}{' '}
                                <Link href={newRoomHref} className="text-blue-600 underline">{t('requestLocalityRoom')}</Link>
                            </p>
                        )}
                    </div>
                )}

                {/* State: the state's room, chosen automatically */}
                {selectedState && selectedType === 'state' && (
                    stateRoom ? (
                        <p className="text-sm text-gray-700 bg-white border rounded p-2 mb-0">
                            {t('yourRoom')}: <span className="font-semibold">{i18n.language === 'ar' && stateRoom.name_ar ? stateRoom.name_ar : stateRoom.name}</span>
                        </p>
                    ) : (
                        <p className="text-sm text-amber-800 bg-amber-50 rounded p-2 mb-0">
                            {t('stateHasNoRoom')}{' '}
                            <Link href={newRoomHref} className="text-blue-600 underline">{t('requestStateRoom')}</Link>
                        </p>
                    )
                )}

                {error && <p className="text-red-500 text-sm">{error}</p>}

                {/* Continue Button */}
                <Button
                    text={t('continueWithSelected')}
                    onClick={handleContinue}
                    disabled={!selectedErr}
                />

                {/* Can't find room link */}
                <div className="text-center">
                    <Link 
                        href={newRoomHref}
                        className="text-blue-500 hover:text-blue-700"
                    >
                        {t('cantFindRoom')} {t('registerHere')}
                    </Link>
                </div>

                {/* Back to Login link */}
                <Link 
                    href="/login"
                    className="text-blue-500 hover:text-blue-700 text-center"
                >
                    {t('backToLogin')}
                </Link>
            </div>
        </div>
    );
};

export default Register; 