export function createPageUrl(pageName: string) {
    // Routes in this app use PascalCase (/PatientDetails, /OASISCenter, etc.)
    // Split off any query string before prefixing with /
    const [page, ...rest] = pageName.split('?');
    const path = '/' + page.replace(/ /g, '');
    return rest.length > 0 ? `${path}?${rest.join('?')}` : path;
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