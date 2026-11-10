// Who may change a ticket. Only its owner (the person who created it, or the deal's owner in Pipedrive) and admins
// change what's on a ticket: its fields, stage or lane, labels, milestones, documents, people, products and installments,
// and archiving it. Everyone else can read it, comment on it and ask questions, and work their own priority cards and
// activities on it. Priority accounts' hidden activity tickets keep their own rules.

/** Whether `user` may change `ticket` (a ticket row with `created_by` and `ticket_type`). */
export function canEditTicket(user, ticket) {
  if (!user || !ticket) return false;
  if (user.role === 'admin' || ticket.ticket_type === 'account') return true;
  return ticket.created_by != null && Number(ticket.created_by) === Number(user.id);
}

/** Why someone can't change a ticket, naming its owner when known. */
export function ownerOnlyMessage(ownerName) {
  return `Only ${ownerName ? `${ownerName}, the ticket’s owner,` : 'the ticket’s owner'} can change this ticket. You can still comment on it.`;
}
