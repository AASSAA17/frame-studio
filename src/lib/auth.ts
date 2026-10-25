import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "./db";
import { sendMail } from "./mail";

export const auth = betterAuth({
  appName: "FRAME STUDIO",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, url }) {
      await sendMail({
        to: user.email,
        subject: "FRAME STUDIO — восстановление доступа",
        text: `Для смены пароля откройте ссылку: ${url}\nЕсли вы не запрашивали смену пароля, проигнорируйте письмо.`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 3600,
    async sendVerificationEmail({ user, url }) {
      await sendMail({
        to: user.email,
        subject: "FRAME STUDIO — подтверждение почты",
        text: `Подтвердите адрес электронной почты: ${url}\nСсылка действует один час.`,
      });
    },
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "CLIENT", input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: process.env.TRUSTED_IP_HEADER
        ? [process.env.TRUSTED_IP_HEADER]
        : [],
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 3 },
    },
  },
});
