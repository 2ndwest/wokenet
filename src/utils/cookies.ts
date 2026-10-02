// A cookie's value, or undefined if it isn't set.
export const getCookie = (name: string) => {
  const prefix = `${name}=`;
  const found = document.cookie.split("; ").find((c) => c.startsWith(prefix));
  return found === undefined ? undefined : decodeURIComponent(found.slice(prefix.length));
};

// Sets a cookie for the whole site, kept for a year.
export const setCookie = (name: string, value: string) => {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`;
};
