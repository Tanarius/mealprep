import { Request, Response, NextFunction } from "express";
import type { User as AppUser } from "@shared/schema";

/** Drop-in middleware — returns 401 if the request isn't authenticated. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });
  next();
}

/**
 * The authenticated user, with householdId narrowed to number. Every authenticated
 * user has a household — registration assigns one and GET /api/household
 * auto-repairs the legacy gap — but the DB column is nullable, so the schema type
 * can't express that. This single documented assertion replaces the blanket
 * `(req.user as any)` casts that used to hide the invariant. Only call it behind
 * requireAuth (or an equivalent isAuthenticated() check).
 */
export function authedUser(req: Request): AppUser & { householdId: number } {
  return req.user as AppUser & { householdId: number };
}

/**
 * Validates a URL is safe to fetch (no SSRF to internal networks).
 * Returns true if the URL is safe, false otherwise.
 */
export function isSafeUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    // Block loopback, private ranges, link-local, AWS metadata
    if (
      host === "localhost" ||
      host === "::1" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
      /^169\.254\./.test(host) ||   // link-local / AWS metadata
      host === "0.0.0.0" ||
      host === "metadata.google.internal"
    ) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Classifies a resolved IP address (IPv4 or IPv6) as private/internal — loopback,
 * link-local, private/ULA ranges, or unspecified. Used after DNS resolution to catch a
 * public hostname that resolves to an internal address (which isSafeUrl's string check
 * cannot see). Unparseable input is treated as unsafe (returns true).
 */
export function isPrivateAddress(ip: string): boolean {
  let addr = ip.trim().toLowerCase();
  // Unwrap IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) so the IPv4 rules apply.
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) addr = mapped[1];

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(addr)) {
    const [a, b] = addr.split(".").map(Number);
    if ([a, b].some(n => Number.isNaN(n) || n > 255)) return true; // malformed → unsafe
    if (a === 0) return true;                          // 0.0.0.0/8 unspecified / "this host"
    if (a === 127) return true;                        // 127.0.0.0/8 loopback
    if (a === 10) return true;                         // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local / metadata
    return false;
  }

  // IPv6
  if (addr === "::" || addr === "::1") return true;    // unspecified / loopback
  if (/^fe[89ab]/.test(addr)) return true;             // fe80::/10 link-local
  if (/^f[cd]/.test(addr)) return true;                // fc00::/7 unique-local (fc.. / fd..)
  return false;
}
