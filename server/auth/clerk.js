// Clerk sign-in (Google, email code, SMS OTP). Loaded only when both keys are present.
import { config } from '../config.js';
import { fail, normalizePhone, normalizeEmail } from '../lib/util.js';

/** The publishable key is "pk_test_" + base64("<frontend-api-host>$"). */
export function clerkFrontendApi(publishableKey = config.clerk.publishableKey) {
  const encoded = String(publishableKey).split('_')[2];
  if (!encoded) return null;
  const host = Buffer.from(encoded, 'base64').toString('utf8').replace(/\$$/, '');
  return /^[a-z0-9.-]+$/i.test(host) ? host : null;
}

let sdk;
async function clerkSdk() {
  sdk ||= await import('@clerk/backend');
  return sdk;
}

/** Verifies a Clerk session token and returns the person's verified phone numbers and emails. */
export async function identityFromToken(token, requestOrigin) {
  if (!config.clerk.enabled) fail(404, 'clerk_disabled');
  const { verifyToken, createClerkClient } = await clerkSdk();
  let claims;
  try {
    claims = await verifyToken(token, { secretKey: config.clerk.secretKey });
  } catch {
    fail(401, 'clerk_token_invalid');
  }
  // verifyToken resolves to the claims, older releases to { data, errors }.
  claims = claims?.data ?? claims;
  if (!claims?.sub) fail(401, 'clerk_token_invalid');
  const allowed = [requestOrigin, new URL(config.publicBaseUrl).origin];
  if (claims.azp && !allowed.includes(claims.azp)) fail(401, 'clerk_token_wrong_origin');

  const client = createClerkClient({ secretKey: config.clerk.secretKey });
  const user = await client.users.getUser(claims.sub);
  const verified = (items) => (items || []).filter((i) => i.verification?.status === 'verified');

  return {
    clerkUserId: user.id,
    phones: verified(user.phoneNumbers).map((p) => normalizePhone(p.phoneNumber)).filter(Boolean),
    emails: verified(user.emailAddresses).map((e) => normalizeEmail(e.emailAddress)).filter(Boolean),
    // A username-only account has no verified phone or email, so it is never linked automatically.
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || null,
  };
}
