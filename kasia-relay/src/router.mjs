export function routeMessage(text) {
  if (!text) return { agent: "main", body: "" };

  if (text.startsWith("#beta ")) {
    return { agent: "beta", body: text.slice(6) };
  }

  if (text.startsWith("#main ")) {
    return { agent: "main", body: text.slice(6) };
  }

  return { agent: "main", body: text };
}