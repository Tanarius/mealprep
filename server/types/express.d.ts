/**
 * Passport's @types declare `namespace Express { interface User {} }` (an empty
 * interface), so `req.user` is typed as `Express.User | undefined` with no fields.
 * This augmentation merges our real User row type into it, making `req.user`
 * fully typed everywhere — `req.user!.householdId` instead of `(req.user as any)`.
 *
 * (An earlier version of this declaration lived inside middleware/aiRateLimit.ts,
 * where a same-file `User` import shadowed the global `Express.User` merge target
 * and the codebase kept casting out of habit. It lives here now, alone, so nothing
 * shadows it.)
 */
import type { User as AppUser } from "@shared/schema";

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface User extends AppUser {}
  }
}

export {};
