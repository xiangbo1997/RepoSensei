/** 统一的错误消息提取：Tauri invoke 抛的是 string，JS 抛的是 Error，两者都兜住。 */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
