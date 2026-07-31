const CSRF_COOKIE_NAME =
  process.env.NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME || 'aegis_csrf';

export function readCsrfToken(
  cookieSource = typeof document === 'undefined' ? '' : document.cookie,
): string | undefined {
  for (const pair of cookieSource.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const name = decodeURIComponent(pair.slice(0, separator).trim());
    if (name === CSRF_COOKIE_NAME)
      return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return undefined;
}

export function csrfHeader(required = true): Record<string, string> {
  const token = readCsrfToken();
  if (!token && required) throw new Error('CSRF_TOKEN_MISSING');
  return token ? { 'x-csrf-token': token } : {};
}
