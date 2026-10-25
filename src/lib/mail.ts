import nodemailer from "nodemailer";
export async function sendMail(message: {
  to: string;
  subject: string;
  text: string;
  messageId?: string;
}) {
  if (!process.env.SMTP_HOST) throw new Error("SMTP_NOT_CONFIGURED");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 1025),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  const result = await transport.sendMail({
    from: process.env.EMAIL_FROM || "FRAME STUDIO <studio@frame.test>",
    ...message,
  });
  if (!result.accepted?.length) throw new Error("SMTP_REJECTED");
  // SMTP acceptance is not a delivery receipt.
  return { messageId: result.messageId, accepted: true };
}
