import "dotenv/config";
import { db } from "../src/lib/db";
import { expireHolds } from "../src/lib/domain";
import { sendMail } from "../src/lib/mail";
import type { NotificationJob } from "@prisma/client";

let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function claim(): Promise<NotificationJob | null> {
  const jobs = await db.$queryRaw<NotificationJob[]>`
    UPDATE "NotificationJob" SET "lockedUntil" = NOW() + INTERVAL '2 minutes', "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id" FROM "NotificationJob"
      WHERE "status" = 'pending' AND "scheduledAt" <= NOW()
        AND ("lockedUntil" IS NULL OR "lockedUntil" < NOW()) AND "attempts" < 6
      ORDER BY "scheduledAt" FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING *`;
  return jobs[0] || null;
}

async function runOne(job: NotificationJob) {
  const current = await db.notificationJob.findUnique({
    where: { id: job.id },
  });
  if (current?.status !== "pending") return;
  try {
    await sendMail({
      to: job.to,
      subject: job.subject,
      text: job.text,
      messageId: `<${job.id}@frame.studio.local>`,
    });
    await db.notificationJob.updateMany({
      where: { id: job.id, status: "pending" },
      data: {
        status: "sent",
        sentAt: new Date(),
        lockedUntil: null,
        lastError: null,
      },
    });
    console.log(
      JSON.stringify({ event: "notification.smtp_accepted", jobId: job.id }),
    );
  } catch {
    await db.notificationJob.updateMany({
      where: { id: job.id, status: "pending" },
      data: {
        status: job.attempts >= 6 ? "failed" : "pending",
        lockedUntil: null,
        scheduledAt: new Date(
          Date.now() + Math.min(3600, 30 * 2 ** job.attempts) * 1000,
        ),
        lastError: "SMTP_SEND_FAILED",
      },
    });
    console.error(
      JSON.stringify({
        event: "notification.send_failed",
        jobId: job.id,
        attempt: job.attempts,
      }),
    );
  }
}

async function main() {
  console.log(
    "FRAME STUDIO notification worker started. SMTP acceptance is not delivery confirmation.",
  );
  do {
    try {
      await expireHolds();
      // A process crash after final claim must not leave an exhausted job pending forever.
      await db.notificationJob.updateMany({
        where: {
          status: "pending",
          attempts: { gte: 6 },
          lockedUntil: { lt: new Date() },
        },
        data: {
          status: "failed",
          lockedUntil: null,
          lastError: "RETRIES_EXHAUSTED",
        },
      });
      for (let i = 0; i < 20 && !stopping; i++) {
        const job = await claim();
        if (!job) break;
        await runOne(job);
      }
    } catch {
      console.error(JSON.stringify({ event: "worker.iteration_failed" }));
    }
    if (process.argv.includes("--once")) break;
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (!stopping);
}
main().finally(() => db.$disconnect());
