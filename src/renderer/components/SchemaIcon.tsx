/**
 * Schema 树用的内联 SVG 图标。Lucide 风格：1.5 描边、24px viewBox。
 *
 * - database：堆叠的椭圆
 * - table：3×3 网格
 * - view：眼睛
 * - folder：文件夹
 * - key：钥匙形状（Redis 叶子 key 专用）
 */

import { CSSProperties } from 'react';

export type IconKind = 'db' | 'table' | 'view' | 'folder' | 'key';

interface Props {
  kind: IconKind;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function SchemaIcon({ kind, size = 14, className, style }: Props): JSX.Element {
  const common = {
    className,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    xmlns: 'http://www.w3.org/2000/svg',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    style,
  };

  switch (kind) {
    case 'db':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="8" ry="2.5" />
          <path d="M4 5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" />
          <path d="M4 11v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
        </svg>
      );
    case 'view':
      return (
        <svg {...common}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'folder':
      return (
        <svg {...common}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      );
    case 'key':
      // 钥匙：圆头 + 一条线 + 末端两个齿
      return (
        <svg {...common}>
          <circle cx="8" cy="15" r="3.5" />
          <path d="M10.8 12.2 21 2" />
          <path d="m17 6 3 3" />
          <path d="m15 8 3 3" />
        </svg>
      );
    case 'table':
    default:
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 10h18 M3 16h18 M9 4v16 M15 4v16" />
        </svg>
      );
  }
}