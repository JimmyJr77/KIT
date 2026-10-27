// Minimal MCP client: connects to a remote MCP server over Streamable HTTP
// (falling back to SSE) and calls a single tool.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

function headersFrom(envJson) {
  try { return envJson ? JSON.parse(envJson) : {}; } catch { return {}; }
}

// KIT only ever searches. Refuse anything that books, buys, or sends messages, even if
// it is misconfigured as the tool to call (e.g. Kiwi's "feedback-to-devs").
const UNSAFE_TOOL = /book|reserv|purchase|pay|order|contact|feedback|send|email|message|create|cancel|delete/i;

export async function callMcpTool({ url, headers, tool, args }) {
  if (UNSAFE_TOOL.test(tool)) throw new Error(`Refusing to call MCP tool "${tool}": KIT only calls search tools`);
  const requestInit = { headers: headersFrom(headers) };
  const client = new Client({ name: 'kit', version: '0.1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit }));
  } catch {
    await client.connect(new SSEClientTransport(new URL(url), { requestInit }));
  }
  try {
    const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 90_000 });
    if (result.isError) throw new Error(`MCP tool ${tool} returned an error`);
    // `text` flattens the content blocks for LLM parsing; `structured` is the tool's
    // machine-readable result when it provides one.
    return {
      text: (result.content || []).map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n'),
      structured: result.structuredContent ?? null,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

// Some servers rate-limit every HTTP request (OctoTrip: about 1 per second), so opening a new
// connection per search uses up the allowance. These calls reuse one open connection per URL,
// and retry once, after a pause, when the server says to slow down.
const kept = new Map();

async function keptClient(url, headers) {
  if (!kept.has(url)) {
    const client = new Client({ name: 'kit', version: '0.1.0' });
    const ready = client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: headersFrom(headers) } }))
      .then(() => client)
      .catch((e) => { kept.delete(url); throw e; });
    kept.set(url, ready);
  }
  return kept.get(url);
}

const isRateLimited = (e) => /429|rate.?limit/i.test(String(e?.message || e));

export async function callMcpToolKeepAlive({ url, headers, tool, args }, { retryAfterMs = 2500 } = {}) {
  if (UNSAFE_TOOL.test(tool)) throw new Error(`Refusing to call MCP tool "${tool}": KIT only calls search tools`);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const client = await keptClient(url, headers);
      const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 90_000 });
      if (result.isError) throw new Error(`MCP tool ${tool} returned an error`);
      return {
        text: (result.content || []).map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n'),
        structured: result.structuredContent ?? null,
      };
    } catch (e) {
      // A dropped or refused connection is reopened on the next call.
      if (!isRateLimited(e)) kept.delete(url);
      if (attempt >= 1) throw e;
      if (isRateLimited(e)) await new Promise((r) => setTimeout(r, retryAfterMs));
    }
  }
}
