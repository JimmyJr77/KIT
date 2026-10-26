export const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','GU','VI'];

export const EMPTY_LOCATION = { intl: false, city: '', state: '', country: 'United States' };

export const locationLabel = (l = {}) => [l.city, l.state, l.intl ? l.country : null].filter(Boolean).join(', ');
export const locationKey = (l = {}) => `${l.intl ? 1 : 0}|${(l.city || '').trim().toLowerCase()}|${(l.state || '').trim().toLowerCase()}|${l.intl ? (l.country || '').toLowerCase() : ''}`;

/** Domestic: City, State. International: City, State/Province, Country. */
export default function LocationInput({ label, value = EMPTY_LOCATION, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="label mb-0">{label}</span>
        <div className="flex rounded-md bg-slate-100 p-0.5 text-xs">
          {[['Domestic', false], ['International', true]].map(([t, intl]) => (
            <button key={t} type="button"
              className={`rounded px-2 py-0.5 ${value.intl === intl ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500'}`}
              onClick={() => onChange({ ...value, intl, state: '', country: intl ? '' : 'United States' })}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className={`grid gap-2 ${value.intl ? 'grid-cols-3' : 'grid-cols-[1fr_6rem]'}`}>
        <input className="input" placeholder="City" value={value.city} onChange={(e) => set('city', e.target.value)} />
        {value.intl ? (
          <>
            <input className="input" placeholder="State / Province" value={value.state} onChange={(e) => set('state', e.target.value)} />
            <input className="input" placeholder="Country" value={value.country} onChange={(e) => set('country', e.target.value)} />
          </>
        ) : (
          <select className="input" value={value.state} onChange={(e) => set('state', e.target.value)}>
            <option value="">State</option>
            {US_STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}
