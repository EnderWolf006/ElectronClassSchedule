// 窗口 query 参数（main.js loadFile 时传入）
export const query = new URLSearchParams(window.location.search);

export function getQueryData() {
  try {
    return JSON.parse(decodeURIComponent(query.get('data') || '{}'));
  } catch (error) {
    return {};
  }
}
