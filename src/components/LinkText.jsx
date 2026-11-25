import { Fragment } from 'react';

// A web address: "http://", "https://" or "www." up to the next space. Punctuation that ends the sentence is left out.
const URL = /((?:https?:\/\/|www\.)[^\s<>"]+)/gi;
const TRAILING = /[.,;:!?'"’”)\]}>]+$/;

/** Where the address really ends: "(see https://x.com/a)." keeps neither the bracket nor the full stop. */
function splitTail(raw) {
  let url = raw;
  for (;;) {
    const tail = url.match(TRAILING)?.[0];
    if (!tail) break;
    // a closing bracket stays when it has its opening one inside the address (as Wikipedia's do)
    const last = url[url.length - 1];
    const open = { ')': '(', ']': '[', '}': '{' }[last];
    if (open && url.split(open).length >= url.split(last).length) break;
    url = url.slice(0, -1);
  }
  return [url, raw.slice(url.length)];
}

const LINK = 'text-brand-700 underline decoration-brand-300 underline-offset-2 break-all hover:decoration-brand-600';

/**
 * The text as a list of pieces with every web address made a link that opens in a new tab. `plain` renders the runs
 * between links (mentions, say). A click on a link doesn't count as a click on whatever card or row holds it.
 */
export function linkify(text, plain = (s) => s) {
  if (!text) return text;
  const str = String(text);
  if (!/https?:\/\/|www\./i.test(str)) return plain(str);
  return str.split(URL).map((part, i) => {
    if (!(i % 2)) return part ? <Fragment key={i}>{plain(part)}</Fragment> : null;
    const [url, tail] = splitTail(part);
    if (!/[a-z0-9]/i.test(url.replace(/^(https?:\/\/|www\.)/i, ''))) return <Fragment key={i}>{plain(part)}</Fragment>;
    return (
      <Fragment key={i}>
        <a href={/^www\./i.test(url) ? `https://${url}` : url} target="_blank" rel="noopener noreferrer" className={LINK}
          onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>{url}</a>
        {tail}
      </Fragment>
    );
  });
}

/** Written text (a note, a comment, a description) with its web addresses clickable. */
export default function LinkText({ text }) {
  return linkify(text);
}
