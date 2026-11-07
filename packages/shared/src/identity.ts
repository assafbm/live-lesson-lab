// Server-only entry point. Never import this from the browser protocol barrel.
import { CognitoJwtVerifier } from "aws-jwt-verify";

export type VerifiedIdentity = { userId: string; email: string; expiresAt: number };
// Invitation guests have a connection-scoped identity, never a verified email.
// Keeping the union explicit prevents guest attendance granting recording access.
export type LessonIdentity = VerifiedIdentity | { userId: string; expiresAt: number; guest: true };
export function identityFromVerifiedClaims(claims: Record<string, unknown>): VerifiedIdentity {
  if (typeof claims.sub !== "string" || !claims.sub || claims.email_verified !== true
    || typeof claims.email !== "string" || !claims.email || typeof claims.exp !== "number"
    || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("Verified email identity required");
  return { userId: claims.sub, email: claims.email, expiresAt: claims.exp };
}

export function createIdentityVerifier(userPoolId: string, clientId: string) {
  // Signature, issuer, audience/client, token use and expiration are all checked
  // by the Cognito verifier. Decoding a JWT without verification is insufficient.
  const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: "id" });
  return async (token: string): Promise<VerifiedIdentity> => identityFromVerifiedClaims(await verifier.verify(token));
}
