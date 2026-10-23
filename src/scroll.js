export function nearBottom(scrollHeight, scrollTop, clientHeight, slack = 48) {
  return scrollHeight - scrollTop - clientHeight < slack;
}
