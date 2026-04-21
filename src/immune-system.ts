/**
 * ═══════════════════════════════════════════════════════════
 *  HỆ THỐNG MIỄN DỊCH (Immune System) cho Neon Postgres MCP
 * ═══════════════════════════════════════════════════════════
 */

export interface ImmuneLogEntry {
  timestamp: string;
  toolName: string;
  layer: "RETRY" | "FALLBACK" | "QUARANTINE";
  errorMessage: string;
}

const immuneJournal: ImmuneLogEntry[] = [];
const MAX_JOURNAL_SIZE = 100;

function logImmune(toolName: string, layer: ImmuneLogEntry["layer"], errorMessage: string) {
  const entry: ImmuneLogEntry = {
    timestamp: new Date().toISOString(),
    toolName,
    layer,
    errorMessage,
  };
  console.error(`[Neon-Miễn dịch][${layer}] Tool=${toolName}: ${errorMessage}`);
  immuneJournal.push(entry);
  if (immuneJournal.length > MAX_JOURNAL_SIZE) {
    immuneJournal.shift();
  }
}

export function getImmuneJournal(): ImmuneLogEntry[] {
  return [...immuneJournal];
}

/**
 * Lõi thực thi tự chữa lành cho Neon API
 */
export async function resilientExec<T>(
  toolName: string,
  primaryFn: () => Promise<T>,
  fallbackValue: T
): Promise<{ status: "healthy" | "healed" | "quarantined"; method: string; data: T }> {

  // LỚP 1: Thử lần đầu
  try {
    const data = await primaryFn();
    return { status: "healthy", method: "primary_api", data };
  } catch (err: any) {
    logImmune(toolName, "RETRY", `Lần 1 thất bại: ${err.message}`);
  }

  // LỚP 2: Tự động thử lại (Retry) sau 1 giây
  try {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const data = await primaryFn();
    logImmune(toolName, "RETRY", "Lần 2 thành công - Hệ thống đã tự phục hồi!");
    return { status: "healed", method: "retry_success", data };
  } catch (err: any) {
    logImmune(toolName, "QUARANTINE", `Lần 2 vẫn lỗi: ${err.message}. Kích hoạt Lá chắn cô lập.`);
  }

  // LỚP 3: Cô lập lỗi (Quarantine) - Trả về kết quả rỗng/an toàn
  return {
    status: "quarantined",
    method: "quarantine_safe",
    data: fallbackValue
  };
}
