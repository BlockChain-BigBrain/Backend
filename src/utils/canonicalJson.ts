// MySQL JSON storage may reorder object keys. Hash and upload the same stable
// serialization so a DB round trip cannot change content-addressed metadata.
export function canonicalJson(value: unknown): string {
  const sort = (item: any): any => {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])]));
    return item;
  };
  return JSON.stringify(sort(value));
}
