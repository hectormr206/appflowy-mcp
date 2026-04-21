import { z } from "zod";

export interface ClientConfig {
  baseUrl: string;
  gotrueUrl?: string;
  email?: string;
  password?: string;
  accessToken?: string;
  refreshToken?: string;
}

interface TokenState {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export class AppFlowyClient {
  readonly baseUrl: string;
  private gotrueUrl: string;
  private email?: string;
  private password?: string;
  private token?: TokenState;

  constructor(cfg: ClientConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.gotrueUrl = (cfg.gotrueUrl ?? `${this.baseUrl}/gotrue`).replace(/\/+$/, "");
    this.email = cfg.email;
    this.password = cfg.password;

    if (cfg.accessToken) {
      this.token = {
        accessToken: cfg.accessToken,
        refreshToken: cfg.refreshToken,
        expiresAt: decodeJwtExp(cfg.accessToken) ?? Date.now() + 60_000,
      };
    }
  }

  async ensureToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt - now > 30_000) return this.token.accessToken;

    if (this.token?.refreshToken) {
      try {
        this.token = await this.gotrue("/token?grant_type=refresh_token", {
          refresh_token: this.token.refreshToken,
        });
        return this.token.accessToken;
      } catch {
        // fall through to password login
      }
    }

    if (!this.email || !this.password) {
      throw new Error(
        "AppFlowy auth expired and no credentials to refresh. Set APPFLOWY_EMAIL + APPFLOWY_PASSWORD, or provide APPFLOWY_REFRESH_TOKEN.",
      );
    }

    this.token = await this.gotrue("/token?grant_type=password", {
      email: this.email,
      password: this.password,
    });
    return this.token.accessToken;
  }

  private async gotrue(path: string, body: unknown): Promise<TokenState> {
    const res = await fetch(`${this.gotrueUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`GoTrue ${path} failed: HTTP ${res.status} ${await res.text()}`);
    }
    const data: any = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
  }

  async request<T = unknown>(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const token = await this.ensureToken();
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`AppFlowy ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }
}

function decodeJwtExp(token: string): number | null {
  try {
    const [, payload] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

export const configFromEnv = (): ClientConfig => ({
  baseUrl: required("APPFLOWY_BASE_URL"),
  gotrueUrl: process.env.APPFLOWY_GOTRUE_URL,
  email: process.env.APPFLOWY_EMAIL,
  password: process.env.APPFLOWY_PASSWORD,
  accessToken: process.env.APPFLOWY_ACCESS_TOKEN,
  refreshToken: process.env.APPFLOWY_REFRESH_TOKEN,
});

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const _z = z; // re-export for convenience
