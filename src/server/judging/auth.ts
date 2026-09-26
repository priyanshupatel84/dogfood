import type { UserRole } from "../../db/schema";
import { AuthError, getEffectiveRole } from "../auth-service";
import { requireSession } from "../http";
import type { SessionUser } from "../types";

export async function requireSessionAndRole(
  eventId: string,
  allowed: UserRole[],
): Promise<{ session: SessionUser; role: UserRole }> {
  const session = await requireSession();
  const role = await getEffectiveRole(session.user, eventId);
  if (!allowed.includes(role)) {
    throw new AuthError("FORBIDDEN", 403);
  }
  return { session, role };
}

export async function requireJudgeOrOwner(
  eventId: string,
  requestedJudgeId: string | undefined,
): Promise<{ session: SessionUser; role: UserRole }> {
  const session = await requireSession();
  const role = await getEffectiveRole(session.user, eventId);

  if (role === "SUPERADMIN" || role === "ORGANIZER") {
    return { session, role };
  }

  if (role === "JUDGE") {
    if (requestedJudgeId === session.user.id) {
      return { session, role };
    }
    throw new AuthError("FORBIDDEN", 403);
  }

  throw new AuthError("FORBIDDEN", 403);
}
