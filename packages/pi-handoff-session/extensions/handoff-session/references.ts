export function parseReferences(input: string): string[] {
  if (!input.trim()) return [];
  const parsed = input
    .split(/[\s,;\n]+/)
    .map(ref => ref.trim())
    .map(ref => ref.startsWith("@") ? ref.slice(1) : ref) // strip leading @
    .filter(Boolean);
  return Array.from(new Set(parsed)); // Deduplicate
}

export function autoDetectReferences(messages: any[]): string[] {
  const references = new Set<string>();

  const pathRegex = /(?:^|\s|`|")((?:[a-zA-Z0-9_\-.]+\/)+[a-zA-Z0-9_\-.]+?)(?=[,.;!?]?(?:$|\s|`|"))/g;
  const shaRegex = /(?:^|\s|`|")([0-9a-f]{7,40})(?=[,.;!?]?(?:$|\s|`|"))/gi;
  const urlRegex = /(https?:\/\/[^\s`"]+?)(?=[,.;!?)]?(?:\s|$|`|"))/g;

  for (const msg of messages) {
    if (!msg) continue;
    const msgObj = msg.type === "message" ? msg.message : msg;
    const text = typeof msgObj.content === "string" 
      ? msgObj.content 
      : Array.isArray(msgObj.content)
        ? msgObj.content.map((c: any) => c.type === "text" ? c.text : "").join(" ")
        : msg.summary || ""; // Fallback for compactionSummary

    let match;
    while ((match = pathRegex.exec(text)) !== null) {
      const p = match[1];
      if (p.includes(".") && !p.includes("node_modules/")) {
        references.add(p);
      }
    }

    while ((match = shaRegex.exec(text)) !== null) {
      if (!/^\d+$/.test(match[1])) {
        references.add(match[1]);
      }
    }

    while ((match = urlRegex.exec(text)) !== null) {
      references.add(match[1]);
    }
  }

  return Array.from(references);
}
