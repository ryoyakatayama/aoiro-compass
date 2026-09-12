export type BookKind = 'business' | 'misc';
export const bookKind: BookKind =
  new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('book') === 'misc'
    ? 'misc'
    : 'business';
export const isMisc = bookKind === 'misc';
export const bookLabel = isMisc ? '雑所得' : '事業所得（青色申告）';
export const profitLabel = isMisc ? '差引所得（計算用）' : '事業利益';
export function switchBook(book: BookKind) {
  const url = new URL(location.href);
  if (book === 'business') url.searchParams.delete('book');
  else url.searchParams.set('book', book);
  location.assign(url.toString());
}
