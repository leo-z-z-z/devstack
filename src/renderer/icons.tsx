/* SVG 图标：精灵表注入 + Icon 组件 */
import sprite from './sprite.svg?raw';

export function SpriteDefs(): JSX.Element {
  return <span style={{ position: 'absolute', width: 0, height: 0 }} dangerouslySetInnerHTML={{ __html: sprite }} />;
}

export function Icon({ id, size = 12 }: { id: string; size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} aria-hidden>
      <use href={'#' + id} />
    </svg>
  );
}
