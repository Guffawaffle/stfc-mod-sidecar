export function classifyProjectionPayload(payload) {
  if (!payload || payload.ok !== true || payload.available === false) {
    return "unavailable";
  }

  const projection = payload.projection ?? null;
  if (!projection || !Array.isArray(projection.slots) || projection.slots.length === 0) {
    return "empty";
  }

  return "rows";
}