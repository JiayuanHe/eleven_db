import { useEffect, useState } from 'react';

/**
 * 开屏动画：白蓝渐变背景 + 中心 logo + 弹跳动效 + 进度条
 * 1.6s 后自动消失（依赖 CSS 动画）
 */
export function SplashScreen(): JSX.Element | null {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // 与 CSS splash-out 动画同步：1.6s + 0.6s = 2.2s 后卸载
    const t = setTimeout(() => setVisible(false), 2300);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;
  return (
    <div className="splash">
      <div className="splash-logo">
        <div className="splash-mark" />
        <h1 className="splash-title">Eleven DB</h1>
        <p className="splash-subtitle">Lightweight Database Client</p>
      </div>
      <div className="splash-bar" />
    </div>
  );
}