export function parseToStructuredItems(values: string[]) {
  const items: any[] = [];
  let currentItem: any = { extra: [] };

  const isDate = (s: string | undefined) => {
    if (!s) return false;
    return (
      /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Present)\s\d{2,4}/i.test(
        s,
      ) || /\d{4}\s*[-–]\s*\d{4}/.test(s)
    );
  };

  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (
      val === "Experience" ||
      val === "Education" ||
      val === "Projects" ||
      val === "Licenses & certifications" ||
      val === "Skills"
    )
      continue;

    const next1 = values[i + 1];
    const next2 = values[i + 2];

    if (isDate(val)) {
      currentItem.dateRange = val;
    } else if (next1 && isDate(next1)) {
      // If next is date, this is either subtitle or title (if title not set)
      if (currentItem.title) {
        currentItem.subtitle = val;
      } else {
        currentItem.title = val;
      }
    } else if (next2 && isDate(next2)) {
      // If next2 is date, this is title. New item starts!
      if (currentItem.title || currentItem.subtitle) {
        items.push(currentItem);
        currentItem = { extra: [] };
      }
      currentItem.title = val;
    } else {
      if (currentItem.dateRange) {
        currentItem.extra.push(val);
      } else if (!currentItem.title) {
        currentItem.title = val;
      } else {
        currentItem.extra.push(val);
      }
    }
  }

  if (currentItem.title || currentItem.subtitle || currentItem.dateRange) {
    items.push(currentItem);
  }

  return items.map((item) => {
    const result: any = {};
    if (item.title) result.title = item.title;
    if (item.subtitle) result.subtitle = item.subtitle;
    if (item.dateRange) result.dateRange = item.dateRange;
    if (item.extra && item.extra.length > 0) {
      result.locationOrExtra = item.extra[0];
      if (item.extra.length > 1) {
        result.description = item.extra.slice(1).join("\n");
      }
    }
    return result;
  });
}
