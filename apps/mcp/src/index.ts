#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SavedStore } from "./store.js";
import { createServer } from "./server.js";
try {
 const store=await SavedStore.open(process.env.TUBESTUDIO_DATA_DIR,process.env.TUBESTUDIO_MCP_SCOPES);
 const server=createServer(store);await server.connect(new StdioServerTransport());
 process.once("SIGINT",()=>void server.close().finally(()=>process.exit(0)));
 process.once("SIGTERM",()=>void server.close().finally(()=>process.exit(0)));
} catch { console.error("TubeStudio MCP could not start. Set TUBESTUDIO_DATA_DIR to an existing absolute directory and TUBESTUDIO_MCP_SCOPES to documented categories. No .env is loaded. See MCP-README.md.");process.exitCode=1; }
