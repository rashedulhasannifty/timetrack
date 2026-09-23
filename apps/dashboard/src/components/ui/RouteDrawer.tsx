'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Drawer } from './Drawer';

/**
 * The Drawer for an intercepted route. "Open" means this URL is showing, and closing means
 * going back — so `open` is hard-coded true and `onClose` is router.back().
 *
 * This exists because a Server Component cannot pass Drawer's `onClose` across the RSC
 * boundary. It takes only serializable props and `children`; children are already-rendered
 * nodes, which DO cross, so the intercepted page stays server-rendered and its fetch keeps the
 * token on the server.
 */
export function RouteDrawer({
  title,
  size,
  children,
}: {
  title: string;
  size?: 'default' | 'wide';
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Drawer open onClose={() => router.back()} title={title} {...(size ? { size } : {})}>
      {children}
    </Drawer>
  );
}
