import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { resilientExec, getImmuneJournal } from "./immune-system.js";

const NEON_API_KEY = process.env.NEON_API_KEY || "";
const NEON_API_BASE = "https://console.neon.tech/api/v2";

const server = new Server(
  {
    name: "neon-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const neonClient = axios.create({
  baseURL: NEON_API_BASE,
  headers: {
    Authorization: `Bearer ${NEON_API_KEY}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

// --- Register Tools ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "neon_list_projects",
        description: "Liệt kê tất cả các dự án Neon Postgres hiện có.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "neon_list_branches",
        description: "Liệt kê các nhánh (branches) của một project.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string", description: "ID của project Neon." },
          },
          required: ["projectId"],
        },
      },
      {
        name: "neon_create_branch",
        description: "Tạo một nhánh mới từ nhánh chính (hoặc một nhánh cụ thể).",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            branchName: { type: "string" },
            parentId: { type: "string", description: "ID của nhánh cha (tùy chọn)." },
          },
          required: ["projectId", "branchName"],
        },
      },
      {
        name: "neon_run_sql",
        description: "Chạy một lệnh SQL trực tiếp trên một nhánh và database cụ thể.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            branchId: { type: "string" },
            databaseName: { type: "string" },
            sql: { type: "string" },
          },
          required: ["projectId", "branchId", "databaseName", "sql"],
        },
      },
      {
        name: "neon_get_connection_string",
        description: "Lấy chuỗi kết nối (Connection String) của một nhánh.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: { type: "string" },
            branchId: { type: "string" },
          },
          required: ["projectId", "branchId"],
        },
      },
      {
        name: "neon_get_immune_status",
        description: "Truy xuất nhật ký Hệ thống Miễn dịch của Neon MCP.",
        inputSchema: { type: "object", properties: {} },
      }
    ],
  };
});

// --- Handle Tool Calls ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!NEON_API_KEY && name !== "neon_get_immune_status") {
    return {
      content: [{ type: "text", text: "LỖI: Chưa có NEON_API_KEY. Vui lòng cung cấp API Key để sử dụng." }],
      isError: true,
    };
  }

  switch (name) {
    case "neon_list_projects": {
      const result = await resilientExec(name, async () => {
        const response = await neonClient.get("/projects");
        return response.data.projects;
      }, []);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "neon_list_branches": {
      const { projectId } = args as { projectId: string };
      const result = await resilientExec(name, async () => {
        const response = await neonClient.get(`/projects/${projectId}/branches`);
        return response.data.branches;
      }, []);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "neon_create_branch": {
      const { projectId, branchName, parentId } = args as { projectId: string; branchName: string; parentId?: string };
      const result = await resilientExec(name, async () => {
        const payload: any = { branch: { name: branchName } };
        if (parentId) payload.branch.parent_id = parentId;
        const response = await neonClient.post(`/projects/${projectId}/branches`, payload);
        return response.data.branch;
      }, { error: "Không thể tạo nhánh" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "neon_run_sql": {
      const { projectId, branchId, databaseName, sql } = args as { projectId: string; branchId: string; databaseName: string; sql: string };
      const result = await resilientExec(name, async () => {
        const response = await neonClient.post(`/projects/${projectId}/branches/${branchId}/databases/${databaseName}/query`, {
          query: sql
        });
        return response.data;
      }, { error: "Lỗi thực thi SQL" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "neon_get_connection_string": {
      const { projectId, branchId } = args as { projectId: string; branchId: string };
      const result = await resilientExec(name, async () => {
        const response = await neonClient.get(`/projects/${projectId}/branches/${branchId}/endpoints`);
        const endpoint = response.data.endpoints[0];
        if (!endpoint) return { error: "Không tìm thấy endpoint" };
        return {
          connection_string: `postgresql://${endpoint.host}/${endpoint.id}`,
          host: endpoint.host,
        };
      }, { error: "Lỗi lấy thông tin kết nối" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "neon_get_immune_status": {
      return {
        content: [{ type: "text", text: JSON.stringify(getImmuneJournal(), null, 2) }],
      };
    }

    default:
      throw new Error(`Công cụ không tồn tại: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Neon Postgres MCP Server (với Hệ Miễn Dịch) đang chạy...");
}

main().catch((error) => {
  console.error("Lỗi nghiêm trọng trong main():", error);
  process.exit(1);
});
