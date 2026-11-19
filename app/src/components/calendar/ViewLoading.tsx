/** Holds the view's place for the moment its code loads, so the page does not jump. */
export function ViewLoading() {
  return <div className="min-h-[60vh]" aria-busy="true" />;
}
