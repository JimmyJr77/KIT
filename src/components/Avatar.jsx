import { fullName, initials } from '../lib/format.js';

const TINTS = ['bg-brand-100 text-brand-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-700', 'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700'];
const SIZES = { xs: 'h-5 w-5 text-[9px]', sm: 'h-7 w-7 text-[11px]', md: 'h-8 w-8 text-xs' };

/** A person's profile image, or their initials on a stable tint when they have none. */
export default function Avatar({ user, size = 'sm', className = '' }) {
  const box = `${SIZES[size]} shrink-0 rounded-full ${className}`;
  if (user?.avatar_url) return <img src={user.avatar_url} alt="" title={fullName(user)} className={`${box} object-cover`} />;
  return (
    <span title={fullName(user)} className={`${box} grid place-items-center font-semibold ${TINTS[(user?.id ?? 0) % TINTS.length]}`}>
      {initials(user)}
    </span>
  );
}
