#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApexMcpServer } from './server.js';

const args = process.argv.slice(2);
let projectRoot: string | undefined;
for (let i = 0; i < args.length; i += 1) {
  if ((args[i] === '--project' || args[i] === '-p') && args[i + 1]) {
    projectRoot = args[i + 1];
    i += 1;
  }
}
projectRoot ??= process.env['APEX_PROJECT'] || undefined;

const server = new ApexMcpServer(projectRoot ? { projectRoot } : {});
const transport = new StdioServerTransport();
server.server.connect(transport).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
