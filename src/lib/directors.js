/** Whether a ticket matches a BD director choice: '' (all), 'none' (no director), or a director's id. */
export const byDirector = (value) => (t) => !value || (value === 'none' ? !t.bd_director_id : t.bd_director_id === Number(value));
