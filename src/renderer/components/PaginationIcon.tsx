/**
 * 翻页用的内联 SVG 图标按钮。Lucide 风格：1.5 描边、24px 框、无填充。
 *
 * 比 @material 图标 / 字体图标轻量；颜色随 currentColor 自然跟主题走。
 */

import { ButtonHTMLAttributes } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 显示哪个图标 */
  kind: 'prev' | 'next' | 'first' | 'last';
  /** 视觉尺寸：sm/md/lg */
  size?: 'sm' | 'md';
}

const ICONS: Record<Props['kind'], JSX.Element> = {
  prev: (
    <path
      d="M15 18l-6-6 6-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  next: (
    <path
      d="M9 18l6-6-6-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  first: (
    <path
      d="M19 18l-6-6 6-6 M11 5v14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  last: (
    <path
      d="M5 6l6 6-6 6 M13 5v14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

export function PaginationIcon(props: Props): JSX.Element {
  const { kind, size = 'md', ...rest } = props;
  const dim = size === 'sm' ? 14 : 16;
  return (
    <button
      type="button"
      {...rest}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${dim + 10}px`,
        height: `${dim + 6}px`,
        padding: 0,
        // 让 currentColor 生效，使用 stroke-currentColor 是更稳的写法
      }}
    >
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {ICONS[kind]}
      </svg>
    </button>
  );
}