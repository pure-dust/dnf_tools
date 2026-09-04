import { invoke } from "@tauri-apps/api/core";

/** 是否运行在 Tauri WebView 中 */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const LS_KEY = "dnf_schedule_data";

export async function loadDataRaw(): Promise<string | null> {
  if (isTauri) {
    return invoke<string | null>("load_data");
  }
  return localStorage.getItem(LS_KEY);
}

export async function saveDataRaw(json: string): Promise<void> {
  if (isTauri) {
    await invoke("save_data", { payload: json });
    return;
  }
  localStorage.setItem(LS_KEY, json);
}

export interface ExportResult {
  ok: boolean;
  message: string;
  /** Tauri 下为保存的绝对路径 */
  path?: string;
}

/** 导出 PNG：Tauri 下写入本地文件；浏览器下触发下载 */
export async function exportPng(fileName: string, dataUrl: string): Promise<ExportResult> {
  // dataUrl 形如 data:image/png;base64,xxxx
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bytes = base64ToBytes(base64);

  if (isTauri) {
    try {
      const path = await invoke<string>("export_image", {
        fileName,
        bytes,
      });
      return { ok: true, message: "已导出", path };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  }

  // 浏览器回退：下载
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { ok: true, message: "已下载" };
}

function base64ToBytes(base64: string): number[] {
  if (typeof atob === "function") {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return Array.from(bytes);
  }
  // 极端兼容
  const bytes = [];
  for (let i = 0; i < base64.length; i += 4) bytes.push(0);
  return bytes;
}

/** 导出文本文件（JSON 等）：Tauri 下写入本地文件；浏览器下触发下载 */
export async function exportJson(fileName: string, text: string): Promise<ExportResult> {
  if (isTauri) {
    try {
      const path = await invoke<string>("export_text", {
        fileName,
        text,
      });
      return { ok: true, message: "已导出", path };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  }

  // 浏览器回退：下载
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { ok: true, message: "已下载" };
}
