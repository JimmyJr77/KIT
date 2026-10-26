// Minimal MCP client: connects to a remote MCP server over Streamable HTTP
// (falling back to SSE) and calls a single tool.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

function headersFrom(envJson) {
  try { return envJson ? JSON.parse(envJson) : {}; } catch { return {}; }
}

export async function callMcpTool({ url, headers, tool, args }) {
  const requestInit = { headers: headersFrom(headers) };
  const client = new Client({ name: 'kit', version: '0.1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit }));
  } catch {
    await client.connect(new SSEClientTransport(new URL(url), { requestInit }));
  }
  try {
    const result = await client.callTool({ name: tool, arguments: args });
    if (result.isError) throw new Error(`MCP tool ${tool} returned an error`);
    // Flatten text / structured content into a single string payload for parsing.
    const parts = (result.content || []).map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)));
    if (result.structuredContent) parts.push(JSON.stringify(result.structuredContent));
    return parts.join('\n');
  } finally {
    await client.close().catch(() => {});
  }
}
