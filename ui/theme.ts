function detectTheme(): "light" | "dark" {
  const root = document.documentElement;
  const theme = (root.dataset.theme ?? "").toLowerCase();
  if (theme.includes("light")) return "light";
  if (theme.includes("dark")) return "dark";
  const surface = getComputedStyle(root).getPropertyValue("--color-surface").trim();
  if (surface) {
    const probe = document.createElement("span");
    probe.style.color = surface;
    document.body.append(probe);
    const channels = getComputedStyle(probe).color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    probe.remove();
    if (channels?.length === 3) {
      const [red, green, blue] = channels.map(value => {
        const channel = value / 255;
        return channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * red + .7152 * green + .0722 * blue > .45 ? "light" : "dark";
    }
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function watchTheme(): void {
  const apply = () => { document.body.dataset.pvTheme = detectTheme(); };
  apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", apply);
  window.astra?.onThemeChange?.(() => requestAnimationFrame(apply));
}
