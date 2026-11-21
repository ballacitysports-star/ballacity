/**
 * A count with its noun in the right number: "1 game", "2 games", "0 games". Use it for every visible count so the app
 * never reads "1 games" (WP 4.3). `many` defaults to `one` plus "s"; pass it for irregular nouns ("person", "people").
 */
export function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${count} ${pluralWord(count, one, many)}`;
}

/** Just the noun, for layouts that render the count separately (an animated number, a bold figure). */
export function pluralWord(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}
