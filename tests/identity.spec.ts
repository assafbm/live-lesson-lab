import { test, expect } from "@playwright/test";
import { generateKeyPairSync, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { createIdentityVerifier, identityFromVerifiedClaims } from "../packages/shared/src/identity";
import { parseClientMessage } from "../packages/shared/src/index";

test("local signaling refuses production or partial identity configuration without authentication", () => {
  for (const config of [{ NODE_ENV: "production", AUTH_USER_POOL_ID: "" },
    { NODE_ENV: "development", AUTH_USER_POOL_ID: "eu-north-1_TestPool" }]) {
    const result = spawnSync(process.execPath, ["services/signaling/dist/index.js"], {
      env: { ...process.env, AUTH_CLIENT_ID: "", ...config }, encoding: "utf8", timeout: 5000
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Configure Cognito identity");
  }
});

test("identity requires verified email, subject and unexpired claims", () => {
  const claims = { sub: "account", email: "person@example.test", email_verified: true, exp: Math.floor(Date.now() / 1000) + 300 };
  expect(identityFromVerifiedClaims(claims).userId).toBe("account");
  for (const change of [{ email_verified: false }, { email_verified: "true" }, { sub: "" }, { email: "" }, { exp: 1 }]) {
    expect(() => identityFromVerifiedClaims({ ...claims, ...change })).toThrow();
  }
  expect(parseClientMessage(JSON.stringify({ type: "authenticate", token: "" }))).toBeNull();
  expect(parseClientMessage(JSON.stringify({ type: "authenticate", token: "x".repeat(16001) }))).toBeNull();
});

test("real JWT verification rejects forged signatures, issuer, audience, expiry and token use", async () => {
  // Supply a cached public key to the real library; no AWS account/network is
  // needed. Signing and claim checks are not mocked.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
  const originalCreate = CognitoJwtVerifier.create;
  (CognitoJwtVerifier as any).create = (...args: any[]) => {
    const verifier = (originalCreate as any).apply(CognitoJwtVerifier, args);
    verifier.cacheJwks({ keys: [jwk] });
    return verifier;
  };
  try {
    const verify = createIdentityVerifier("eu-north-1_TestPool", "web-client");
    const claims = { sub: "account", email: "person@example.test", email_verified: true,
      iss: "https://cognito-idp.eu-north-1.amazonaws.com/eu-north-1_TestPool", aud: "web-client",
      token_use: "id", exp: Math.floor(Date.now() / 1000) + 300 };
    const token = (change = {}, key = privateKey) => {
      const payload = [ { alg: "RS256", kid: "test-key" }, { ...claims, ...change } ]
        .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".");
      return `${payload}.${sign("RSA-SHA256", Buffer.from(payload), key).toString("base64url")}`;
    };
    expect((await verify(token())).email).toBe("person@example.test");
    for (const change of [{ aud: "attacker-client" }, { iss: "https://attacker.invalid" },
      { token_use: "access" }, { exp: 1 }, { email_verified: false }]) {
      await expect(verify(token(change))).rejects.toThrow();
    }
    const forgedKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    await expect(verify(token({}, forgedKey))).rejects.toThrow();
  } finally { CognitoJwtVerifier.create = originalCreate; }
});
