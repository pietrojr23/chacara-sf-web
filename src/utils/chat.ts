export const buildPrivateChatId = (a: string, b: string) =>
  [a, b].sort((left, right) => left.localeCompare(right)).join('_');
