const MAXIMUM_EMAIL_LENGTH = 254;

/** Returns the unique, case-insensitive representation used for user lookup. */
export function canonicalizeTrainingEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Rejects clearly malformed email values without attempting to implement the
 * complete mailbox grammar. The application does not send email in this layer.
 */
export function isValidTrainingEmail(email: string): boolean {
  const canonicalEmail = canonicalizeTrainingEmail(email);
  if (canonicalEmail.length === 0 || canonicalEmail.length > MAXIMUM_EMAIL_LENGTH) {
    return false;
  }

  const emailParts = canonicalEmail.split("@");
  if (emailParts.length !== 2) {
    return false;
  }

  const [localPart, domainPart] = emailParts;
  if (
    localPart === undefined ||
    domainPart === undefined ||
    localPart.length === 0 ||
    localPart.length > 64 ||
    domainPart.length === 0 ||
    domainPart.length > 253
  ) {
    return false;
  }

  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
    canonicalEmail,
  );
}
