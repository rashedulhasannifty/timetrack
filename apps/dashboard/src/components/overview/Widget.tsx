'use client';

import type { ReactNode } from 'react';
import { useWidgetVisibility } from './WidgetVisibilityProvider';

/** Wraps one Overview card; hidden via CSS when toggled off in the drawer. Children stay server-rendered. */
export function Widget({ id, children }: { id: string; children: ReactNode }) {
  const { isOn } = useWidgetVisibility();
  return (
    <div hidden={!isOn(id)} data-widget={id}>
      {children}
    </div>
  );
}
