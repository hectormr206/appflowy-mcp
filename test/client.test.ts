import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequestUrl, decodeJwtExp } from "../src/client.js";

// ---- decodeJwtExp ----

const makeJwt = (payload: Record<string, unknown>): string => {
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${head}.${body}.signature`;
};

test("decodeJwtExp returns exp * 1000 for numeric exp", () => {
  const token = makeJwt({ exp: 1700000000 });
  assert.equal(decodeJwtExp(token), 1700000000 * 1000);
});

test("decodeJwtExp returns null when exp missing", () => {
  const token = makeJwt({ sub: "x" });
  assert.equal(decodeJwtExp(token), null);
});

test("decodeJwtExp returns null when exp is non-numeric", () => {
  const token = makeJwt({ exp: "soon" });
  assert.equal(decodeJwtExp(token), null);
});

test("decodeJwtExp returns null for malformed token", () => {
  assert.equal(decodeJwtExp("not-a-jwt"), null);
  assert.equal(decodeJwtExp(""), null);
});

// ---- buildRequestUrl ----

test("buildRequestUrl composes baseUrl + path", () => {
  const url = buildRequestUrl("https://api.x.io", "/api/user");
  assert.equal(url.toString(), "https://api.x.io/api/user");
});

test("buildRequestUrl strips trailing slash from baseUrl", () => {
  const url = buildRequestUrl("https://api.x.io/", "/api/user");
  assert.equal(url.toString(), "https://api.x.io/api/user");
});

test("buildRequestUrl strips multiple trailing slashes", () => {
  const url = buildRequestUrl("https://api.x.io///", "/api/user");
  assert.equal(url.toString(), "https://api.x.io/api/user");
});

test("buildRequestUrl encodes query params", () => {
  const url = buildRequestUrl("https://api.x.io", "/search", {
    q: "hello world",
    limit: 10,
  });
  assert.equal(url.searchParams.get("q"), "hello world");
  assert.equal(url.searchParams.get("limit"), "10");
  assert.ok(url.toString().includes("q=hello+world") || url.toString().includes("q=hello%20world"));
});

test("buildRequestUrl skips undefined query values", () => {
  const url = buildRequestUrl("https://api.x.io", "/s", { a: "1", b: undefined });
  assert.equal(url.searchParams.get("a"), "1");
  assert.equal(url.searchParams.has("b"), false);
});

test("buildRequestUrl encodes special characters safely", () => {
  const url = buildRequestUrl("https://api.x.io", "/s", { q: "a&b=c" });
  assert.equal(url.searchParams.get("q"), "a&b=c");
});

test("buildRequestUrl handles numeric query values", () => {
  const url = buildRequestUrl("https://api.x.io", "/s", { n: 42 });
  assert.equal(url.searchParams.get("n"), "42");
});
