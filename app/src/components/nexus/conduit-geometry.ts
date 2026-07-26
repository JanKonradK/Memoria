export interface ConduitBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function conduitPath(stage: ConduitBounds, hub: ConduitBounds, node: ConduitBounds): string {
  const left = (node.left + node.right) / 2 < (hub.left + hub.right) / 2;
  const startX = (left ? node.right : node.left) - stage.left;
  const startY = (node.top + node.bottom) / 2 - stage.top;
  const endX = (left ? hub.left : hub.right) - stage.left;
  const endY = Math.max(hub.top + 16, Math.min(hub.bottom - 16, (node.top + node.bottom) / 2)) - stage.top;
  const middleX = (startX + endX) / 2;
  return `M ${startX} ${startY} C ${middleX} ${startY} ${middleX} ${endY} ${endX} ${endY}`;
}
