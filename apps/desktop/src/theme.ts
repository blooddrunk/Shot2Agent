export type Theme = "dark" | "light";
const STORAGE_KEY = "shot2agent.appearance";

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme): boolean {
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}
