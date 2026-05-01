const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export interface Message {
  role: "user" | "agent";
  text: string;
  ts: Date;
}

export interface ToolCallEvent {
  tool: string;
  args: Record<string, unknown>;
  ts: Date;
}

export interface BrowserScreenshot {
  data: string;
  url: string;
  title: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`);
  return res.json();
}

export const createSession = () =>
  request<{ session_id: string }>("/api/sessions", { method: "POST" });
