// States not yet in the programme ("coming states"). They are hidden from the dashboard and the
// working-group screen. To bring a state in, remove it from this list.
export const COMING_STATES = ['Red Sea', 'Gedaref', 'White Nile', 'Northern'];

// Other spellings of the same states (English variants and Arabic), so a project whose state is
// written differently is still hidden.
const ALIASES: Record<string, string[]> = {
    'Red Sea': ['البحر الأحمر', 'البحر الاحمر'],
    'Gedaref': ['Gadarif', 'Gadaref', 'Al Qadarif', 'Al Qadaref', 'Gedarif', 'القضارف'],
    'White Nile': ['النيل الأبيض', 'النيل الابيض'],
    'Northern': ['Northern State', 'الشمالية', 'الولاية الشمالية'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const HIDDEN = new Set(COMING_STATES.flatMap(s => [s, ...(ALIASES[s] || [])]).map(norm));

export const isComingState = (state: string | null | undefined) => !!state && HIDDEN.has(norm(state));
