export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function telegramMention(user: {
  telegramId: bigint;
  username: string | null;
  firstName: string;
}): string {
  if (user.username) return `@${escapeHtml(user.username)}`;
  return `<a href="tg://user?id=${user.telegramId.toString()}">${escapeHtml(user.firstName)}</a>`;
}
