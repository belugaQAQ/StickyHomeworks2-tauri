export function toHomeworkDisplayText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("<")) return content;

  try {
    const document = new DOMParser().parseFromString(trimmed, "application/xml");
    if (document.querySelector("parsererror")) return content;

    return document.documentElement.textContent?.replace(/\s+/g, " ").trim() || "";
  } catch {
    return content;
  }
}

export function isHomeworkExpired(dueTime: string): boolean {
  const dueDate = new Date(dueTime);
  if (Number.isNaN(dueDate.getTime())) return false;

  const today = new Date();
  dueDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return dueDate < today;
}
