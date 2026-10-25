import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { db } from "../src/lib/db";

async function main() {
  const input = z
    .object({
      ADMIN_EMAIL: z.string().email(),
      ADMIN_PASSWORD: z.string().min(16).max(128),
      ADMIN_NAME: z.string().min(2).max(100),
    })
    .safeParse(process.env);
  if (!input.success)
    throw new Error(
      "Set ADMIN_EMAIL, ADMIN_PASSWORD (16+ characters), ADMIN_NAME in your local environment.",
    );
  const {
    ADMIN_EMAIL: rawEmail,
    ADMIN_PASSWORD: password,
    ADMIN_NAME: name,
  } = input.data;
  const email = rawEmail.toLowerCase().trim();
  if (await db.user.findUnique({ where: { email } }))
    throw new Error(
      "Account already exists. This command never overwrites or promotes existing users.",
    );
  const passwordHash = await hashPassword(password);
  const userId = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.user.create({
      data: { id: userId, name, email, emailVerified: true, role: "OWNER" },
    });
    await tx.account.create({
      data: {
        id: randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: passwordHash,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: userId,
        action: "owner.bootstrap",
        entityType: "User",
        entityId: userId,
        metadata: { source: "local-admin-command" },
      },
    });
  });
  console.log("Owner account created. Credentials have not been logged.");
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Admin creation failed",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
