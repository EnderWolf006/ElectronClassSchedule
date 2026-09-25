// 沿用旧窗口内联 SVG 的精确 path 数据。
// stroke 风格图标默认 fill="none" + stroke="currentColor"；
// 需要实心的元素在 html 字符串内自带 fill / stroke 属性。
export function Svg({
  size = 18,
  viewBox = '0 0 20 20',
  html = '',
  strokeWidth = 1.5,
  style,
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      aria-hidden="true"
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export const ICONS = {
  // config-editor 主导航
  subject: '<path d="M7 4.5v11M7 4.5c1.8-1.3 4.5-1.5 6.5-.6v10.2c-2-.9-4.7-.7-6.5.6M7 15.5c1.8-1.3 4.5-1.5 6.5-.6"/>',
  timetable: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.8 2"/>',
  daily: '<rect x="3" y="4.5" width="14" height="12" rx="1.5"/><path d="M3 8h14M7 2.8v3M13 2.8v3"/>',
  divider: '<path d="M10 3.5v13M5 3.5v13M15 3.5v13"/>',
  // software-settings 主导航
  basicSettings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/>',
  components: '<rect x="3.2" y="3.2" width="7.6" height="7.6" rx="1.2"/><rect x="13.2" y="3.2" width="7.6" height="7.6" rx="1.2"/><rect x="3.2" y="13.2" width="7.6" height="7.6" rx="1.2"/><rect x="13.2" y="13.2" width="7.6" height="7.6" rx="1.2"/>',
  style: '<path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.4 0 2-.9 2-1.9 0-1.3-1-1.7-1-2.9 0-1 .8-1.8 2-1.8h1.8a4 4 0 0 0 4-4C20.8 6.2 16.9 3.2 12 3.2z"/><circle cx="7.6" cy="10.2" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.4" r="1" fill="currentColor" stroke="none"/><circle cx="16.4" cy="10.2" r="1" fill="currentColor" stroke="none"/>',
  reminder: '<path d="M12 3.2c-3.2 0-5.5 2.5-5.5 5.7v3l-1.7 3.2c-.3.6.1 1.4.8 1.4h12.8c.7 0 1.1-.8.8-1.4l-1.7-3.2v-3c0-3.2-2.3-5.7-5.5-5.7z"/><path d="M9.9 19.6a2.2 2.2 0 0 0 4.2 0"/>',
  // 时间段卡片
  dragDots: '<circle cx="2.8" cy="3" r="1.4" fill="currentColor" stroke="none"/><circle cx="7.2" cy="3" r="1.4" fill="currentColor" stroke="none"/><circle cx="2.8" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="7.2" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="2.8" cy="13" r="1.4" fill="currentColor" stroke="none"/><circle cx="7.2" cy="13" r="1.4" fill="currentColor" stroke="none"/>',
  dragDotsVertical: '<circle cx="4" cy="4.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="4" cy="11.5" r="1.7" fill="currentColor" stroke="none"/>',
  trash: '<path d="M2.5 4.2h11M6.4 4.2V3.1c0-.6.5-1 1-1h1.2c.5 0 1 .4 1 1v1.1M4.2 4.2l.5 8.3c.1.8.7 1.4 1.5 1.4h3.6c.8 0 1.4-.6 1.5-1.4l.5-8.3M6.6 7v4.2M9.4 7v4.2"/>',
  // software-settings 组件库
  componentSchedule: '<rect x="2.8" y="3.5" width="14.4" height="13" rx="2"/><path d="M2.8 7.2h14.4M6.2 10.6h6.2M6.2 13.4h4.2"/>',
  componentWeek: '<rect x="2.8" y="3.5" width="14.4" height="13" rx="2"/><path d="M2.8 7.2h14.4M6 2.2v2.8M14 2.2v2.8"/><circle cx="6.3" cy="10.2" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="10.2" r=".9" fill="currentColor" stroke="none"/><circle cx="13.7" cy="10.2" r=".9" fill="currentColor" stroke="none"/><circle cx="6.3" cy="13.4" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="13.4" r=".9" fill="currentColor" stroke="none"/><circle cx="13.7" cy="13.4" r=".9" fill="currentColor" stroke="none"/>',
  componentDate: '<rect x="2.8" y="3.5" width="14.4" height="13" rx="2"/><path d="M2.8 7.2h14.4M6 2.2v2.8M14 2.2v2.8"/><circle cx="6.6" cy="12.8" r=".9" fill="currentColor" stroke="none"/><rect x="11" y="10.4" width="4.6" height="4.6" rx="1" fill="currentColor" stroke="none"/>',
  componentCountdown: '<circle cx="10" cy="11" r="6.2"/><path d="M10 8v3.2l2.2 1.6M8.2 2.5h3.6M10 2.5v2.3"/>',
  componentTime: '<circle cx="10" cy="10" r="7"/><path d="M10 5.8V10l3 1.8"/>',
  componentCustomText: '<path d="M3.5 5.2h13M3.5 10h13M3.5 14.8h7.5"/>',
};
