export const MAIL_KINDS = ["PASSWORD_RESET", "EMAIL_VERIFY", "PENDING_VERIFY", "REGISTRATION_NOTICE", "NOTIFICATION", "FEEDBACK", "TEST", "OTHER"] as const;
export type MailKind = typeof MAIL_KINDS[number];
export const MAIL_STATUSES = ["SENDING", "ACCEPTED", "FAILED", "UNKNOWN", "SKIPPED"] as const;
export type MailStatus = typeof MAIL_STATUSES[number];
