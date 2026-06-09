import { describe, it, expect, vi, beforeEach } from "vitest";
import { requestSignerOtp, signEnvelope } from "./signing";

beforeEach(() => {
  global.fetch = vi.fn();
});

const mockFetch = () => global.fetch as ReturnType<typeof vi.fn>;

const signerRaw = {
  id: "row-1",
  signer_id: "user-1",
  signer_name: "A",
  signer_email: "a@x.com",
  order_index: 0,
  status: "signed",
  routing_status: "completed",
  auth_method: "email_otp",
  consent: true,
};

const envelopeRaw = {
  id: "env-1",
  tenant_id: "t-1",
  document_id: "doc-1",
  title: "Contract",
  status: "completed",
  signing_order: "parallel",
  created_at: "2026-06-01T00:00:00Z",
  signers: [signerRaw],
};

describe("signing API client — email-OTP step-up", () => {
  it("requestSignerOtp posts to the otp/request route and normalizes the challenge", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        challenge_id: "ch-1",
        expires_at: "2026-06-01T00:10:00Z",
        dev_code: "123456",
      }),
    });

    const ch = await requestSignerOtp("env-1", "row-1");

    expect(mockFetch()).toHaveBeenCalledWith(
      "/api/sign-envelopes/env-1/signers/row-1/otp/request",
      expect.objectContaining({ method: "POST" }),
    );
    expect(ch.challengeId).toBe("ch-1");
    expect(ch.expiresAt).toBe("2026-06-01T00:10:00Z");
    expect(ch.devCode).toBe("123456");
  });

  it("requestSignerOtp omits devCode when the backend hides it", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ challenge_id: "ch-2", expires_at: "2026-06-01T00:10:00Z" }),
    });

    const ch = await requestSignerOtp("env-1", "row-1");
    expect(ch.devCode).toBeUndefined();
  });

  it("requestSignerOtp surfaces otp_rate_limited errors", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: "otp_rate_limited" }),
    });

    await expect(requestSignerOtp("env-1", "row-1")).rejects.toThrow("otp_rate_limited");
  });

  it("signEnvelope includes otp_code in the request body", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ signer: signerRaw, envelope: envelopeRaw, completed: true }),
    });

    const res = await signEnvelope("env-1", "row-1", {
      consent: true,
      typed_name: "A",
      auth_method: "email_otp",
      otp_code: "123456",
    });

    const [url, init] = mockFetch().mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/sign-envelopes/env-1/signers/row-1/sign");
    expect(JSON.parse(String(init.body))).toMatchObject({
      consent: true,
      otp_code: "123456",
      auth_method: "email_otp",
    });
    expect(res.completed).toBe(true);
    expect(res.signer.authMethod).toBe("email_otp");
  });

  it("signEnvelope surfaces otp_required (428) errors", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 428,
      json: async () => ({ error: "otp_required" }),
    });

    await expect(
      signEnvelope("env-1", "row-1", { consent: true, typed_name: "A" }),
    ).rejects.toThrow("otp_required");
  });

  it("signEnvelope surfaces otp_invalid (403) errors", async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "otp_invalid" }),
    });

    await expect(
      signEnvelope("env-1", "row-1", { consent: true, typed_name: "A", otp_code: "000000" }),
    ).rejects.toThrow("otp_invalid");
  });
});
