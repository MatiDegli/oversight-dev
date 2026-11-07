import type {
  ErrorCode,
  PreviewCreated,
  PreviewDetails,
  PreviewStatus,
  PreviewTokenRequest,
  StartPreview,
} from "@contracts";
import { CommandError } from "./commands";

const errorCodes: Record<ErrorCode, true> = {
  not_found: true,
  wrong_state: true,
  slot_busy: true,
  spend_brake: true,
  not_configured: true,
  invalid_path: true,
  stale_file: true,
  not_implemented: true,
  invalid_request: true,
  internal: true,
  forbidden: true,
  too_large: true,
};
function refusal(value: unknown, status: number, lease?: string): CommandError | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("error" in value))
    return null;
  const error = value.error;
  if (
    !error ||
    typeof error !== "object" ||
    Array.isArray(error) ||
    !("code" in error) ||
    typeof error.code !== "string" ||
    !Object.hasOwn(errorCodes, error.code) ||
    !("message" in error) ||
    typeof error.message !== "string" ||
    !error.message.trim() ||
    (lease && error.message.includes(lease))
  )
    return null;
  // Keep remote copy within a short panel paragraph; check the full text for leases first.
  return new CommandError(
    status,
    error.code as ErrorCode,
    error.message.trim().slice(0, 500).trimEnd(),
  );
}

const previewId = (value: unknown): value is string =>
  typeof value === "string" && /^preview-[0-9a-f]{32}$/.test(value);
export interface PreviewValidators {
  details: (value: unknown) => PreviewDetails;
  status: (value: unknown) => PreviewStatus;
}
function path(id: string, suffix = "") {
  if (!previewId(id)) throw new Error("Invalid preview identity");
  return `/previews/${id}${suffix}`;
}
function token(body: PreviewTokenRequest): PreviewTokenRequest {
  if (!/^[A-Za-z0-9_-]{43}$/.test(body.lease_token)) throw new Error("Invalid preview lease");
  return { lease_token: body.lease_token };
}
function receipt(result: unknown): PreviewCreated {
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    Object.keys(result).sort().join(",") !== "lease_token,preview_id" ||
    !("preview_id" in result) ||
    !previewId(result.preview_id) ||
    !("lease_token" in result) ||
    typeof result.lease_token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(result.lease_token)
  )
    throw new Error("Invalid preview receipt");
  return { preview_id: result.preview_id, lease_token: result.lease_token };
}
function loopback(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
    !url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Invalid preview destination");
  return url;
}
/** Shared bounded HTTP port. Tokens remain private to the injected controller. */
export function createLivePreviewPort(
  base: string,
  validators: PreviewValidators,
  request: typeof fetch = fetch,
) {
  return new LivePreviewPort(loopback(base), validators, request);
}
class LivePreviewPort {
  constructor(
    readonly origin: URL,
    readonly validators: PreviewValidators,
    readonly request: typeof fetch,
  ) {}
  async call(
    path: string,
    signal: AbortSignal,
    body?: StartPreview | PreviewTokenRequest,
    keepalive = false,
  ): Promise<unknown> {
    let rejected: CommandError | null = null;
    try {
      const request = this.request;
      const response = await request(new URL(path, this.origin), {
        method: body ? "POST" : "GET",
        ...(keepalive
          ? { keepalive: true }
          : { signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]) }),
        ...(body && {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      if (response.status >= 400 && response.status <= 599) {
        rejected = refusal(
          await response.json(),
          response.status,
          body && "lease_token" in body ? body.lease_token : undefined,
        );
        throw new Error();
      }
      if (
        response.status !== (path === "/previews" ? 202 : 200) ||
        response.headers.get("Cache-Control") !== "no-store"
      )
        throw new Error();
      return await response.json();
    } catch {
      if (rejected) throw rejected;
      throw new Error("Preview request could not be verified");
    }
  }
  async start(input: StartPreview, signal: AbortSignal): Promise<PreviewCreated> {
    return receipt(
      await this.call("/previews", signal, {
        run_id: input.run_id,
        agent_id: input.agent_id,
        revision: input.revision,
        head_commit: input.head_commit,
      }),
    );
  }
  async details(id: string, signal: AbortSignal): Promise<PreviewDetails> {
    const result = this.validators.details(await this.call(path(id), signal));
    if (result.url !== null) {
      const url = loopback(result.url);
      if (url.port === this.origin.port) throw new Error("Preview shares backend port");
      if (url.hostname === this.origin.hostname) throw new Error("Preview shares backend hostname");
    }
    return result;
  }
  async renew(id: string, body: PreviewTokenRequest, signal: AbortSignal): Promise<PreviewStatus> {
    return this.validators.status(await this.call(path(id, "/lease"), signal, token(body)));
  }
  async stop(
    id: string,
    body: PreviewTokenRequest,
    signal: AbortSignal,
    delivery?: { keepalive: true },
  ): Promise<PreviewStatus> {
    const result = this.validators.status(
      await this.call(path(id, "/stop"), signal, token(body), delivery?.keepalive),
    );
    if (
      (result.state !== "stopped" && result.state !== "failed") ||
      result.reason === "cleanup_unverified"
    )
      throw new Error("Preview closure is unverified");
    return result;
  }
}
