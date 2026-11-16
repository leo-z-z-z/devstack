/* UI 状态：导航、弹窗、抽屉、toast、搜索、拖拽 */
import { createContext, useContext } from 'react';
import { ServiceDefinition, GroupDefinition } from '../shared/types';
import { LogLine } from './api';

export type NavKey = 'services' | 'logs' | 'settings' | 'templates' | 'scripts';

export interface ModalSpec {
  kind: 'editor' | 'group' | 'confirm' | 'move' | 'none';
  service?: ServiceDefinition | null;
  group?: GroupDefinition | null;
  title?: string;
  body?: string;
  okText?: string;
  danger?: boolean;
  detail?: string;
  onOk?: () => void;
  onDiscard?: () => void;
  onCancel?: () => void;
  /** “不保存”按钮文本（模式 A 三选一时使用） */
  discardText?: string;
  /** 组合仅重命名模式：GroupEditor 只展示名称编辑，不展示成员选择 */
  renameOnly?: boolean;
}

export interface DrawerSpec {
  open: boolean;
  title: string;
  chip: string;
  lines: LogLine[];
  wide: boolean;
}

export interface UiContextValue {
  nav: NavKey;
  setNav: (n: NavKey) => void;
  search: string;
  setSearch: (s: string) => void;
  modal: ModalSpec;
  openModal: (m: ModalSpec) => void;
  closeModal: () => void;
  drawer: DrawerSpec;
  openDrawer: (d: Omit<DrawerSpec, 'open' | 'wide'>) => void;
  closeDrawer: () => void;
  toggleDrawerWide: () => void;
  toastMsg: string;
  toast: (m: string) => void;
  tempExpand: Record<string, boolean>;
  setTempExpand: (f: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
}

export const UiContext = createContext<UiContextValue | null>(null);

export function useUi(): UiContextValue {
  const v = useContext(UiContext);
  if (!v) throw new Error('useUi outside provider');
  return v;
}
