import { decodeHTML, decodeHTMLAttribute } from "entities";
import { getTranslations } from "./i18n";
import { isThemeColor, normalizeBadge, normalizeHexColor, type Badge } from "./model";

export const MAX_IMPORT_BADGES = 500;
export const MAX_IMPORT_LENGTH = 200_000;

/** Parses only Simple Badge's span format. Pasted markup never enters the DOM. */
export function parseBadgeSpans(source: string, strings = getTranslations()): Badge[] {
  if (source.length > MAX_IMPORT_LENGTH) throw new Error(strings.importTooLarge);
  let input = source.trim();
  if (!input) throw new Error(strings.importRequired);
  if (input.startsWith("```")) {
    const fence = /^```(?:html)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(input);
    if (!fence) throw new Error(strings.importSyntax);
    input = fence[1].trim();
    if (!input) throw new Error(strings.importRequired);
  }

  const badges: Badge[] = [];
  // A deliberately narrow grammar rejects missing closing tags, nested HTML, and surrounding prose.
  const span = /<span(?=[\t\n\f\r >])((?:[^<>"']|"[^"<>]*"|'[^'<>]*')*)>([^<]*)<\/span[\t\n\f\r ]*>/iy;
  const attribute = /[\t\n\f\r ]+(class|style)[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r "'`=<>]+))/iy;
  let offset = 0;
  while (offset < input.length) {
    while (offset < input.length && /\s/.test(input[offset])) offset++;
    if (offset === input.length) break;
    if (badges.length === MAX_IMPORT_BADGES) throw new Error(strings.importTooMany(MAX_IMPORT_BADGES));
    try {
      span.lastIndex = offset;
      const match = span.exec(input);
      if (!match) throw new Error(strings.importSyntax);
      offset = span.lastIndex;
      const attributes = new Map<string, string>();
      let attributeOffset = 0;
      while (match[1].slice(attributeOffset).trim()) {
        attribute.lastIndex = attributeOffset;
        const part = attribute.exec(match[1]);
        if (!part) throw new Error(strings.importAttributes);
        const name = part[1].toLowerCase();
        if (attributes.has(name)) throw new Error(strings.importAttributes);
        attributes.set(name, decodeHTMLAttribute(part[2] ?? part[3] ?? part[4]));
        attributeOffset = attribute.lastIndex;
      }

      const classes = new Set((attributes.get("class") ?? "").split(/[\t\n\f\r ]+/).filter(Boolean));
      if (classes.size !== 2 || !classes.delete("badge")) throw new Error(strings.importClasses);
      const colorClass = Array.from(classes)[0];
      const style = attributes.get("style") ?? "";
      let color: Badge["color"];
      if (colorClass === "badge-custom") {
        const custom = /^[\t\n\f\r ]*--simple-badge-color[\t\n\f\r ]*:[\t\n\f\r ]*(#[\da-fA-F]{3}(?:[\da-fA-F]{3})?)[\t\n\f\r ]*;?[\t\n\f\r ]*$/.exec(style);
        const hex = normalizeHexColor(custom?.[1]);
        if (!hex) throw new Error(strings.importCustomStyle);
        color = hex;
      } else {
        const name = colorClass.startsWith("badge-") ? colorClass.slice(6) : undefined;
        if (!isThemeColor(name)) throw new Error(strings.importClasses);
        if (style.trim()) throw new Error(strings.importThemeStyle);
        color = name;
      }
      badges.push(normalizeBadge({ text: decodeHTML(match[2]).trim(), color }, strings));
    } catch (error) {
      throw new Error(strings.importItemError(badges.length + 1, error instanceof Error ? error.message : strings.importSyntax));
    }
  }
  return badges;
}
