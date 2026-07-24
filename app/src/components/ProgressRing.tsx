import type { ReactNode } from 'react';
import { ProgressBar } from './primitives';

export function ProgressRing({
  fraction,
  size = 40,
  stroke = 4,
  color,
  children,
}: {
  fraction: number;
  size?: number;
  stroke?: number;
  color: string;
  children?: ReactNode;
}) {
  return (
    <ProgressBar variant="ring" value={fraction} size={size} stroke={stroke} color={color}>
      {children}
    </ProgressBar>
  );
}
