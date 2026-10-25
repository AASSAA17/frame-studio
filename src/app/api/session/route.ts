import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle } from "@/lib/http";
export async function GET(request: Request) {
  return handle(async () => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user || !session.user.emailVerified) return { user: null };
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, role: true },
    });
    return { user };
  });
}
