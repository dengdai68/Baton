// Identity choice of the local install build (scripts/package-mac-local.mjs):
// a stable signature keeps macOS file-access grants across reinstalls.
import test from "node:test";
import assert from "node:assert/strict";
import { chooseSigningIdentity } from "../scripts/package-mac-local.mjs";

const development = { hash: "5AA5EDB4FF22E54224F1EB2479193A25D54409B8", name: "Apple Development: someone@example.com (TEAM123456)" };
const distribution = { hash: "0123456789ABCDEF0123456789ABCDEF01234567", name: "Developer ID Application: Someone (TEAM123456)" };
const listing = (...identities) => `${identities.map((identity, index) => `  ${index + 1}) ${identity.hash} "${identity.name}"`).join("\n")}\n     ${identities.length} valid identities found\n`;

test("the only development or Developer ID identity is chosen automatically", () => {
  const chosen = chooseSigningIdentity(listing(development));
  console.log("single identity →", chosen);
  assert.deepEqual(chosen, development);
  const unrelated = { hash: "FEDCBA9876543210FEDCBA9876543210FEDCBA98", name: "Some Root CA" };
  assert.deepEqual(chooseSigningIdentity(listing(unrelated, development)), development, "non-signing identities are ignored");
});

test("several identities need BATON_SIGN_IDENTITY; it matches by SHA-1 (any case) or full name", () => {
  assert.throws(() => chooseSigningIdentity(listing(development, distribution)), (error) => {
    console.log("ambiguous →", error.message.split("\n")[0]);
    return /BATON_SIGN_IDENTITY/.test(error.message) && error.message.includes(distribution.hash);
  });
  assert.deepEqual(chooseSigningIdentity(listing(development, distribution), distribution.hash.toLowerCase()), distribution);
  assert.deepEqual(chooseSigningIdentity(listing(development, distribution), ` ${development.name} `), development);
});

test("no usable identity, or an unknown requested one, fails with guidance instead of signing ad hoc", () => {
  assert.throws(() => chooseSigningIdentity("     0 valid identities found\n"), (error) => {
    console.log("empty keychain →", error.message);
    return /package:mac/.test(error.message);
  });
  assert.throws(() => chooseSigningIdentity(listing(development), "Developer ID Application: Nobody"), /没有有效的签名身份/);
});
