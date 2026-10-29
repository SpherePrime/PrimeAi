export function swapText(node: HTMLElement, text: string): void {
  if (node.textContent === text) return;
  node.textContent = text;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  node.classList.remove("is-swapping");
  void node.offsetWidth;
  node.classList.add("is-swapping");
}
