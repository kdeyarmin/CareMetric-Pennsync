


export function createPageUrl(pageName: string) {
    return '/' + pageName.toLowerCase().replace(/ /g, '-');
}

// Split a multi-line text field into a trimmed, non-empty string array. Shared by
// the course builders (learning objectives, lesson bullets/takeaways) so the same
// admin input parses identically everywhere.
export function linesToArray(value: unknown): string[] {
    return String(value ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}