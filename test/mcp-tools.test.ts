import { describe, expect, it } from 'vitest';
import { handleMcp } from '../src/api/mcp.js';

async function listTools(): Promise<any[]> {
  const res = await handleMcp(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
  );
  return (await res.json()).result.tools;
}

describe('herramientas MCP', () => {
  it('cada herramienta y cada parámetro está documentado (la calidad de las definiciones la puntúan los directorios)', async () => {
    const tools = await listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['check_dependencies', 'eol_status', 'find_compatible_version', 'find_package', 'list_versions', 'model_status', 'package_status', 'recent_changes', 'symbol_status', 'upgrade_impact', 'version_status'].sort(),
    );
    for (const t of tools) {
      expect(t.description.length, `${t.name}: descripción`).toBeGreaterThan(300);
      expect(t.annotations?.readOnlyHint, `${t.name}: readOnlyHint`).toBe(true);
      for (const [p, def] of Object.entries<any>(t.inputSchema.properties ?? {})) {
        expect(def.description?.length ?? 0, `${t.name}.${p}: descripción del parámetro`).toBeGreaterThan(20);
      }
    }
  });
});
