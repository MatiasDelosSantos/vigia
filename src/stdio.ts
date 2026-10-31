#!/usr/bin/env node
/**
 * Vigia por stdio, el transporte local estándar de MCP (lo usan Claude Desktop, Glama y cualquier cliente que lance el
 * servidor como proceso). Mismas herramientas y definiciones que el endpoint HTTP.
 *
 * Los datos viven en PostgreSQL: con DATABASE_URL apuntando a una base de Vigia, todas las herramientas funcionan (y los
 * paquetes que no estén se consultan en vivo a los registries). Sin base de datos el servidor igual arranca y lista sus
 * herramientas; para usarlo sin instalar nada está el endpoint publicado https://vigia.coredls.cloud/mcp.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './api/mcp.js';

// stdout es el canal del protocolo: cualquier mensaje para humanos va a stderr.
if (!process.env.DATABASE_URL) {
  console.error('vigia (stdio): DATABASE_URL is not set; tools are listed but calls need a Vigia database. Hosted endpoint: https://vigia.coredls.cloud/mcp');
}
const server = buildServer();
await server.connect(new StdioServerTransport());
